"use client";

import type {
  RealtimeChannel,
  RealtimePresenceState,
} from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export type RoomRow = {
  id: string;
  name: string;
  current_video_id: string | null;
  is_paused: boolean;
  playback_position_seconds: number;
  playback_rate: number;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type RoomState = {
  id: string;
  name: string;
  currentVideoId: string | null;
  isPaused: boolean;
  playbackPositionSeconds: number;
  playbackRate: number;
  updatedAt: string;
  createdBy: string;
};

export type PresenceMeta = {
  userId: string;
  displayName: string | null;
  handRaised: boolean;
};

export type PresenceUser = PresenceMeta & {
  connections: number;
};

type UseRoomSyncState = {
  isReady: boolean;
  error: string | null;
  room: RoomState | null;
  presence: PresenceUser[];
  lastRaiseHand: { fromUserId: string; at: string } | null;
  toast: string | null;
  channel: RealtimeChannel | null;
};

function mapRoomRow(row: RoomRow): RoomState {
  return {
    id: row.id,
    name: row.name,
    currentVideoId: row.current_video_id,
    isPaused: row.is_paused,
    playbackPositionSeconds: row.playback_position_seconds,
    playbackRate: row.playback_rate,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
  };
}

function presenceUsersFromState(state: RealtimePresenceState<PresenceMeta>) {
  const users: PresenceUser[] = [];
  for (const [key, metas] of Object.entries(state)) {
    const meta = metas[0];
    users.push({
      userId: meta?.userId ?? key,
      displayName: meta?.displayName ?? null,
      handRaised: Boolean(meta?.handRaised),
      connections: metas.length,
    });
  }
  users.sort((a, b) => a.userId.localeCompare(b.userId));
  return users;
}

export function useRoomSync(args: {
  roomId: string;
  userId: string | null;
  displayName: string;
}) {
  const roomId = args.roomId;
  const userId = args.userId;
  const displayName = args.displayName;

  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const missingEnvError = supabase
    ? null
    : "Missing env: NEXT_PUBLIC_SUPABASE_URL and/or NEXT_PUBLIC_SUPABASE_ANON_KEY";
  const [state, setState] = useState<UseRoomSyncState>({
    isReady: false,
    error: missingEnvError,
    room: null,
    presence: [],
    lastRaiseHand: null,
    toast: null,
    channel: null,
  });

  const presenceMetaRef = useRef<PresenceMeta | null>(null);
  const roomCreatedByRef = useRef<string | null>(null);
  const [nowMs, setNowMs] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    roomCreatedByRef.current = state.room?.createdBy ?? null;
  }, [state.room?.createdBy]);

  const resyncRoom = useCallback(async () => {
    if (!roomId || !userId) return;
    if (!supabase) return;

    const { data, error } = await supabase
      .from("rooms")
      .select("*")
      .eq("id", roomId)
      .maybeSingle();

    if (error) {
      setState((s) => ({ ...s, error: error.message }));
      return;
    }

    if (!data) {
      const { data: inserted, error: insertError } = await supabase
        .from("rooms")
        .insert({ id: roomId })
        .select("*")
        .single();

      if (insertError) {
        setState((s) => ({ ...s, error: insertError.message }));
        return;
      }

      setState((s) => ({ ...s, room: mapRoomRow(inserted as RoomRow) }));
      return;
    }

    setState((s) => ({ ...s, room: mapRoomRow(data as RoomRow) }));
  }, [roomId, supabase, userId]);

  const updatePresence = useCallback(
    async (patch: Partial<PresenceMeta>) => {
      const channel = state.channel;
      if (!channel) return;

      const meta = presenceMetaRef.current;
      if (!meta) return;

      const next = { ...meta, ...patch };
      presenceMetaRef.current = next;
      await channel.track(next);
    },
    [state.channel],
  );

  const sendRoomEvent = useCallback(
    async (
      event:
        | "video:set"
        | "video:play"
        | "video:pause"
        | "video:seek"
        | "video:sync",
      payload: Record<string, unknown>,
    ) => {
      const channel = state.channel;
      if (!channel) return;
      await channel.send({
        type: "broadcast",
        event,
        payload,
      });
    },
    [state.channel],
  );

  const updateRoomRow = useCallback(
    async (patch: Partial<RoomRow>): Promise<RoomState | null> => {
      if (!roomId) return null;
      if (!supabase) return null;

      const { data, error } = await supabase
        .from("rooms")
        .update(patch)
        .eq("id", roomId)
        .select("*")
        .single();

      if (error) {
        setState((s) => ({ ...s, error: error.message }));
        return null;
      }

      const next = mapRoomRow(data as RoomRow);
      setState((s) => ({ ...s, room: next }));
      return next;
    },
    [roomId, supabase],
  );

  const setVideo = useCallback(
    async (videoId: string | null) => {
      if (!roomId || !userId) return;
      const at = new Date().toISOString();

      const next = await updateRoomRow({
        current_video_id: videoId,
        is_paused: videoId ? false : true,
        playback_position_seconds: 0,
        playback_rate: 1,
      });
      if (!next) return;

      await sendRoomEvent("video:set", {
        roomId,
        userId,
        at,
        videoId: next.currentVideoId,
        isPaused: next.isPaused,
        positionSeconds: next.playbackPositionSeconds,
        playbackRate: next.playbackRate,
        updatedAt: next.updatedAt,
      });
    },
    [roomId, sendRoomEvent, updateRoomRow, userId],
  );

  const play = useCallback(
    async (positionSeconds: number) => {
      if (!roomId || !userId) return;
      const at = new Date().toISOString();

      const next = await updateRoomRow({
        is_paused: false,
        playback_position_seconds: positionSeconds,
      });
      if (!next) return;

      await sendRoomEvent("video:play", {
        roomId,
        userId,
        at,
        videoId: next.currentVideoId,
        isPaused: next.isPaused,
        positionSeconds: next.playbackPositionSeconds,
        playbackRate: next.playbackRate,
        updatedAt: next.updatedAt,
      });
    },
    [roomId, sendRoomEvent, updateRoomRow, userId],
  );

  const pause = useCallback(
    async (positionSeconds: number) => {
      if (!roomId || !userId) return;
      const at = new Date().toISOString();

      const next = await updateRoomRow({
        is_paused: true,
        playback_position_seconds: positionSeconds,
      });
      if (!next) return;

      await sendRoomEvent("video:pause", {
        roomId,
        userId,
        at,
        videoId: next.currentVideoId,
        isPaused: next.isPaused,
        positionSeconds: next.playbackPositionSeconds,
        playbackRate: next.playbackRate,
        updatedAt: next.updatedAt,
      });
    },
    [roomId, sendRoomEvent, updateRoomRow, userId],
  );

  const seek = useCallback(
    async (positionSeconds: number) => {
      if (!roomId || !userId) return;
      const at = new Date().toISOString();

      const next = await updateRoomRow({
        playback_position_seconds: positionSeconds,
      });
      if (!next) return;

      await sendRoomEvent("video:seek", {
        roomId,
        userId,
        at,
        videoId: next.currentVideoId,
        isPaused: next.isPaused,
        positionSeconds: next.playbackPositionSeconds,
        playbackRate: next.playbackRate,
        updatedAt: next.updatedAt,
      });
    },
    [roomId, sendRoomEvent, updateRoomRow, userId],
  );

  const raiseHand = useCallback(async () => {
    if (!roomId || !userId) return;
    const at = new Date().toISOString();

    await state.channel?.send({
      type: "broadcast",
      event: "raise-hand",
      payload: { roomId, userId, at },
    });
    await updatePresence({ handRaised: true });
    // Local UI uses the broadcast for toasts; presence keeps the "raised" badge.
  }, [roomId, state.channel, updatePresence, userId]);

  // Expose an "effective" playback position: if playing, advance based on `updated_at`.
  const effectivePlaybackPositionSeconds = useMemo(() => {
    const room = state.room;
    if (!room) return 0;
    if (room.isPaused) return room.playbackPositionSeconds;
    const updatedAtMs = new Date(room.updatedAt).getTime();
    if (!Number.isFinite(updatedAtMs)) return room.playbackPositionSeconds;
    if (!nowMs) return room.playbackPositionSeconds;
    const deltaSeconds = Math.max(0, (nowMs - updatedAtMs) / 1000);
    return Math.max(
      0,
      room.playbackPositionSeconds + deltaSeconds * room.playbackRate,
    );
  }, [nowMs, state.room]);

  useEffect(() => {
    if (!roomId || !userId) return;
    if (!supabase) return;

    const channel = supabase.channel(`room:${roomId}`, {
      config: {
        broadcast: { self: false },
        presence: { key: userId },
      },
    });

    presenceMetaRef.current = {
      userId,
      displayName: null,
      handRaised: false,
    };

    channel
      .on("presence", { event: "sync" }, () => {
        const p = presenceUsersFromState(
          channel.presenceState() as RealtimePresenceState<PresenceMeta>,
        );
        setState((s) => ({ ...s, presence: p }));
      })
      .on("presence", { event: "join" }, () => {
        const p = presenceUsersFromState(
          channel.presenceState() as RealtimePresenceState<PresenceMeta>,
        );
        setState((s) => ({ ...s, presence: p }));
      })
      .on("presence", { event: "leave" }, () => {
        const p = presenceUsersFromState(
          channel.presenceState() as RealtimePresenceState<PresenceMeta>,
        );
        setState((s) => ({ ...s, presence: p }));
      })
      .on("broadcast", { event: "raise-hand" }, ({ payload }) => {
        const fromUserId = String(payload?.userId ?? "");
        const at = String(payload?.at ?? new Date().toISOString());
        setState((s) => ({
          ...s,
          lastRaiseHand: fromUserId ? { fromUserId, at } : s.lastRaiseHand,
          toast: fromUserId ? `${fromUserId.slice(0, 8)} raised a hand` : s.toast,
        }));
      })
      .on("broadcast", { event: "video:set" }, ({ payload }) => {
        const fromUserId = typeof payload?.userId === "string" ? payload.userId : "";
        const createdBy = roomCreatedByRef.current ?? "";
        if (createdBy && fromUserId && fromUserId !== createdBy) return;
        const videoId =
          payload?.videoId === null
            ? null
            : typeof payload?.videoId === "string"
              ? payload.videoId
              : null;
        const isPaused =
          typeof payload?.isPaused === "boolean" ? payload.isPaused : !videoId;
        const positionSeconds = Number(payload?.positionSeconds ?? 0);
        const playbackRate = Number(payload?.playbackRate ?? 1);
        const updatedAt =
          typeof payload?.updatedAt === "string"
            ? payload.updatedAt
            : new Date().toISOString();
        setState((s) =>
          s.room
            ? {
                ...s,
                room: {
                  ...s.room,
                  currentVideoId: videoId,
                  isPaused,
                  playbackPositionSeconds: Number.isFinite(positionSeconds)
                    ? positionSeconds
                    : 0,
                  playbackRate: Number.isFinite(playbackRate) ? playbackRate : 1,
                  updatedAt,
                },
              }
            : s,
        );
      })
      .on("broadcast", { event: "video:play" }, ({ payload }) => {
        const fromUserId = typeof payload?.userId === "string" ? payload.userId : "";
        const createdBy = roomCreatedByRef.current ?? "";
        if (createdBy && fromUserId && fromUserId !== createdBy) return;
        const positionSeconds = Number(payload?.positionSeconds ?? 0);
        const playbackRate = Number(payload?.playbackRate ?? 1);
        const updatedAt =
          typeof payload?.updatedAt === "string"
            ? payload.updatedAt
            : new Date().toISOString();
        setState((s) =>
          s.room
            ? {
                ...s,
                room: {
                  ...s.room,
                  isPaused: false,
                  playbackPositionSeconds: Number.isFinite(positionSeconds)
                    ? positionSeconds
                    : s.room.playbackPositionSeconds,
                  playbackRate: Number.isFinite(playbackRate)
                    ? playbackRate
                    : s.room.playbackRate,
                  updatedAt,
                },
              }
            : s,
        );
      })
      .on("broadcast", { event: "video:pause" }, ({ payload }) => {
        const fromUserId = typeof payload?.userId === "string" ? payload.userId : "";
        const createdBy = roomCreatedByRef.current ?? "";
        if (createdBy && fromUserId && fromUserId !== createdBy) return;
        const positionSeconds = Number(payload?.positionSeconds ?? 0);
        const playbackRate = Number(payload?.playbackRate ?? 1);
        const updatedAt =
          typeof payload?.updatedAt === "string"
            ? payload.updatedAt
            : new Date().toISOString();
        setState((s) =>
          s.room
            ? {
                ...s,
                room: {
                  ...s.room,
                  isPaused: true,
                  playbackPositionSeconds: Number.isFinite(positionSeconds)
                    ? positionSeconds
                    : s.room.playbackPositionSeconds,
                  playbackRate: Number.isFinite(playbackRate)
                    ? playbackRate
                    : s.room.playbackRate,
                  updatedAt,
                },
              }
            : s,
        );
      })
      .on("broadcast", { event: "video:seek" }, ({ payload }) => {
        const fromUserId = typeof payload?.userId === "string" ? payload.userId : "";
        const createdBy = roomCreatedByRef.current ?? "";
        if (createdBy && fromUserId && fromUserId !== createdBy) return;
        const positionSeconds = Number(payload?.positionSeconds ?? 0);
        const playbackRate = Number(payload?.playbackRate ?? 1);
        const updatedAt =
          typeof payload?.updatedAt === "string"
            ? payload.updatedAt
            : new Date().toISOString();
        setState((s) =>
          s.room
            ? {
                ...s,
                room: {
                  ...s.room,
                  playbackPositionSeconds: Number.isFinite(positionSeconds)
                    ? positionSeconds
                    : s.room.playbackPositionSeconds,
                  playbackRate: Number.isFinite(playbackRate)
                    ? playbackRate
                    : s.room.playbackRate,
                  updatedAt,
                },
              }
            : s,
        );
      });

    channel.subscribe(async (status) => {
      setState((s) => ({ ...s, channel, isReady: false, error: null }));
      if (status !== "SUBSCRIBED") return;
      setState((s) => ({ ...s, isReady: true }));
      const meta = presenceMetaRef.current;
      if (meta) await channel.track(meta);
      await resyncRoom();
    });

    return () => {
      presenceMetaRef.current = null;
      setState((s) => ({ ...s, channel: null, isReady: false, presence: [] }));
      void supabase.removeChannel(channel);
    };
  }, [resyncRoom, roomId, supabase, userId]);

  useEffect(() => {
    if (!state.channel) return;
    if (!displayName) return;
    void updatePresence({ displayName });
  }, [displayName, state.channel, updatePresence]);

  return {
    ...state,
    effectivePlaybackPositionSeconds,
    resyncRoom,
    updatePresence,
    setVideo,
    play,
    pause,
    seek,
    raiseHand,
    clearToast: () => setState((s) => ({ ...s, toast: null })),
  };
}
