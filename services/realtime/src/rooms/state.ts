import type { SupabaseClient } from "@supabase/supabase-js";
import type { RedisClientType } from "redis";

import type { RoomAction, RoomCommand } from "./commands";

export type PlaybackState = "playing" | "paused";

export type RoomState = {
  roomId: string;
  name: string;
  videoId: string | null;
  playbackState: PlaybackState;
  videoTimeAtRef: number;
  referenceTimeMs: number;
  playbackRate: number;
  seq: number;
  controllerUserId: string | null;
  audienceDelaySeconds: number;
  createdBy: string | null;
};

const ROOM_STATE_TTL_SEC = 60 * 60 * 6; // 6h

function parseNum(s: unknown, fallback: number): number {
  const n = typeof s === "string" ? Number(s) : typeof s === "number" ? s : NaN;
  return Number.isFinite(n) ? n : fallback;
}

function parseText(s: unknown): string | null {
  return typeof s === "string" && s.length > 0 ? s : null;
}

function normalizePlaybackState(s: unknown): PlaybackState {
  return s === "playing" ? "playing" : "paused";
}

export function computeTimeAtMs(state: RoomState, atMs: number): number {
  const base = state.videoTimeAtRef;
  if (state.playbackState !== "playing") return Math.max(0, base);
  const dtSec = Math.max(0, (atMs - state.referenceTimeMs) / 1000);
  return Math.max(0, base + dtSec * state.playbackRate);
}

function roomStateKey(roomId: string) {
  return `room:state:${roomId}`;
}

export async function getRoomStateFromRedis(
  redis: RedisClientType<any, any, any>,
  roomId: string,
): Promise<RoomState | null> {
  const data = await redis.hGetAll(roomStateKey(roomId));
  if (!data || Object.keys(data).length === 0) return null;

  return {
    roomId,
    name: data.name ?? "Study Room",
    videoId: parseText(data.videoId),
    playbackState: normalizePlaybackState(data.playbackState),
    videoTimeAtRef: parseNum(data.videoTimeAtRef, 0),
    referenceTimeMs: parseNum(data.referenceTimeMs, Date.now()),
    playbackRate: parseNum(data.playbackRate, 1),
    seq: parseNum(data.seq, 0),
    controllerUserId: parseText(data.controllerUserId),
    audienceDelaySeconds: parseNum(data.audienceDelaySeconds, 0),
    createdBy: parseText(data.createdBy),
  };
}

export async function setRoomStateToRedis(
  redis: RedisClientType<any, any, any>,
  state: RoomState,
): Promise<void> {
  const key = roomStateKey(state.roomId);
  await redis.hSet(key, {
    name: state.name,
    videoId: state.videoId ?? "",
    playbackState: state.playbackState,
    videoTimeAtRef: String(state.videoTimeAtRef),
    referenceTimeMs: String(state.referenceTimeMs),
    playbackRate: String(state.playbackRate),
    seq: String(state.seq),
    controllerUserId: state.controllerUserId ?? "",
    audienceDelaySeconds: String(state.audienceDelaySeconds),
    createdBy: state.createdBy ?? "",
  });
  await redis.expire(key, ROOM_STATE_TTL_SEC);
}

function mapDbRowToState(roomId: string, row: Record<string, unknown>): RoomState {
  const name = typeof row.name === "string" ? row.name : "Study Room";
  const videoId = typeof row.current_video_id === "string" ? row.current_video_id : null;

  const createdBy = typeof row.created_by === "string" ? row.created_by : null;
  const controllerUserId =
    typeof row.controller_user_id === "string"
      ? row.controller_user_id
      : createdBy;

  const audienceDelaySeconds =
    typeof row.audience_delay_seconds === "number"
      ? row.audience_delay_seconds
      : 0;

  const playbackRate = typeof row.playback_rate === "number" ? row.playback_rate : 1;

  const playbackState =
    typeof row.playback_state === "string"
      ? normalizePlaybackState(row.playback_state)
      : Boolean(row.is_paused)
        ? "paused"
        : "playing";

  const videoTimeAtRef =
    typeof row.video_time_at_reference === "number"
      ? row.video_time_at_reference
      : typeof row.playback_position_seconds === "number"
        ? row.playback_position_seconds
        : 0;

  const refTimeStr =
    typeof row.reference_time === "string"
      ? row.reference_time
      : typeof row.updated_at === "string"
        ? row.updated_at
        : null;
  const referenceTimeMs = refTimeStr ? new Date(refTimeStr).getTime() : Date.now();

  const seq =
    typeof row.state_seq === "number"
      ? row.state_seq
      : typeof row.state_seq === "string"
        ? Number(row.state_seq)
        : 0;

  return {
    roomId,
    name,
    videoId,
    playbackState,
    videoTimeAtRef: Number.isFinite(videoTimeAtRef) ? videoTimeAtRef : 0,
    referenceTimeMs: Number.isFinite(referenceTimeMs) ? referenceTimeMs : Date.now(),
    playbackRate: Number.isFinite(playbackRate) ? playbackRate : 1,
    seq: Number.isFinite(seq) ? Math.trunc(seq) : 0,
    controllerUserId,
    audienceDelaySeconds: Number.isFinite(audienceDelaySeconds) ? audienceDelaySeconds : 0,
    createdBy,
  };
}

async function ensureRoomRowExists(
  supabaseAdmin: SupabaseClient,
  roomId: string,
  userIdForCreate: string,
): Promise<Record<string, unknown>> {
  const { data, error } = await supabaseAdmin
    .from("rooms")
    .select("*")
    .eq("id", roomId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (data) return data as Record<string, unknown>;

  const { data: inserted, error: insertError } = await supabaseAdmin
    .from("rooms")
    .insert({ id: roomId, created_by: userIdForCreate })
    .select("*")
    .single();

  if (insertError) throw new Error(insertError.message);
  return inserted as Record<string, unknown>;
}

export async function getOrCreateRoomState(
  redis: RedisClientType<any, any, any>,
  supabaseAdmin: SupabaseClient,
  roomId: string,
  userIdForCreate: string,
): Promise<RoomState> {
  const cached = await getRoomStateFromRedis(redis, roomId);
  if (cached) {
    await ensureRoomSeqAtLeast(redis, roomId, cached.seq);
    return cached;
  }

  const row = await ensureRoomRowExists(supabaseAdmin, roomId, userIdForCreate);
  const state = mapDbRowToState(roomId, row);
  await setRoomStateToRedis(redis, state);
  await ensureRoomSeqAtLeast(redis, roomId, state.seq);
  return state;
}

export async function persistRoomStateToDb(
  supabaseAdmin: SupabaseClient,
  state: RoomState,
): Promise<void> {
  const referenceIso = new Date(state.referenceTimeMs).toISOString();

  const basePatch: Record<string, unknown> = {
    current_video_id: state.videoId,
    is_paused: state.playbackState === "paused",
    playback_position_seconds: state.videoTimeAtRef,
    playback_rate: state.playbackRate,
  };

  const v2Patch: Record<string, unknown> = {
    ...basePatch,
    state_seq: state.seq,
    reference_time: referenceIso,
    video_time_at_reference: state.videoTimeAtRef,
    playback_state: state.playbackState,
    controller_user_id: state.controllerUserId,
    audience_delay_seconds: state.audienceDelaySeconds,
  };

  // Try v2 fields first, fall back to legacy-only if the project hasn't run the v2 SQL yet.
  const { error: v2Error } = await supabaseAdmin
    .from("rooms")
    .update(v2Patch)
    .eq("id", state.roomId);

  if (!v2Error) return;

  const msg = String(v2Error.message || "");
  const isMissingColumn =
    msg.toLowerCase().includes("does not exist") ||
    msg.toLowerCase().includes("unknown column") ||
    msg.toLowerCase().includes("column");

  if (!isMissingColumn) throw new Error(v2Error.message);

  const { error: legacyError } = await supabaseAdmin
    .from("rooms")
    .update(basePatch)
    .eq("id", state.roomId);

  if (legacyError) throw new Error(legacyError.message);
}

function roomSeqKey(roomId: string) {
  return `room:seq:${roomId}`;
}

export async function nextRoomSeq(
  redis: RedisClientType<any, any, any>,
  roomId: string,
): Promise<number> {
  const n = await redis.incr(roomSeqKey(roomId));
  return typeof n === "number" ? n : Number(n);
}

export async function ensureRoomSeqAtLeast(
  redis: RedisClientType<any, any, any>,
  roomId: string,
  minSeq: number,
): Promise<void> {
  const key = roomSeqKey(roomId);
  const currentRaw = await redis.get(key);
  const current = currentRaw ? Number(currentRaw) : 0;
  if (!Number.isFinite(current) || current < minSeq) await redis.set(key, String(minSeq));
}

function roomPendingKey(roomId: string) {
  return `room:pending:${roomId}`;
}

function encodePendingAction(action: RoomAction): string {
  return JSON.stringify(action);
}

function decodePendingAction(raw: string): RoomAction | null {
  try {
    const parsed = JSON.parse(raw) as RoomAction;
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.seq !== "number") return null;
    if (typeof parsed.execAtMs !== "number") return null;
    if (!parsed.command || typeof parsed.command !== "object") return null;
    if (!parsed.patch || typeof parsed.patch !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

const PENDING_ACTIONS_TTL_SEC = 60 * 10; // 10 minutes

export async function addPendingAction(
  redis: RedisClientType<any, any, any>,
  roomId: string,
  action: RoomAction,
): Promise<void> {
  await redis.zAdd(roomPendingKey(roomId), [
    { score: action.execAtMs, value: encodePendingAction(action) },
  ]);
  await redis.expire(roomPendingKey(roomId), PENDING_ACTIONS_TTL_SEC);
}

export async function getUpcomingPendingActions(
  redis: RedisClientType<any, any, any>,
  roomId: string,
  nowMs: number,
  limit: number,
): Promise<RoomAction[]> {
  const raw = await redis.zRangeByScore(roomPendingKey(roomId), nowMs + 1, "+inf", {
    LIMIT: { offset: 0, count: limit },
  });
  const actions = raw.map(decodePendingAction).filter(Boolean) as RoomAction[];
  actions.sort((a, b) => (a.execAtMs - b.execAtMs) || (a.seq - b.seq));
  return actions;
}

export async function advanceRoomStateToNow(args: {
  redis: RedisClientType<any, any, any>;
  supabaseAdmin: SupabaseClient;
  state: RoomState;
  nowMs: number;
}): Promise<RoomState> {
  const { redis, supabaseAdmin, nowMs } = args;
  const roomId = args.state.roomId;

  const due = await redis.zRangeByScore(roomPendingKey(roomId), "-inf", nowMs);
  if (due.length === 0) return args.state;

  const actions = due.map(decodePendingAction).filter(Boolean) as RoomAction[];
  actions.sort((a, b) => (a.execAtMs - b.execAtMs) || (a.seq - b.seq));

  // Remove due actions first (best-effort). If this fails, we'll still compute an advanced state.
  try {
    await redis.zRem(roomPendingKey(roomId), due);
  } catch {
    // ignore
  }

  let next = args.state;
  for (const a of actions) {
    if (a.seq <= next.seq) continue;
    next = {
      ...next,
      seq: a.seq,
      videoId: a.patch.videoId,
      playbackState: a.patch.playbackState,
      videoTimeAtRef: a.patch.videoTimeAtRef,
      referenceTimeMs: a.patch.referenceTimeMs,
      playbackRate: a.patch.playbackRate,
      audienceDelaySeconds: a.patch.audienceDelaySeconds,
      controllerUserId: a.patch.controllerUserId,
    };
  }

  // Persist advanced state (DB for durable snapshot; Redis for hot path).
  await setRoomStateToRedis(redis, next);
  await ensureRoomSeqAtLeast(redis, roomId, next.seq);
  await persistRoomStateToDb(supabaseAdmin, next);
  return next;
}

export function applyRoomCommand(args: {
  state: RoomState;
  command: RoomCommand;
  execAtMs: number;
  seq: number;
  defaults: { audienceDelaySecondsDefault: number };
}): RoomState {
  const { state, command, execAtMs } = args;
  const base: RoomState = { ...state, seq: args.seq };

  switch (command.type) {
    case "video:set": {
      const videoId = command.videoId;
      return {
        ...base,
        videoId,
        playbackState: videoId ? "playing" : "paused",
        playbackRate: 1,
        videoTimeAtRef: 0,
        referenceTimeMs: execAtMs,
        audienceDelaySeconds:
          base.audienceDelaySeconds ?? args.defaults.audienceDelaySecondsDefault,
      };
    }
    case "video:play": {
      const t = computeTimeAtMs(state, execAtMs);
      return { ...base, playbackState: "playing", videoTimeAtRef: t, referenceTimeMs: execAtMs };
    }
    case "video:pause": {
      const t = computeTimeAtMs(state, execAtMs);
      return { ...base, playbackState: "paused", videoTimeAtRef: t, referenceTimeMs: execAtMs };
    }
    case "video:seek": {
      const t = Math.max(0, command.positionSeconds);
      return { ...base, videoTimeAtRef: t, referenceTimeMs: execAtMs };
    }
    case "video:rate": {
      // When rate changes while playing, we reset the reference point so time math stays correct.
      const t = computeTimeAtMs(state, execAtMs);
      return { ...base, playbackRate: command.playbackRate, videoTimeAtRef: t, referenceTimeMs: execAtMs };
    }
    case "hand:raise": {
      return base;
    }
    default: {
      // Exhaustiveness
      return base;
    }
  }
}
