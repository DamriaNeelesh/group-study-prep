"use client";

import {
  Room,
  RoomEvent,
  Track,
  createLocalTracks,
  type Participant,
} from "livekit-client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type TokenResponse =
  | { ok: true; token: string; url: string; room: string }
  | { ok: false; error: string };

type Props = {
  roomId: string;
  requestToken: (tableId: string) => Promise<TokenResponse>;
};

function participantDisplayName(p: Participant) {
  const name = (p.name || "").trim();
  if (name) return name;
  const id = (p.identity || "").trim();
  if (!id) return "Student";
  if (id.length <= 14) return id;
  return `${id.slice(0, 8)}...${id.slice(-4)}`;
}

function Tile(props: { participant: Participant; isLocal: boolean }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playError, setPlayError] = useState<string | null>(null);

  const camTrack = props.participant.getTrackPublication(Track.Source.Camera)?.track ?? null;
  const micTrack =
    props.participant.getTrackPublication(Track.Source.Microphone)?.track ?? null;

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (camTrack && camTrack.kind === Track.Kind.Video) camTrack.attach(el);
    let cancelled = false;
    void (async () => {
      try {
        await el.play();
        if (!cancelled) setPlayError(null);
      } catch (e: unknown) {
        if (!cancelled) setPlayError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
      try {
        camTrack?.detach(el);
      } catch {
        // ignore
      }
    };
  }, [camTrack]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    if (micTrack && micTrack.kind === Track.Kind.Audio) micTrack.attach(el);
    let cancelled = false;
    void (async () => {
      try {
        await el.play();
        if (!cancelled) setPlayError(null);
      } catch (e: unknown) {
        if (!cancelled) setPlayError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
      try {
        micTrack?.detach(el);
      } catch {
        // ignore
      }
    };
  }, [micTrack]);

  const label = useMemo(() => participantDisplayName(props.participant), [props.participant]);

  const camPub = props.participant.getTrackPublication(Track.Source.Camera);
  const micPub = props.participant.getTrackPublication(Track.Source.Microphone);
  const camOn = Boolean(camPub?.isMuted === false && camPub.track);
  const micOn = Boolean(micPub?.isMuted === false && micPub.track);

  return (
    <div
      className="relative overflow-hidden rounded-[12px] border border-black/10 bg-black shadow-[0_1px_14px_rgba(0,0,0,0.10)]"
      onClick={() => {
        const v = videoRef.current;
        const a = audioRef.current;
        try {
          v?.play();
          a?.play();
          setPlayError(null);
        } catch {
          // ignore
        }
      }}
    >
      <div className="aspect-video w-full">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="h-full w-full object-cover"
        />
      </div>

      <audio ref={audioRef} autoPlay />

      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 p-2">
        <div className="min-w-0 rounded-full bg-black/60 px-2 py-1 text-xs font-bold text-white">
          <span className="truncate">
            {label}
            {props.isLocal ? " (You)" : ""}
          </span>
        </div>
        <div className="flex items-center gap-2 text-[11px] font-extrabold text-white/90">
          <span className="rounded-full bg-black/60 px-2 py-1">{micOn ? "Mic" : "Mic Off"}</span>
          <span className="rounded-full bg-black/60 px-2 py-1">{camOn ? "Cam" : "Cam Off"}</span>
        </div>
      </div>

      {playError ? (
        <div className="absolute inset-x-0 top-0 p-2">
          <div className="rounded-[10px] border border-white/15 bg-black/70 px-2 py-1 text-[11px] font-semibold text-white/80">
            Tap to enable media playback
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function TablePanel(props: Props) {
  const storageKey = useMemo(() => `nt:table:${props.roomId}`, [props.roomId]);
  const [tableId, setTableId] = useState(() => {
    if (typeof window === "undefined") return "";
    try {
      return localStorage.getItem(storageKey) ?? "";
    } catch {
      return "";
    }
  });

  const [status, setStatus] = useState<
    | { type: "idle" }
    | { type: "connecting" }
    | { type: "connected"; room: Room; tableId: string }
    | { type: "error"; message: string }
  >({ type: "idle" });

  const [, setRenderTick] = useState(0);
  const roomRef = useRef<Room | null>(null);

  const connectedRoom = status.type === "connected" ? status.room : null;
  const participants = connectedRoom
    ? [connectedRoom.localParticipant, ...Array.from(connectedRoom.remoteParticipants.values())]
    : [];

  const join = useCallback(async () => {
    if (status.type === "connecting" || status.type === "connected") return;

    const cleaned = String(tableId || "")
      .trim()
      .replace(/[^a-zA-Z0-9_-]/g, "")
      .slice(0, 16);
    if (!cleaned) {
      setStatus({ type: "error", message: "Enter a table code (letters/numbers only)." });
      return;
    }

    try {
      localStorage.setItem(storageKey, cleaned);
    } catch {
      // ignore
    }

    setStatus({ type: "connecting" });

    const tokenRes = await props.requestToken(cleaned);
    if (!tokenRes.ok) {
      const msg =
        tokenRes.error === "livekit_not_configured"
          ? "Tables are not configured yet (missing LiveKit env on the realtime server)."
          : tokenRes.error === "table_full"
            ? "This table is full. Use a different code."
            : tokenRes.error === "invalid_table"
              ? "Invalid table code."
              : tokenRes.error;
      setStatus({ type: "error", message: msg });
      return;
    }

    const room = new Room({
      adaptiveStream: true,
      dynacast: true,
    });
    roomRef.current = room;

    try {
      await room.connect(tokenRes.url, tokenRes.token);
      const tracks = await createLocalTracks({ audio: true, video: true });
      await Promise.all(tracks.map((t) => room.localParticipant.publishTrack(t)));

      const rerender = () => setRenderTick((v) => v + 1);
      room.on(RoomEvent.ParticipantConnected, rerender);
      room.on(RoomEvent.ParticipantDisconnected, rerender);
      room.on(RoomEvent.TrackSubscribed, rerender);
      room.on(RoomEvent.TrackUnsubscribed, rerender);
      room.on(RoomEvent.TrackMuted, rerender);
      room.on(RoomEvent.TrackUnmuted, rerender);

      setStatus({ type: "connected", room, tableId: cleaned });
      rerender();
    } catch (e: unknown) {
      try {
        room.disconnect();
      } catch {
        // ignore
      }
      roomRef.current = null;
      setStatus({ type: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }, [props, status.type, storageKey, tableId]);

  const leave = useCallback(() => {
    const room = roomRef.current;
    roomRef.current = null;
    try {
      room?.disconnect();
    } catch {
      // ignore
    }
    setStatus({ type: "idle" });
  }, []);

  const toggleCam = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    const enabled = room.localParticipant.isCameraEnabled;
    await room.localParticipant.setCameraEnabled(!enabled);
    setRenderTick((v) => v + 1);
  }, []);

  const toggleMic = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    const enabled = room.localParticipant.isMicrophoneEnabled;
    await room.localParticipant.setMicrophoneEnabled(!enabled);
    setRenderTick((v) => v + 1);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      try {
        roomRef.current?.disconnect();
      } catch {
        // ignore
      }
      roomRef.current = null;
    };
  }, []);

  return (
    <div className="nt-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-extrabold text-[var(--foreground)]">Tables</div>
        <span className="nt-badge">Small Group</span>
      </div>

      <div className="mt-2 text-xs font-semibold text-[var(--muted)]">
        Join a table to talk with friends (up to a small group). Use the same code on all devices to join together.
      </div>

      {status.type !== "connected" ? (
        <div className="mt-3 flex items-center gap-2">
          <input
            value={tableId}
            onChange={(e) => {
              setTableId(e.target.value);
              if (status.type === "error") setStatus({ type: "idle" });
            }}
            placeholder="Table code (e.g. 9A)"
            className="nt-input h-11 w-full"
            autoCapitalize="characters"
          />
          <button
            className="nt-btn nt-btn-accent h-11 px-4"
            onClick={() => void join()}
            disabled={status.type === "connecting"}
            title="Join table"
          >
            {status.type === "connecting" ? "Joining..." : "Join"}
          </button>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-[var(--surface-2)] px-3 py-1 text-xs font-extrabold text-[var(--foreground)]">
            Table: <span className="font-mono">{status.tableId}</span>
          </span>
          <button className="nt-btn nt-btn-outline" onClick={() => void toggleCam()}>
            {connectedRoom?.localParticipant.isCameraEnabled ? "Camera On" : "Camera Off"}
          </button>
          <button className="nt-btn nt-btn-outline" onClick={() => void toggleMic()}>
            {connectedRoom?.localParticipant.isMicrophoneEnabled ? "Mic On" : "Mic Off"}
          </button>
          <button className="nt-btn nt-btn-outline ml-auto" onClick={leave}>
            Leave
          </button>
        </div>
      )}

      {status.type === "error" ? (
        <div className="mt-3 rounded-[10px] border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-800">
          {status.message}
        </div>
      ) : null}

      {status.type === "connected" ? (
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {participants.map((p) => (
            <Tile key={p.sid} participant={p} isLocal={p.isLocal} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
