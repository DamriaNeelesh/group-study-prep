"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import msgpackParser from "socket.io-msgpack-parser";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type PlaybackState = "playing" | "paused";

export type RoomChatMessage = {
  id: string;
  roomId: string;
  userId: string;
  displayName: string;
  message: string;
  atMs: number;
};

export type RoomStateV2 = {
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

type RoomAction = {
  seq: number;
  execAtMs: number;
  serverNowMs: number;
  command: { type: string; [k: string]: unknown };
  patch: {
    videoId: string | null;
    playbackState: PlaybackState;
    videoTimeAtRef: number;
    referenceTimeMs: number;
    playbackRate: number;
    audienceDelaySeconds: number;
    controllerUserId: string | null;
  };
};

type UseRoomSyncSocketState = {
  isReady: boolean;
  error: string | null;
  room: RoomStateV2 | null;
  onlineCount: number;
  chatMessages: RoomChatMessage[];
  toast: string | null;
  lastRaiseHand: { fromUserId: string; at: string } | null;
  offsetMs: number;
  connection: "disconnected" | "connecting" | "connected" | "reconnecting";
};

type JoinOrStateResponse =
  | {
      ok: true;
      state: RoomStateV2;
      pending: RoomAction[];
      onlineCount: number;
      chat: RoomChatMessage[];
    }
  | { ok: false; error: string };

type CommandResponse =
  | { ok: true; action?: RoomAction }
  | { ok: false; error?: string; retryAfterMs?: number };

type ChatSendResponse =
  | { ok: true; message?: RoomChatMessage }
  | { ok: false; error?: string; retryAfterMs?: number };

function clampNonNegative(n: number) {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

function parseJoinOrStateResponse(res: unknown): JoinOrStateResponse {
  if (!isRecord(res)) return { ok: false, error: "bad_response" };
  if (res.ok !== true) {
    const error = typeof res.error === "string" ? res.error : "request_failed";
    return { ok: false, error };
  }

  const state = res.state as unknown;
  const pending = res.pending as unknown;
  const onlineCount = res.onlineCount as unknown;
  const chat = res.chat as unknown;

  if (!isRecord(state)) return { ok: false, error: "bad_state" };
  if (!Array.isArray(pending)) return { ok: false, error: "bad_pending" };

  const parsedChat: RoomChatMessage[] = Array.isArray(chat)
    ? chat
        .map((item) => {
          if (!isRecord(item)) return null;
          const id = typeof item.id === "string" ? item.id : "";
          const roomId = typeof item.roomId === "string" ? item.roomId : "";
          const userId = typeof item.userId === "string" ? item.userId : "";
          const displayName = typeof item.displayName === "string" ? item.displayName : "";
          const message = typeof item.message === "string" ? item.message : "";
          const atMs = typeof item.atMs === "number" ? item.atMs : Number(item.atMs ?? 0);
          if (!id || !roomId || !userId || !displayName || !message || !Number.isFinite(atMs)) {
            return null;
          }
          return {
            id,
            roomId,
            userId,
            displayName,
            message,
            atMs,
          } satisfies RoomChatMessage;
        })
        .filter(Boolean) as RoomChatMessage[]
    : [];

  parsedChat.sort((a, b) => a.atMs - b.atMs);

  return {
    ok: true,
    state: state as RoomStateV2,
    pending: pending as RoomAction[],
    onlineCount: typeof onlineCount === "number" ? onlineCount : Number(onlineCount ?? 0) || 0,
    chat: parsedChat,
  };
}

function computeExpectedTimeSeconds(state: RoomStateV2, serverNowMs: number) {
  if (state.playbackState === "paused") return clampNonNegative(state.videoTimeAtRef);
  const dtSec = Math.max(0, (serverNowMs - state.referenceTimeMs) / 1000);
  return clampNonNegative(state.videoTimeAtRef + dtSec * state.playbackRate);
}

function randInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function safeRandomId() {
  try {
    return crypto.randomUUID();
  } catch {
    return `id_${Date.now().toString(16)}_${Math.random().toString(16).slice(2)}`;
  }
}

function getOrCreateStorageId(storage: Storage, key: string) {
  const existing = storage.getItem(key);
  if (existing && existing.length >= 8) return existing;
  const next = safeRandomId();
  storage.setItem(key, next);
  return next;
}

async function ntpSample(socket: Socket, timeoutMs: number) {
  const t0 = Date.now();
  const pong = await new Promise<{ t0: number; t1: number; t2: number }>((resolve, reject) => {
    let done = false;
    const id = window.setTimeout(() => {
      if (done) return;
      done = true;
      reject(new Error("ntp_timeout"));
    }, timeoutMs);

    socket.emit("ntp:ping", { t0 }, (res: unknown) => {
      if (done) return;
      done = true;
      window.clearTimeout(id);
      const p = res as { t0?: unknown; t1?: unknown; t2?: unknown } | null;
      resolve({
        t0: typeof p?.t0 === "number" ? p.t0 : t0,
        t1: typeof p?.t1 === "number" ? p.t1 : Date.now(),
        t2: typeof p?.t2 === "number" ? p.t2 : Date.now(),
      });
    });
  });
  const t3 = Date.now();
  const rtt = t3 - t0;
  const offset = ((pong.t1 - pong.t0) + (pong.t2 - t3)) / 2;
  return { offsetMs: offset, rttMs: rtt };
}

async function computeBestOffset(socket: Socket) {
  let best: { offsetMs: number; rttMs: number } | null = null;
  for (let i = 0; i < 5; i++) {
    try {
      const s = await ntpSample(socket, 1000);
      if (!best || s.rttMs < best.rttMs) best = s;
    } catch {
      // ignore
    }
    await new Promise((r) => window.setTimeout(r, 60));
  }
  return best?.offsetMs ?? 0;
}

export function useRoomSyncSocket(args: {
  roomId: string;
  userId: string | null;
  displayName: string;
}) {
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const realtimeUrl = (process.env.NEXT_PUBLIC_REALTIME_URL || "").trim();
  const missingEnvError = realtimeUrl
    ? null
    : "Missing env: NEXT_PUBLIC_REALTIME_URL (Socket sync backend URL)";

  const clientInfo = useMemo(() => {
    if (typeof window === "undefined") return { clientId: "", tabId: "" };
    let clientId = "";
    let tabId = "";
    try {
      clientId = getOrCreateStorageId(localStorage, "nt:clientId:v1");
    } catch {
      // ignore
    }
    try {
      tabId = getOrCreateStorageId(sessionStorage, "nt:tabId:v1");
    } catch {
      // ignore
    }
    return { clientId, tabId };
  }, []);

  const [state, setState] = useState<UseRoomSyncSocketState>({
    isReady: false,
    error: missingEnvError,
    room: null,
    onlineCount: 0,
    chatMessages: [],
    toast: null,
    lastRaiseHand: null,
    offsetMs: 0,
    connection: realtimeUrl ? "connecting" : "disconnected",
  });

  const socketRef = useRef<Socket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const backoffMsRef = useRef<number>(1000);
  const lastConnectErrorRef = useRef<string | null>(null);

  const actionTimersRef = useRef<Map<number, number>>(new Map());
  const lastAppliedSeqRef = useRef<number>(0);

  const offsetMsRef = useRef<number>(0);
  const [nowMs, setNowMs] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const clearActionTimers = useCallback(() => {
    for (const id of actionTimersRef.current.values()) window.clearTimeout(id);
    actionTimersRef.current.clear();
  }, []);

  const applyActionNow = useCallback((action: RoomAction) => {
    if (!action?.patch) return;
    if (!Number.isFinite(action.seq)) return;
    if (action.seq <= lastAppliedSeqRef.current) return;
    lastAppliedSeqRef.current = action.seq;

    setState((s) => {
      const room = s.room;
      if (!room) return s;
      return {
        ...s,
        room: {
          ...room,
          seq: action.seq,
          videoId: action.patch.videoId ?? null,
          playbackState: action.patch.playbackState === "playing" ? "playing" : "paused",
          videoTimeAtRef: clampNonNegative(Number(action.patch.videoTimeAtRef ?? 0)),
          referenceTimeMs: Number(action.patch.referenceTimeMs ?? Date.now()),
          playbackRate: Number(action.patch.playbackRate ?? 1),
          audienceDelaySeconds: Number(action.patch.audienceDelaySeconds ?? 0),
          controllerUserId: (action.patch.controllerUserId as string | null) ?? null,
        },
      };
    });
  }, []);

  const scheduleAction = useCallback(
    (action: RoomAction) => {
      if (!Number.isFinite(action?.execAtMs)) return;
      if (!Number.isFinite(action?.seq)) return;
      if (action.seq <= lastAppliedSeqRef.current) return;
      if (actionTimersRef.current.has(action.seq)) return;

      const clientServerNowMs = Date.now() + offsetMsRef.current;
      const delayMs = Math.max(0, action.execAtMs - clientServerNowMs);

      const id = window.setTimeout(() => {
        actionTimersRef.current.delete(action.seq);
        applyActionNow(action);
      }, delayMs);
      actionTimersRef.current.set(action.seq, id);
    },
    [applyActionNow],
  );

  const resyncRoom = useCallback(async () => {
    const socket = socketRef.current;
    if (!socket || !socket.connected) return;

    setState((s) => ({ ...s, isReady: false }));
    try {
      const offset = await computeBestOffset(socket);
      offsetMsRef.current = offset;
      setState((s) => ({ ...s, offsetMs: offset }));
    } catch {
      // ignore
    }

    const resp = await new Promise<JoinOrStateResponse>((resolve) => {
      socket.emit("room:state:request", {}, (res: unknown) => {
        resolve(parseJoinOrStateResponse(res));
      });
    });

    if (!resp.ok) {
      setState((s) => ({ ...s, isReady: true, error: resp.error || "Resync failed" }));
      return;
    }

    clearActionTimers();
    lastAppliedSeqRef.current = Number(resp.state?.seq ?? 0) || 0;
    setState((s) => ({
      ...s,
      isReady: true,
      error: null,
      room: resp.state,
      onlineCount: Number(resp.onlineCount ?? 0) || 0,
      chatMessages: resp.chat || [],
    }));
    for (const a of resp.pending || []) scheduleAction(a);
  }, [clearActionTimers, scheduleAction]);

  const connect = useCallback(() => {
    const url = realtimeUrl;
    if (!url) return;
    if (!supabase) return;
    if (!args.roomId) return;
    if (!args.userId) return;

    const existing = socketRef.current;
    if (existing) return;

    const socket = io(url, {
      autoConnect: false,
      transports: ["websocket"],
      reconnection: false,
      parser: msgpackParser,
      auth: { token: "", displayName: args.displayName, clientId: clientInfo.clientId, tabId: clientInfo.tabId },
    });
    socketRef.current = socket;

    const cleanupReconnectTimer = () => {
      if (reconnectTimerRef.current != null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };

    const scheduleReconnect = (retryAfterMs?: number) => {
      cleanupReconnectTimer();
      setState((s) => ({ ...s, connection: "reconnecting", isReady: false }));

      const cap = 60_000;
      const base = 1000;
      const sleep = Math.max(250, retryAfterMs ?? backoffMsRef.current);
      const nextSleep = Math.min(cap, randInt(base, sleep * 3));
      backoffMsRef.current = nextSleep;

      reconnectTimerRef.current = window.setTimeout(async () => {
        if (!socketRef.current) return;
        try {
          const { data } = await supabase.auth.getSession();
          const token = data.session?.access_token ?? "";
          socket.auth = { token, displayName: args.displayName, clientId: clientInfo.clientId, tabId: clientInfo.tabId };
        } catch {
          // ignore
        }
        try {
          socket.connect();
        } catch {
          // ignore
        }
      }, sleep);
    };

    socket.on("connect", () => {
      cleanupReconnectTimer();
      backoffMsRef.current = 1000;
      lastConnectErrorRef.current = null;
      setState((s) => ({ ...s, connection: "connected", error: null }));

      void (async () => {
        try {
          const offset = await computeBestOffset(socket);
          offsetMsRef.current = offset;
          setState((s) => ({ ...s, offsetMs: offset }));
        } catch {
          // ignore
        }

        socket.emit(
          "room:join",
          { roomId: args.roomId, displayName: args.displayName },
          (res: unknown) => {
          const r = parseJoinOrStateResponse(res);
          if (!r.ok) {
            setState((s) => ({
              ...s,
              isReady: false,
              error: String(r.error || "Join failed"),
            }));
            return;
          }

          clearActionTimers();
          lastAppliedSeqRef.current = Number(r.state?.seq ?? 0) || 0;
          setState((s) => ({
            ...s,
            isReady: true,
            error: null,
            room: r.state,
            onlineCount: Number(r.onlineCount ?? 0) || 0,
            chatMessages: r.chat || [],
          }));

          for (const a of r.pending || []) scheduleAction(a);
          },
        );
      })();
    });

    socket.on("disconnect", () => {
      setState((s) => ({
        ...s,
        connection: "disconnected",
        isReady: false,
        error: s.error ?? "Disconnected from realtime sync. Reconnecting...",
      }));
      scheduleReconnect();
    });

    socket.on("connect_error", (err: unknown) => {
      const msg = isRecord(err)
        ? String(err.message || "")
        : String((err as { message?: unknown } | null)?.message ?? "");

      if (msg.startsWith("rate_limited:")) {
        const retry = Number(msg.split(":")[1] ?? 0);
        const secs = Math.max(1, Math.ceil((Number.isFinite(retry) ? retry : 0) / 1000));
        setState((s) => ({
          ...s,
          error: `Realtime sync rate-limited. Retrying in ~${secs}s...`,
        }));
        scheduleReconnect(Number.isFinite(retry) ? retry : undefined);
        return;
      }

      // Make failures actionable: most "it doesn't work" reports are actually an unreachable backend URL,
      // missing realtime server env, or Supabase auth not initialized yet.
      const hint = (() => {
        if (typeof window === "undefined") return null;
        try {
          const pageHost = window.location.hostname;
          const rtHost = new URL(url).hostname;
          const rtLooksLocal = rtHost === "localhost" || rtHost === "127.0.0.1";
          const pageLooksLocal = pageHost === "localhost" || pageHost === "127.0.0.1";
          if (rtLooksLocal && !pageLooksLocal) {
            return `NEXT_PUBLIC_REALTIME_URL points to ${rtHost}, which won't work from a deployed site. Set it to your deployed realtime service URL.`;
          }
        } catch {
          // ignore
        }
        return null;
      })();

      const nextErr =
        hint ||
        (msg.toLowerCase().includes("unauthorized")
          ? "Realtime sync auth failed. Make sure Supabase anonymous auth is enabled and you are signed in."
          : `Can't connect to realtime sync (${url}). Make sure the realtime service + Redis are running.`);

      if (lastConnectErrorRef.current !== nextErr) {
        lastConnectErrorRef.current = nextErr;
        setState((s) => ({ ...s, error: nextErr }));
      }
      scheduleReconnect();
    });

    socket.on("presence:update", (p: unknown) => {
      const room = isRecord(p) ? String(p.roomId || "") : "";
      if (room !== args.roomId) return;
      const n = isRecord(p) ? Number(p.onlineCount ?? 0) || 0 : 0;
      setState((s) => ({ ...s, onlineCount: n }));
    });

    socket.on("room:hand", (p: unknown) => {
      const fromUserId = isRecord(p) ? String(p.fromUserId ?? "") : "";
      const at = isRecord(p) ? String(p.at ?? new Date().toISOString()) : new Date().toISOString();
      if (!fromUserId) return;
      setState((s) => ({
        ...s,
        lastRaiseHand: { fromUserId, at },
        toast: `${fromUserId.slice(0, 8)} raised a hand`,
      }));
    });

    socket.on("room:action", (action: RoomAction) => {
      scheduleAction(action);
    });

    socket.on("chat:message", (payload: unknown) => {
      if (!isRecord(payload)) return;
      const id = typeof payload.id === "string" ? payload.id : "";
      const roomId = typeof payload.roomId === "string" ? payload.roomId : "";
      const userId = typeof payload.userId === "string" ? payload.userId : "";
      const displayName =
        typeof payload.displayName === "string" ? payload.displayName : "";
      const message = typeof payload.message === "string" ? payload.message : "";
      const atMs =
        typeof payload.atMs === "number" ? payload.atMs : Number(payload.atMs ?? 0);

      if (!id || !roomId || !userId || !displayName || !message || !Number.isFinite(atMs)) {
        return;
      }
      if (roomId !== args.roomId) return;

      const nextMessage: RoomChatMessage = {
        id,
        roomId,
        userId,
        displayName,
        message,
        atMs,
      };

      setState((s) => {
        if (s.chatMessages.some((m) => m.id === nextMessage.id)) return s;
        const next = [...s.chatMessages, nextMessage];
        next.sort((a, b) => a.atMs - b.atMs);
        return { ...s, chatMessages: next.slice(-120) };
      });
    });

    void (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token ?? "";
        socket.auth = { token, displayName: args.displayName, clientId: clientInfo.clientId, tabId: clientInfo.tabId };
      } catch {
        // ignore
      }
      try {
        socket.connect();
      } catch {
        // ignore
      }
    })();

    // Resync on visibility restore (tab throttling + mobile backgrounding)
    const onVis = () => {
      if (document.hidden) return;
      void resyncRoom();
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      document.removeEventListener("visibilitychange", onVis);
      cleanupReconnectTimer();
      clearActionTimers();
      socketRef.current = null;
      try {
        socket.disconnect();
      } catch {
        // ignore
      }
    };
  }, [
    args.displayName,
    args.roomId,
    args.userId,
    clearActionTimers,
    clientInfo.clientId,
    clientInfo.tabId,
    realtimeUrl,
    resyncRoom,
    scheduleAction,
    supabase,
  ]);

  useEffect(() => {
    const cleanup = connect();
    return () => cleanup?.();
  }, [connect]);

  // Periodically refresh clock offset (best-effort).
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !socket.connected) return;

    let cancelled = false;
    const id = window.setInterval(() => {
      if (cancelled) return;
      void (async () => {
        try {
          const offset = await computeBestOffset(socket);
          offsetMsRef.current = offset;
          setState((s) => ({ ...s, offsetMs: offset }));
        } catch {
          // ignore
        }
      })();
    }, 60_000);

    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [state.connection]);

  const sendCommand = useCallback(async (command: Record<string, unknown>) => {
    const socket = socketRef.current;
    if (!socket || !socket.connected) return { ok: false, error: "not_connected" } as const;

    const resp = await new Promise<CommandResponse>((resolve) => {
      socket.emit("room:command", { command }, (res: unknown) => {
        if (!isRecord(res)) return resolve({ ok: false, error: "bad_response" });
        if (res.ok === true) return resolve({ ok: true, action: res.action as RoomAction | undefined });
        resolve({
          ok: false,
          error: typeof res.error === "string" ? res.error : "command_failed",
          retryAfterMs: typeof res.retryAfterMs === "number" ? res.retryAfterMs : undefined,
        });
      });
    });
    return resp;
  }, []);

  const sendChat = useCallback(
    async (message: string) => {
      const socket = socketRef.current;
      if (!socket || !socket.connected) {
        return { ok: false, error: "not_connected" } as const;
      }

      const trimmed = message.trim();
      if (!trimmed) return { ok: false, error: "empty_message" } as const;

      const resp = await new Promise<ChatSendResponse>((resolve) => {
        socket.emit(
          "chat:send",
          { message: trimmed, displayName: args.displayName },
          (res: unknown) => {
            if (!isRecord(res)) return resolve({ ok: false, error: "bad_response" });
            if (res.ok === true) {
              return resolve({
                ok: true,
                message: isRecord(res.message) ? (res.message as RoomChatMessage) : undefined,
              });
            }
            resolve({
              ok: false,
              error: typeof res.error === "string" ? res.error : "request_failed",
              retryAfterMs: typeof res.retryAfterMs === "number" ? res.retryAfterMs : undefined,
            });
          },
        );
      });

      if (!resp.ok) {
        setState((s) => ({
          ...s,
          error:
            resp.error === "rate_limited"
              ? "You are sending messages too fast. Try again in a moment."
              : s.error,
        }));
      }
      return resp;
    },
    [args.displayName],
  );

  const canControl = useMemo(() => {
    return Boolean(args.userId && state.room);
  }, [args.userId, state.room]);

  const effectivePlaybackPositionSeconds = useMemo(() => {
    const room = state.room;
    if (!room) return 0;
    const serverNowMs = nowMs + state.offsetMs;
    const expected = computeExpectedTimeSeconds(room, serverNowMs);
    const withDelay = expected - (room.audienceDelaySeconds ?? 0);
    return clampNonNegative(withDelay);
  }, [nowMs, state.offsetMs, state.room]);

  return {
    ...state,
    canControl,
    effectivePlaybackPositionSeconds,
    resyncRoom,
    requestStageToken: async () => {
      const socket = socketRef.current;
      if (!socket || !socket.connected) {
        return { ok: false, error: "not_connected" } as const;
      }
      const resp = await new Promise<
        | { ok: true; token: string; url: string; room: string }
        | { ok: false; error: string }
      >((resolve) => {
        socket.emit(
          "stage:token",
          { displayName: args.displayName, clientId: clientInfo.clientId, tabId: clientInfo.tabId },
          (res: unknown) => {
          if (!isRecord(res)) return resolve({ ok: false, error: "bad_response" });
          if (res.ok === true) {
            const token = typeof res.token === "string" ? res.token : "";
            const url = typeof res.url === "string" ? res.url : "";
            const room = typeof res.room === "string" ? res.room : "";
            if (!token || !url || !room) return resolve({ ok: false, error: "bad_response" });
            return resolve({ ok: true, token, url, room });
          }
          const error = typeof res.error === "string" ? res.error : "request_failed";
          resolve({ ok: false, error });
          },
        );
      });
      return resp;
    },
    requestTableToken: async (tableId: string) => {
      const socket = socketRef.current;
      if (!socket || !socket.connected) {
        return { ok: false, error: "not_connected" } as const;
      }
      const cleaned = String(tableId || "")
        .trim()
        .replace(/[^a-zA-Z0-9_-]/g, "")
        .slice(0, 16);
      if (!cleaned) return { ok: false, error: "invalid_table" } as const;

      const resp = await new Promise<
        | { ok: true; token: string; url: string; room: string }
        | { ok: false; error: string }
      >((resolve) => {
        socket.emit(
          "table:token",
          { tableId: cleaned, displayName: args.displayName, clientId: clientInfo.clientId, tabId: clientInfo.tabId },
          (res: unknown) => {
          if (!isRecord(res)) return resolve({ ok: false, error: "bad_response" });
          if (res.ok === true) {
            const token = typeof res.token === "string" ? res.token : "";
            const url = typeof res.url === "string" ? res.url : "";
            const room = typeof res.room === "string" ? res.room : "";
            if (!token || !url || !room) return resolve({ ok: false, error: "bad_response" });
            return resolve({ ok: true, token, url, room });
          }
          const error = typeof res.error === "string" ? res.error : "request_failed";
          resolve({ ok: false, error });
          },
        );
      });
      return resp;
    },
    sendChat,
    setVideo: async (videoId: string | null) => {
      const res = await sendCommand({ type: "video:set", videoId });
      if (!res.ok) setState((s) => ({ ...s, error: res.error || "Command failed" }));
    },
    play: async () => {
      const res = await sendCommand({ type: "video:play" });
      if (!res.ok) setState((s) => ({ ...s, error: res.error || "Command failed" }));
    },
    pause: async () => {
      const res = await sendCommand({ type: "video:pause" });
      if (!res.ok) setState((s) => ({ ...s, error: res.error || "Command failed" }));
    },
    seek: async (positionSeconds: number) => {
      const res = await sendCommand({ type: "video:seek", positionSeconds });
      if (!res.ok) setState((s) => ({ ...s, error: res.error || "Command failed" }));
    },
    raiseHand: async () => {
      const res = await sendCommand({ type: "hand:raise" });
      if (!res.ok) setState((s) => ({ ...s, error: res.error || "Command failed" }));
    },
    clearToast: () => setState((s) => ({ ...s, toast: null })),
  };
}
