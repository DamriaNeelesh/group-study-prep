import { config as loadDotenv } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Server } from "socket.io";
import msgpackParser from "socket.io-msgpack-parser";
import { createClient } from "redis";
import { createAdapter } from "@socket.io/redis-streams-adapter";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import pino from "pino";

import { envInt, optionalEnv, requiredEnv } from "./env";
import { verifySupabaseJwt } from "./auth/verifySupabaseJwt";
import { makeNtpPong } from "./ntp/ntp";
import { consumeTokenBucket } from "./moderation/rateLimit";
import { createMetrics } from "./observability/metrics";
import { roomCommandSchema } from "./rooms/commands";
import type { RoomAction, RoomCommand } from "./rooms/commands";
import {
  addPendingAction,
  advanceRoomStateToNow,
  applyRoomCommand,
  getOrCreateRoomState,
  getUpcomingPendingActions,
  nextRoomSeq,
} from "./rooms/state";
import { isUuid } from "./util/uuid";
import { AccessToken, RoomServiceClient } from "livekit-server-sdk";

// Load repository root env first, then service-local env for unset values.
// We intentionally avoid overriding existing vars so blank entries in service .env
// do not wipe required values from the root .env.
const rootEnvPath = resolve(process.cwd(), "..", "..", ".env");
const serviceEnvPath = resolve(process.cwd(), ".env");
if (existsSync(rootEnvPath)) loadDotenv({ path: rootEnvPath, override: false });
if (existsSync(serviceEnvPath)) loadDotenv({ path: serviceEnvPath, override: false });

type SocketData = {
  userId: string;
  isAnonymous: boolean;
  roomId?: string;
  ip?: string;
  displayName?: string;
};

type ChatMessage = {
  id: string;
  roomId: string;
  userId: string;
  displayName: string;
  message: string;
  atMs: number;
};

type CallParticipant = {
  socketId: string;
  peerId: string;
  userId: string;
  displayName: string | null;
  camOn: boolean;
  micOn: boolean;
};

const log = pino({
  level: process.env.LOG_LEVEL || "info",
});

const PORT = envInt("PORT", 4000);

const REDIS_URL = requiredEnv("REDIS_URL");
const SUPABASE_URL = requiredEnv("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
const SUPABASE_JWT_SECRET = optionalEnv("SUPABASE_JWT_SECRET");

const SYNC_EXEC_BUFFER_MS = envInt("SYNC_EXEC_BUFFER_MS", 2000);
const SYNC_SEEK_BUFFER_MS = envInt("SYNC_SEEK_BUFFER_MS", 2500);
const AUDIENCE_DELAY_SECONDS_DEFAULT = envInt("AUDIENCE_DELAY_SECONDS_DEFAULT", 0);
const ROOM_MAX_STAGE = envInt("ROOM_MAX_STAGE", 20);
const ROOM_MAX_TABLE = envInt("ROOM_MAX_TABLE", 8);
const CHAT_MAX_MESSAGES = envInt("CHAT_MAX_MESSAGES", 120);
const CHAT_TTL_SEC = envInt("CHAT_TTL_SEC", 60 * 60 * 12);

const LIVEKIT_URL = optionalEnv("LIVEKIT_URL");
const LIVEKIT_API_KEY = optionalEnv("LIVEKIT_API_KEY");
const LIVEKIT_API_SECRET = optionalEnv("LIVEKIT_API_SECRET");

const metrics = createMetrics();

function roomSocketRoom(roomId: string) {
  return `room:${roomId}`;
}

function getClientIp(headers: Record<string, string | string[] | undefined>): string {
  const xf = headers["x-forwarded-for"];
  const val = Array.isArray(xf) ? xf[0] : xf;
  if (val && typeof val === "string") return val.split(",")[0]?.trim() || "unknown";
  return "unknown";
}

function parseBearer(authorization: unknown): string | null {
  if (typeof authorization !== "string") return null;
  const m = authorization.match(/^Bearer\s+(.+)$/i);
  return m?.[1] ?? null;
}

async function verifyToken(args: {
  token: string;
  jwtSecret?: string;
  supabaseAdmin: SupabaseClient;
}): Promise<{ userId: string; isAnonymous: boolean }> {
  if (args.jwtSecret) {
    try {
      return await verifySupabaseJwt({ token: args.token, jwtSecret: args.jwtSecret });
    } catch (e) {
      // Local JWT verification is a performance optimization. If it fails (e.g. secret mismatch),
      // fall back to Supabase Auth validation so we don't hard-brick the realtime service.
      log.warn({ err: e }, "local JWT verify failed; falling back to supabase auth.getUser()");
    }
  }

  // Fallback (higher latency): ask Supabase Auth to validate token.
  const { data, error } = await args.supabaseAdmin.auth.getUser(args.token);
  if (error) throw new Error(error.message);
  const user = data.user;
  if (!user) throw new Error("unauthorized");
  return { userId: user.id, isAnonymous: Boolean((user as unknown as { is_anonymous?: boolean }).is_anonymous) };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

function sanitizeIdPart(id: unknown): string {
  if (typeof id !== "string") return "";
  return id.trim().replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
}

function sanitizeDisplayName(name: unknown): string | null {
  if (typeof name !== "string") return null;
  const trimmed = name.trim();
  if (!trimmed) return null;
  const cleaned = trimmed
    .replace(/\s+/g, " ")
    // remove control chars
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .slice(0, 64);
  return cleaned.length > 0 ? cleaned : null;
}

function defaultParticipantName(userId: string, isAnonymous: boolean): string {
  const short = userId.slice(0, 8);
  return isAnonymous ? `Guest ${short}` : `Student ${short}`;
}

function sanitizeChatMessage(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const cleaned = input
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 500);
  return cleaned.length > 0 ? cleaned : null;
}

function createChatId() {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function livekitParticipantIdentity(userId: string, identitySuffix: string, socketId: string): string {
  const suffix = identitySuffix || socketId;
  // LiveKit requires identity to be unique per room; userId alone breaks multi-device joins.
  return `${userId}:${suffix}`;
}

async function handleHttp(req: IncomingMessage, res: ServerResponse) {
  const url = req.url || "/";
  if (url.startsWith("/healthz")) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  if (url.startsWith("/metrics")) {
    res.writeHead(200, { "content-type": metrics.registry.contentType });
    res.end(await metrics.registry.metrics());
    return;
  }

  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "not_found" }));
}

async function main() {
  const httpServer = createServer(handleHttp);

  const io = new Server(httpServer, {
    parser: msgpackParser,
    cors: {
      origin: process.env.CORS_ORIGIN?.split(",").map((s) => s.trim()) ?? "*",
      methods: ["GET", "POST"],
    },
    connectionStateRecovery: {
      maxDisconnectionDuration: envInt("SOCKET_RECOVERY_MS", 2 * 60 * 1000),
      skipMiddlewares: true,
    },
    pingInterval: envInt("SOCKET_PING_INTERVAL_MS", 25000),
    pingTimeout: envInt("SOCKET_PING_TIMEOUT_MS", 20000),
  });

  const redis = createClient({ url: REDIS_URL });
  redis.on("error", (e) => log.error({ err: e }, "redis error"));
  await redis.connect();

  const redisForAdapter = redis.duplicate();
  redisForAdapter.on("error", (e) => log.error({ err: e }, "redis(adapter) error"));
  await redisForAdapter.connect();

  io.adapter(createAdapter(redisForAdapter));

  const supabaseAdmin = createSupabaseClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const livekitConfigured = Boolean(LIVEKIT_URL && LIVEKIT_API_KEY && LIVEKIT_API_SECRET);
  const livekitRoomService = livekitConfigured
    ? new RoomServiceClient(LIVEKIT_URL as string, LIVEKIT_API_KEY as string, LIVEKIT_API_SECRET as string)
    : null;

  const roomAdvanceTimers = new Map<string, NodeJS.Timeout>();
  const roomCreateUserId = new Map<string, string>();
  const callRooms = new Map<string, Map<string, CallParticipant>>();
  const callMembershipBySocketId = new Map<string, { roomId: string; peerId: string }>();
  const allowedCallSignalEvents = new Set([
    "webrtc:offer",
    "webrtc:answer",
    "webrtc:candidate",
    "webrtc:renegotiate",
  ]);

  const pendingKey = (roomId: string) => `room:pending:${roomId}`;
  const lockKey = (roomId: string) => `lock:roomAdvance:${roomId}`;
  const chatKey = (roomId: string) => `room:chat:${roomId}`;

  function emitCallPresence(roomId: string) {
    const room = callRooms.get(roomId);
    const participants = room
      ? Array.from(room.values()).map((p) => ({
          peerId: p.peerId,
          userId: p.userId,
          displayName: p.displayName,
          camOn: p.camOn,
          micOn: p.micOn,
          connections: 1,
        }))
      : [];
    io.to(roomSocketRoom(roomId)).emit("call:presence", { roomId, participants });
  }

  async function loadChatHistory(roomId: string): Promise<ChatMessage[]> {
    const items = await redis.lRange(chatKey(roomId), -CHAT_MAX_MESSAGES, -1);
    const parsed = items
      .map((raw) => {
        try {
          const v = JSON.parse(raw) as Partial<ChatMessage>;
          if (
            !v ||
            typeof v !== "object" ||
            typeof v.id !== "string" ||
            typeof v.userId !== "string" ||
            typeof v.roomId !== "string" ||
            typeof v.displayName !== "string" ||
            typeof v.message !== "string" ||
            typeof v.atMs !== "number"
          ) {
            return null;
          }
          return {
            id: v.id,
            userId: v.userId,
            roomId: v.roomId,
            displayName: v.displayName,
            message: v.message,
            atMs: v.atMs,
          } satisfies ChatMessage;
        } catch {
          return null;
        }
      })
      .filter(Boolean) as ChatMessage[];

    parsed.sort((a, b) => a.atMs - b.atMs);
    return parsed;
  }

  async function appendChatMessage(roomId: string, message: ChatMessage) {
    const key = chatKey(roomId);
    await redis.rPush(key, JSON.stringify(message));
    await redis.lTrim(key, -CHAT_MAX_MESSAGES, -1);
    await redis.expire(key, CHAT_TTL_SEC);
  }

  async function scheduleNextRoomAdvance(roomId: string) {
    const existing = roomAdvanceTimers.get(roomId);
    if (existing) {
      clearTimeout(existing);
      roomAdvanceTimers.delete(roomId);
    }

    let nextDueAtMs = 0;
    try {
      const next = await redis.zRangeWithScores(pendingKey(roomId), 0, 0);
      nextDueAtMs = next?.[0]?.score ?? 0;
    } catch (e) {
      log.warn({ err: e, roomId }, "scheduleNextRoomAdvance: failed to read pending actions");
      return;
    }

    if (!nextDueAtMs || !Number.isFinite(nextDueAtMs)) return;

    const delayMs = Math.max(0, nextDueAtMs - Date.now());
    const timer = setTimeout(() => {
      void (async () => {
        roomAdvanceTimers.delete(roomId);

        // Best-effort cross-node lock to reduce duplicate DB writes.
        try {
          const locked = await redis.set(lockKey(roomId), String(Date.now()), { NX: true, PX: 5000 });
          if (!locked) {
            await scheduleNextRoomAdvance(roomId);
            return;
          }
        } catch {
          // ignore lock failure; proceed
        }

        try {
          const userIdForCreate = roomCreateUserId.get(roomId);
          if (!userIdForCreate) {
            // No known user to attribute a create; this should not happen in normal flow.
            await scheduleNextRoomAdvance(roomId);
            return;
          }

          const base = await getOrCreateRoomState(redis, supabaseAdmin, roomId, userIdForCreate);
          await advanceRoomStateToNow({
            redis,
            supabaseAdmin,
            state: base,
            nowMs: Date.now(),
          });
        } catch (e) {
          log.warn({ err: e, roomId }, "room advance failed");
        } finally {
          await scheduleNextRoomAdvance(roomId);
        }
      })();
    }, delayMs);

    roomAdvanceTimers.set(roomId, timer);
  }

  // Basic connection storm limiter (best-effort; tune for production)
  io.use(async (socket, next) => {
    const nowMs = Date.now();
    const ip = getClientIp(socket.handshake.headers as Record<string, string | string[] | undefined>);
    const authPayload = isRecord(socket.handshake.auth) ? socket.handshake.auth : {};
    try {
      const rl = await consumeTokenBucket(redis, `rl:conn:${ip}`, {
        nowMs,
        capacity: envInt("RL_CONN_CAPACITY", 30),
        refillPerSec: envInt("RL_CONN_REFILL_PER_SEC", 10),
        ttlMs: 60_000,
      });

      if (!rl.allowed) {
        metrics.connectionsTotal.inc({ result: "rate_limited" });
        return next(new Error(`rate_limited:${rl.retryAfterMs}`));
      }
    } catch (e) {
      log.warn({ err: e }, "rate limit check failed");
      // allow if rate limiter is unavailable
    }

    const token =
      (socket.handshake.auth as { token?: unknown } | undefined)?.token ||
      parseBearer(socket.handshake.headers.authorization);

    if (!token || typeof token !== "string") {
      metrics.connectionsTotal.inc({ result: "no_token" });
      return next(new Error("unauthorized"));
    }

    const t0 = Date.now();
    try {
      const verified = await verifyToken({ token, jwtSecret: SUPABASE_JWT_SECRET, supabaseAdmin });
      metrics.authVerifyDurationMs.observe(Date.now() - t0);
      socket.data.userId = verified.userId;
      socket.data.isAnonymous = verified.isAnonymous;
      socket.data.ip = ip;
      socket.data.displayName = sanitizeDisplayName(authPayload.displayName) ?? undefined;
      metrics.connectionsTotal.inc({ result: "ok" });
      return next();
    } catch (e) {
      metrics.connectionsTotal.inc({ result: "bad_token" });
      return next(new Error("unauthorized"));
    }
  });

  const presenceDirtyRooms = new Set<string>();
  const PRESENCE_HASH_TTL_SEC = 60 * 20;
  const presenceKey = (roomId: string) => `presence:${roomId}`;

  async function markPresenceDirty(roomId: string) {
    presenceDirtyRooms.add(roomId);
  }

  async function incrementPresence(roomId: string, userId: string) {
    const key = presenceKey(roomId);
    await redis.hIncrBy(key, userId, 1);
    await redis.expire(key, PRESENCE_HASH_TTL_SEC);
    await markPresenceDirty(roomId);
  }

  async function decrementPresence(roomId: string, userId: string) {
    const key = presenceKey(roomId);
    const next = await redis.hIncrBy(key, userId, -1);
    if (typeof next === "number" ? next <= 0 : Number(next) <= 0) {
      await redis.hDel(key, userId);
    }
    await redis.expire(key, PRESENCE_HASH_TTL_SEC);
    await markPresenceDirty(roomId);
  }

  // Throttled presence broadcasts so join/leave storms don't fan out immediately.
  setInterval(() => {
    const roomIds = Array.from(presenceDirtyRooms.values());
    presenceDirtyRooms.clear();
    void (async () => {
      for (const roomId of roomIds) {
        try {
          const onlineCount = await redis.hLen(presenceKey(roomId));
          io.to(roomSocketRoom(roomId)).emit("presence:update", { roomId, onlineCount });
        } catch (e) {
          log.warn({ err: e }, "presence broadcast failed");
        }
      }
    })();
  }, envInt("PRESENCE_BROADCAST_EVERY_MS", 2000));

  io.on("connection", (socket) => {
    metrics.socketsConnected.set(io.engine.clientsCount);

    function leaveCallRoom() {
      const membership = callMembershipBySocketId.get(socket.id);
      if (!membership) return;
      callMembershipBySocketId.delete(socket.id);

      const room = callRooms.get(membership.roomId);
      if (!room) return;

      room.delete(membership.peerId);
      if (room.size === 0) callRooms.delete(membership.roomId);

      emitCallPresence(membership.roomId);
    }

    socket.on("disconnect", () => {
      metrics.socketsConnected.set(io.engine.clientsCount);
      leaveCallRoom();
      const roomId = socket.data.roomId;
      const userId = socket.data.userId;
      if (roomId && userId) void decrementPresence(roomId, userId);
      socket.data.roomId = undefined;
    });

    socket.on("ntp:ping", (payload: unknown, ack?: (pong: unknown) => void) => {
      const t0 = (payload as { t0?: unknown } | null)?.t0;
      const pingT0 = typeof t0 === "number" ? t0 : Date.now();
      const nowMs = Date.now();
      const pong = makeNtpPong({ t0: pingT0 }, nowMs);
      if (typeof ack === "function") ack(pong);
      else socket.emit("ntp:pong", pong);
    });

    socket.on("room:join", async (payload: unknown, ack?: (res: unknown) => void) => {
      const p = isRecord(payload) ? payload : {};
      const roomId = String(p.roomId ?? "");
      if (!isUuid(roomId)) {
        if (typeof ack === "function") ack({ ok: false, error: "invalid_room_id" });
        return;
      }

      const displayName = sanitizeDisplayName(p.displayName);
      if (displayName) socket.data.displayName = displayName;

      const userId = socket.data.userId;
      roomCreateUserId.set(roomId, userId);
      const prevRoomId = socket.data.roomId;
      if (prevRoomId && prevRoomId !== roomId) {
        socket.leave(roomSocketRoom(prevRoomId));
        void decrementPresence(prevRoomId, userId);
      }

      socket.data.roomId = roomId;
      socket.join(roomSocketRoom(roomId));
      await incrementPresence(roomId, userId);

      const t0 = Date.now();
      try {
        const base = await getOrCreateRoomState(redis, supabaseAdmin, roomId, userId);
        const state = await advanceRoomStateToNow({
          redis,
          supabaseAdmin,
          state: base,
          nowMs: Date.now(),
        });
        const pending = await getUpcomingPendingActions(redis, roomId, Date.now(), 5);
        const chat = await loadChatHistory(roomId);
        void scheduleNextRoomAdvance(roomId);
        metrics.roomStateFetchDurationMs.observe(Date.now() - t0);

        const onlineCount = await redis.hLen(presenceKey(roomId));
        if (typeof ack === "function") {
          ack({ ok: true, state, pending, onlineCount, chat });
        } else {
          socket.emit("room:state", { ok: true, state, pending, onlineCount, chat });
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        log.warn({ err: e, roomId }, "room:join failed");
        if (typeof ack === "function") ack({ ok: false, error: msg });
      }
    });

    socket.on("room:state:request", async (_payload: unknown, ack?: (res: unknown) => void) => {
      const roomId = socket.data.roomId;
      if (!roomId) {
        if (typeof ack === "function") ack({ ok: false, error: "not_in_room" });
        return;
      }

      try {
        const base = await getOrCreateRoomState(redis, supabaseAdmin, roomId, socket.data.userId);
        const state = await advanceRoomStateToNow({
          redis,
          supabaseAdmin,
          state: base,
          nowMs: Date.now(),
        });
        const pending = await getUpcomingPendingActions(redis, roomId, Date.now(), 5);
        const chat = await loadChatHistory(roomId);
        void scheduleNextRoomAdvance(roomId);
        const onlineCount = await redis.hLen(presenceKey(roomId));
        if (typeof ack === "function") ack({ ok: true, state, pending, onlineCount, chat });
        else socket.emit("room:state", { ok: true, state, pending, onlineCount, chat });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (typeof ack === "function") ack({ ok: false, error: msg });
      }
    });

    socket.on("room:command", async (payload: unknown, ack?: (res: unknown) => void) => {
      const parsed = (() => {
        try {
          return roomCommandSchema.safeParse((payload as { command?: unknown })?.command);
        } catch {
          return { success: false } as const;
        }
      })();
      if (!parsed.success) {
        if (typeof ack === "function") ack({ ok: false, error: "invalid_command" });
        return;
      }

      const roomId = socket.data.roomId;
      if (!roomId) {
        if (typeof ack === "function") ack({ ok: false, error: "not_in_room" });
        return;
      }

      const userId = socket.data.userId;
      const command = parsed.data as RoomCommand;

      // Command rate limiting (per room+user)
      try {
        const rl = await consumeTokenBucket(redis, `rl:cmd:${roomId}:${userId}`, {
          nowMs: Date.now(),
          capacity: envInt("RL_CMD_CAPACITY", 12),
          refillPerSec: envInt("RL_CMD_REFILL_PER_SEC", 6),
          ttlMs: 30_000,
        });
        if (!rl.allowed) {
          if (typeof ack === "function") ack({ ok: false, error: "rate_limited", retryAfterMs: rl.retryAfterMs });
          return;
        }
      } catch {
        // ignore
      }

      // Raise-hand is non-authoritative and not scheduled.
      if (command.type === "hand:raise") {
        io.to(roomSocketRoom(roomId)).emit("room:hand", {
          roomId,
          fromUserId: userId,
          at: new Date().toISOString(),
        });
        if (typeof ack === "function") ack({ ok: true });
        return;
      }

      const t0 = Date.now();
      try {
        const base = await getOrCreateRoomState(redis, supabaseAdmin, roomId, userId);
        const state = await advanceRoomStateToNow({
          redis,
          supabaseAdmin,
          state: base,
          nowMs: Date.now(),
        });

        const bufferMs =
          command.type === "video:seek" || command.type === "video:set"
            ? SYNC_SEEK_BUFFER_MS
            : SYNC_EXEC_BUFFER_MS;
        const serverNowMs = Date.now();
        const execAtMs = serverNowMs + bufferMs;
        const seq = await nextRoomSeq(redis, roomId);

        const next = applyRoomCommand({
          state,
          command,
          execAtMs,
          seq,
          defaults: { audienceDelaySecondsDefault: AUDIENCE_DELAY_SECONDS_DEFAULT },
        });

        const action: RoomAction = {
          seq,
          execAtMs,
          serverNowMs,
          command,
          patch: {
            videoId: next.videoId,
            playbackState: next.playbackState,
            videoTimeAtRef: next.videoTimeAtRef,
            referenceTimeMs: next.referenceTimeMs,
            playbackRate: next.playbackRate,
            audienceDelaySeconds: next.audienceDelaySeconds,
            controllerUserId: next.controllerUserId,
          },
        };

        await addPendingAction(redis, roomId, action);
        void scheduleNextRoomAdvance(roomId);
        metrics.commandsTotal.inc({ type: command.type });

        io.to(roomSocketRoom(roomId)).emit("room:action", action);
        metrics.roomStateFetchDurationMs.observe(Date.now() - t0);

        if (typeof ack === "function") ack({ ok: true, action });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        log.warn({ err: e, roomId, command }, "room:command failed");
        if (typeof ack === "function") ack({ ok: false, error: msg });
      }
    });

    socket.on("chat:send", async (payload: unknown, ack?: (res: unknown) => void) => {
      const roomId = socket.data.roomId;
      const userId = socket.data.userId;
      if (!roomId || !userId) {
        if (typeof ack === "function") ack({ ok: false, error: "not_in_room" });
        return;
      }

      try {
        const rl = await consumeTokenBucket(redis, `rl:chat:${roomId}:${userId}`, {
          nowMs: Date.now(),
          capacity: envInt("RL_CHAT_CAPACITY", 10),
          refillPerSec: envInt("RL_CHAT_REFILL_PER_SEC", 3),
          ttlMs: 30_000,
        });
        if (!rl.allowed) {
          if (typeof ack === "function") ack({ ok: false, error: "rate_limited", retryAfterMs: rl.retryAfterMs });
          return;
        }
      } catch {
        // ignore
      }

      const p = isRecord(payload) ? payload : {};
      const messageText = sanitizeChatMessage(p.message);
      if (!messageText) {
        if (typeof ack === "function") ack({ ok: false, error: "invalid_message" });
        return;
      }

      const nameFromPayload = sanitizeDisplayName(p.displayName);
      const displayName =
        nameFromPayload ||
        socket.data.displayName ||
        defaultParticipantName(userId, socket.data.isAnonymous);

      if (nameFromPayload) socket.data.displayName = nameFromPayload;

      const message: ChatMessage = {
        id: createChatId(),
        roomId,
        userId,
        displayName,
        message: messageText,
        atMs: Date.now(),
      };

      try {
        await appendChatMessage(roomId, message);
      } catch (e) {
        log.warn({ err: e, roomId }, "chat append failed");
      }

      io.to(roomSocketRoom(roomId)).emit("chat:message", message);
      if (typeof ack === "function") ack({ ok: true, message });
    });

    socket.on("call:join", (payload: unknown, ack?: (res: unknown) => void) => {
      const p = isRecord(payload) ? payload : {};
      const roomId = String(p.roomId ?? "");
      const peerId = sanitizeIdPart(p.peerId);
      if (!isUuid(roomId) || !peerId) {
        if (typeof ack === "function") ack({ ok: false, error: "invalid_call_join" });
        return;
      }

      // Ensure one active call membership per socket.
      const prev = callMembershipBySocketId.get(socket.id);
      if (prev && (prev.roomId !== roomId || prev.peerId !== peerId)) {
        leaveCallRoom();
      }

      const displayName =
        sanitizeDisplayName(p.displayName) ??
        socket.data.displayName ??
        defaultParticipantName(socket.data.userId, socket.data.isAnonymous);

      const camOn = Boolean(p.camOn);
      const micOn = Boolean(p.micOn);

      let room = callRooms.get(roomId);
      if (!room) {
        room = new Map<string, CallParticipant>();
        callRooms.set(roomId, room);
      }

      room.set(peerId, {
        socketId: socket.id,
        peerId,
        userId: socket.data.userId,
        displayName,
        camOn,
        micOn,
      });
      callMembershipBySocketId.set(socket.id, { roomId, peerId });
      socket.join(roomSocketRoom(roomId));

      emitCallPresence(roomId);
      if (typeof ack === "function") ack({ ok: true });
    });

    socket.on("call:leave", (_payload: unknown, ack?: (res: unknown) => void) => {
      leaveCallRoom();
      if (typeof ack === "function") ack({ ok: true });
    });

    socket.on("call:presence:update", (payload: unknown, ack?: (res: unknown) => void) => {
      const membership = callMembershipBySocketId.get(socket.id);
      if (!membership) {
        if (typeof ack === "function") ack({ ok: false, error: "not_in_call" });
        return;
      }

      const room = callRooms.get(membership.roomId);
      const current = room?.get(membership.peerId);
      if (!room || !current) {
        if (typeof ack === "function") ack({ ok: false, error: "not_in_call" });
        return;
      }

      const p = isRecord(payload) ? payload : {};
      const nextDisplay = sanitizeDisplayName(p.displayName);
      if (nextDisplay) current.displayName = nextDisplay;
      if ("camOn" in p) current.camOn = Boolean(p.camOn);
      if ("micOn" in p) current.micOn = Boolean(p.micOn);
      room.set(membership.peerId, current);

      emitCallPresence(membership.roomId);
      if (typeof ack === "function") ack({ ok: true });
    });

    socket.on("call:signal", (payload: unknown, ack?: (res: unknown) => void) => {
      const membership = callMembershipBySocketId.get(socket.id);
      if (!membership) {
        if (typeof ack === "function") ack({ ok: false, error: "not_in_call" });
        return;
      }

      const p = isRecord(payload) ? payload : {};
      const event = String(p.event ?? "");
      const signalPayload = isRecord(p.payload) ? p.payload : {};
      const toPeerId = sanitizeIdPart(signalPayload.toPeerId);

      if (!allowedCallSignalEvents.has(event) || !toPeerId) {
        if (typeof ack === "function") ack({ ok: false, error: "invalid_signal" });
        return;
      }

      const room = callRooms.get(membership.roomId);
      const target = room?.get(toPeerId);
      if (!room || !target) {
        if (typeof ack === "function") ack({ ok: false, error: "peer_not_found" });
        return;
      }

      io.to(target.socketId).emit("call:signal", {
        event,
        payload: {
          ...signalPayload,
          roomId: membership.roomId,
          fromPeerId: membership.peerId,
          fromUserId: socket.data.userId,
          toPeerId,
        },
      });
      if (typeof ack === "function") ack({ ok: true });
    });

    socket.on("stage:token", async (payload: unknown, ack?: (res: unknown) => void) => {
      const roomId = socket.data.roomId;
      const userId = socket.data.userId;
      if (!roomId || !userId) {
        if (typeof ack === "function") ack({ ok: false, error: "not_in_room" });
        return;
      }
      if (!livekitConfigured || !livekitRoomService) {
        if (typeof ack === "function") ack({ ok: false, error: "livekit_not_configured" });
        return;
      }

      try {
        // Host (created_by) always allowed. Otherwise require stage role.
        const { data: roomRow, error: roomError } = await supabaseAdmin
          .from("rooms")
          .select("created_by")
          .eq("id", roomId)
          .maybeSingle();
        if (roomError) throw new Error(roomError.message);

        const createdBy = (roomRow as any)?.created_by as string | undefined;
        let allowed = Boolean(createdBy && createdBy === userId);

        if (!allowed) {
          const { data: roleRow, error: roleError } = await supabaseAdmin
            .from("room_stage_roles")
            .select("role")
            .eq("room_id", roomId)
            .eq("user_id", userId)
            .maybeSingle();

          if (!roleError) {
            const role = (roleRow as any)?.role as string | undefined;
            allowed = role === "host" || role === "speaker";
          }
        }

        if (!allowed) {
          if (typeof ack === "function") ack({ ok: false, error: "forbidden" });
          return;
        }

        const stageRoomName = `stage:${roomId}`;

        // Enforce cap (best-effort).
        try {
          const participants = await livekitRoomService.listParticipants(stageRoomName);
          if ((participants?.length ?? 0) >= ROOM_MAX_STAGE) {
            if (typeof ack === "function") ack({ ok: false, error: "stage_full" });
            return;
          }
        } catch {
          // If room doesn't exist yet, listParticipants may fail; allow.
        }

        const p = isRecord(payload) ? payload : {};
        const displayName = sanitizeDisplayName(p.displayName);
        const tabId = sanitizeIdPart(p.tabId);
        const clientId = sanitizeIdPart(p.clientId);
        const identitySuffix = tabId || clientId || socket.id;

        const token = new AccessToken(LIVEKIT_API_KEY as string, LIVEKIT_API_SECRET as string, {
          identity: livekitParticipantIdentity(userId, identitySuffix, socket.id),
          name: displayName ?? defaultParticipantName(userId, socket.data.isAnonymous),
          metadata: JSON.stringify({ userId, roomId, kind: "stage" }),
        });
        token.addGrant({
          roomJoin: true,
          room: stageRoomName,
          canPublish: true,
          canSubscribe: true,
          canPublishData: true,
        });

        const jwt = token.toJwt();
        if (typeof ack === "function") ack({ ok: true, token: jwt, url: LIVEKIT_URL, room: stageRoomName });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (typeof ack === "function") ack({ ok: false, error: msg });
      }
    });

    socket.on("table:token", async (payload: unknown, ack?: (res: unknown) => void) => {
      const roomId = socket.data.roomId;
      const userId = socket.data.userId;
      if (!roomId || !userId) {
        if (typeof ack === "function") ack({ ok: false, error: "not_in_room" });
        return;
      }
      if (!livekitConfigured || !livekitRoomService) {
        if (typeof ack === "function") ack({ ok: false, error: "livekit_not_configured" });
        return;
      }

      const p = isRecord(payload) ? payload : {};
      const rawTableId = String(p.tableId ?? "").trim();
      const tableId = rawTableId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 16);
      if (!tableId) {
        if (typeof ack === "function") ack({ ok: false, error: "invalid_table" });
        return;
      }

      try {
        const tableRoomName = `table:${roomId}:${tableId}`;

        try {
          const participants = await livekitRoomService.listParticipants(tableRoomName);
          if ((participants?.length ?? 0) >= ROOM_MAX_TABLE) {
            if (typeof ack === "function") ack({ ok: false, error: "table_full" });
            return;
          }
        } catch {
          // allow if room doesn't exist yet
        }

        const displayName = sanitizeDisplayName(p.displayName);
        const tabId = sanitizeIdPart(p.tabId);
        const clientId = sanitizeIdPart(p.clientId);
        const identitySuffix = tabId || clientId || socket.id;

        const token = new AccessToken(LIVEKIT_API_KEY as string, LIVEKIT_API_SECRET as string, {
          identity: livekitParticipantIdentity(userId, identitySuffix, socket.id),
          name: displayName ?? defaultParticipantName(userId, socket.data.isAnonymous),
          metadata: JSON.stringify({ userId, roomId, kind: "table", tableId }),
        });
        token.addGrant({
          roomJoin: true,
          room: tableRoomName,
          canPublish: true,
          canSubscribe: true,
          canPublishData: true,
        });

        const jwt = token.toJwt();
        if (typeof ack === "function") ack({ ok: true, token: jwt, url: LIVEKIT_URL, room: tableRoomName });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (typeof ack === "function") ack({ ok: false, error: msg });
      }
    });
  });

  httpServer.listen(PORT, () => {
    log.info({ port: PORT }, "realtime service listening");
  });
}

main().catch((e) => {
  log.error({ err: e }, "fatal");
  process.exit(1);
});
