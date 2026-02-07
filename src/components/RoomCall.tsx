"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { type CallParticipant, useRoomCall } from "@/hooks/useRoomCall";

function shortId(id: string) {
  const trimmed = id.trim();
  if (trimmed.length <= 14) return trimmed;
  return `${trimmed.slice(0, 8)}...${trimmed.slice(-4)}`;
}

function StreamTile(props: {
  stream: MediaStream | null;
  label: string;
  muted?: boolean;
  mirror?: boolean;
  rightBadge?: string | null;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [playError, setPlayError] = useState<string | null>(null);
  const [hasVideo, setHasVideo] = useState(false);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.muted = Boolean(props.muted);
  }, [props.muted]);

  useEffect(() => {
    const stream = props.stream;
    const compute = () => {
      if (!stream) {
        setHasVideo(false);
        return;
      }
      setHasVideo(stream.getVideoTracks().length > 0);
    };

    compute();
    if (!stream) return;

    const onAdd = () => compute();
    const onRemove = () => compute();

    stream.addEventListener("addtrack", onAdd);
    stream.addEventListener("removetrack", onRemove);
    return () => {
      stream.removeEventListener("addtrack", onAdd);
      stream.removeEventListener("removetrack", onRemove);
    };
  }, [props.stream]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;

    if (!props.stream) {
      el.srcObject = null;
      Promise.resolve().then(() => setPlayError(null));
      return;
    }

    el.srcObject = props.stream;
    const p = el.play();
    if (p && typeof p.then === "function") {
      p.then(() => setPlayError(null)).catch((e: unknown) => {
        setPlayError(e instanceof Error ? e.message : String(e));
      });
    } else {
      Promise.resolve().then(() => setPlayError(null));
    }
  }, [props.stream]);

  return (
    <div
      className="relative overflow-hidden rounded-[12px] border border-black/10 bg-black shadow-[0_1px_14px_rgba(0,0,0,0.08)]"
      onClick={() => {
        const el = videoRef.current;
        if (!el) return;
        const p = el.play();
        if (p && typeof p.then === "function") {
          p.then(() => setPlayError(null)).catch(() => void 0);
        } else {
          setPlayError(null);
        }
      }}
    >
      <div className="aspect-video w-full">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          className={[
            "h-full w-full object-cover",
            props.mirror ? "-scale-x-100" : "",
            hasVideo ? "opacity-100" : "opacity-0",
          ].join(" ")}
        />

        {!hasVideo ? (
          <div className="absolute inset-0 flex items-center justify-center bg-[#111]">
            <div className="text-xs font-bold text-white/80">Camera off</div>
          </div>
        ) : null}
      </div>

      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 p-2">
        <div className="min-w-0 rounded-full bg-black/60 px-2 py-1 text-xs font-bold text-white">
          <span className="truncate">{props.label}</span>
        </div>
        {props.rightBadge ? (
          <div className="rounded-full bg-black/60 px-2 py-1 text-[11px] font-extrabold text-white/90">
            {props.rightBadge}
          </div>
        ) : null}
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

function CallPreview(props: {
  roomId: string;
  userId: string | null;
  displayName: string;
  onJoin: () => void;
}) {
  const [isSecure] = useState(() => {
    // `getUserMedia` needs HTTPS (or localhost). Avoid user confusion with a heads-up.
    try {
      return Boolean(window.isSecureContext);
    } catch {
      return true;
    }
  });

  return (
    <div className="nt-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-extrabold text-[var(--foreground)]">Meet</div>
        <span className="nt-badge">Beta</span>
      </div>

      <div className="mt-2 text-xs font-semibold text-[var(--muted)]">
        Camera + mic inside this room. Join only if you need it.
      </div>

      {!isSecure ? (
        <div className="mt-3 rounded-[10px] border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
          Camera/mic requires HTTPS (or localhost). If you&apos;re opening this from
          a phone on the same WiFi, use an HTTPS URL.
        </div>
      ) : null}

      <div className="mt-3 flex items-center gap-2">
        <button
          className="nt-btn nt-btn-accent h-11 px-4"
          onClick={props.onJoin}
          disabled={!props.userId}
          title={props.userId ? "Join the meet" : "Signing in..."}
        >
          Join Meet
        </button>
        <div className="text-xs font-semibold text-[var(--muted)]">
          Best for small groups. For large rooms, use audio only or add a TURN server.
        </div>
      </div>
    </div>
  );
}

function CallSession(props: {
  roomId: string;
  userId: string | null;
  displayName: string;
  onLeave: () => void;
}) {
  const call = useRoomCall({
    roomId: props.roomId,
    userId: props.userId,
    displayName: props.displayName,
  });

  const participants = call.participants;
  const participantsByPeerId = useMemo(() => {
    const m = new Map<string, CallParticipant>();
    for (const p of participants) m.set(p.peerId, p);
    return m;
  }, [participants]);

  const myLabel = props.displayName?.trim() || (props.userId ? shortId(props.userId) : "You");
  const myBadge =
    [call.micOn ? "Mic" : null, call.camOn ? "Cam" : null].filter(Boolean).join(" ") ||
    null;

  const tiles = useMemo(() => {
    const t: Array<{
      key: string;
      stream: MediaStream | null;
      label: string;
      rightBadge: string | null;
      muted?: boolean;
      mirror?: boolean;
    }> = [];

    t.push({
      key: `local:${call.peerId}`,
      stream: call.localStream,
      label: `${myLabel} (You)`,
      rightBadge: myBadge,
      muted: true,
      mirror: true,
    });

    for (const r of call.remoteStreams) {
      const p = participantsByPeerId.get(r.peerId);
      const label = p?.displayName?.trim()
        ? p.displayName
        : p?.userId
          ? shortId(p.userId)
          : shortId(r.peerId);
      const badge = [p?.micOn ? "Mic" : null, p?.camOn ? "Cam" : null]
        .filter(Boolean)
        .join(" ");
      t.push({
        key: r.peerId,
        stream: r.stream,
        label,
        rightBadge: badge || null,
      });
    }

    return t;
  }, [
    call.localStream,
    call.peerId,
    call.remoteStreams,
    myBadge,
    myLabel,
    participantsByPeerId,
  ]);

  return (
    <div className="nt-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-extrabold text-[var(--foreground)]">Meet</div>
        <div className="text-xs font-semibold text-[var(--muted)]">
          {call.isReady ? (
            <span>
              Connected{" "}
              <span className="font-mono">({call.participants.length})</span>
            </span>
          ) : (
            <span>Connecting...</span>
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          className={`nt-btn ${call.camOn ? "nt-btn-accent" : "nt-btn-outline"}`}
          onClick={() => void (call.camOn ? call.disableCamera() : call.enableCamera())}
          disabled={!call.isReady || !props.userId}
          title="Toggle camera"
        >
          {call.camOn ? "Camera On" : "Camera Off"}
        </button>
        <button
          className={`nt-btn ${call.micOn ? "nt-btn-accent" : "nt-btn-outline"}`}
          onClick={() => void (call.micOn ? call.disableMic() : call.enableMic())}
          disabled={!call.isReady || !props.userId}
          title="Toggle microphone"
        >
          {call.micOn ? "Mic On" : "Mic Off"}
        </button>
        <button
          className="nt-btn nt-btn-outline ml-auto"
          onClick={props.onLeave}
          title="Leave meet"
        >
          Leave
        </button>
      </div>

      {call.error ? (
        <div className="mt-3 rounded-[10px] border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-800">
          {call.error}
        </div>
      ) : null}

      <div className="mt-3">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {tiles.map((t) => (
            <StreamTile
              key={t.key}
              stream={t.stream}
              label={t.label}
              rightBadge={t.rightBadge}
              muted={t.muted}
              mirror={t.mirror}
            />
          ))}
        </div>
        {call.remoteStreams.length === 0 ? (
          <div className="mt-2 text-xs font-semibold text-[var(--muted)]">
            No one else has joined yet.
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function RoomCall(props: {
  roomId: string;
  userId: string | null;
  displayName: string;
}) {
  const [joined, setJoined] = useState(false);

  if (!joined) {
    return (
      <CallPreview
        roomId={props.roomId}
        userId={props.userId}
        displayName={props.displayName}
        onJoin={() => setJoined(true)}
      />
    );
  }

  return (
    <CallSession
      roomId={props.roomId}
      userId={props.userId}
      displayName={props.displayName}
      onLeave={() => setJoined(false)}
    />
  );
}
