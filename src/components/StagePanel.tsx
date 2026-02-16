"use client";

import {
  Room,
  RoomEvent,
  Track,
  createLocalTracks,
  type Participant,
} from "livekit-client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Props = {
  requestToken: () => Promise<
    | { ok: true; token: string; url: string; room: string }
    | { ok: false; error: string }
  >;
};

function participantDisplayName(p: Participant) {
  const name = (p.name || "").trim();
  if (name) return name;
  const id = (p.identity || "").trim();
  if (!id) return "Guest";
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
      className="relative overflow-hidden rounded-[16px] border border-black/10 bg-[linear-gradient(180deg,#141821,#0d1117)] shadow-[0_18px_34px_rgba(15,23,42,0.22)]"
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
        <div className="min-w-0 rounded-full border border-white/20 bg-black/45 px-2 py-1 text-xs font-semibold text-white">
          <span className="truncate">
            {label}
            {props.isLocal ? " (You)" : ""}
          </span>
        </div>
        <div className="flex items-center gap-2 text-[11px] font-semibold text-white/92">
          <span className="rounded-full border border-white/20 bg-black/45 px-2 py-1">{micOn ? "Mic" : "Mic Off"}</span>
          <span className="rounded-full border border-white/20 bg-black/45 px-2 py-1">{camOn ? "Cam" : "Cam Off"}</span>
        </div>
      </div>

      {playError ? (
        <div className="absolute inset-x-0 top-0 p-2">
          <div className="rounded-[10px] border border-white/20 bg-black/55 px-2 py-1 text-[11px] font-semibold text-white/82">
            Tap to enable media playback
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function StagePanel(props: Props) {
  const [status, setStatus] = useState<
    | { type: "idle" }
    | { type: "connecting" }
    | { type: "connected"; room: Room }
    | { type: "error"; message: string }
  >({ type: "idle" });
  const [, setRenderTick] = useState(0);

  const roomRef = useRef<Room | null>(null);

  const connectedRoom = status.type === "connected" ? status.room : null;

  // Stage is small (<= ~20), so simple re-rendering is fine.
  const participants = connectedRoom
    ? [connectedRoom.localParticipant, ...Array.from(connectedRoom.remoteParticipants.values())]
    : [];

  const join = useCallback(async () => {
    if (status.type === "connecting" || status.type === "connected") return;
    setStatus({ type: "connecting" });

    const tokenRes = await props.requestToken();
    if (!tokenRes.ok) {
      const msg =
        tokenRes.error === "livekit_not_configured"
          ? "Stage is not configured yet (missing LiveKit env on the realtime server)."
          : tokenRes.error === "stage_full"
            ? "Stage is full. Try again later."
            : tokenRes.error === "forbidden"
              ? "You are not allowed to join the Stage in this room."
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

      setStatus({ type: "connected", room });
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
  }, [props, status.type]);

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
        <div className="text-sm font-extrabold text-[var(--foreground)]">Stage</div>
        <span className="nt-badge">LiveKit</span>
      </div>

      <div className="mt-2 text-xs font-semibold text-[var(--muted)]">
        Interactive camera + mic for a small number of speakers. For 10k rooms, most students stay in the Audience.
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {status.type !== "connected" ? (
          <button
            className="nt-btn nt-btn-accent h-11 px-4"
            onClick={() => void join()}
            disabled={status.type === "connecting"}
            title="Join Stage"
          >
            {status.type === "connecting" ? "Connecting..." : "Join Stage"}
          </button>
        ) : (
          <>
            <button className="nt-btn nt-btn-outline" onClick={() => void toggleCam()}>
              {connectedRoom?.localParticipant.isCameraEnabled ? "Camera On" : "Camera Off"}
            </button>
            <button className="nt-btn nt-btn-outline" onClick={() => void toggleMic()}>
              {connectedRoom?.localParticipant.isMicrophoneEnabled ? "Mic On" : "Mic Off"}
            </button>
            <button className="nt-btn nt-btn-outline ml-auto" onClick={leave}>
              Leave
            </button>
          </>
        )}
      </div>

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
      ) : (
        <div className="mt-3 rounded-[12px] border border-black/10 bg-white p-3 text-[11px] font-semibold text-[var(--muted)]">
          Join to start your camera and speak with other Stage participants.
        </div>
      )}
    </div>
  );
}
