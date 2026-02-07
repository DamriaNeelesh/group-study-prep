"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { useRoomCall } from "@/hooks/useRoomCall";

function StreamTile(props: {
  stream: MediaStream | null;
  label: string;
  muted?: boolean;
  mirror?: boolean;
  rightBadge?: string | null;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [playError, setPlayError] = useState<string | null>(null);

  const hasVideo = Boolean(props.stream?.getVideoTracks().length);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.muted = Boolean(props.muted);
  }, [props.muted]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    setPlayError(null);

    if (!props.stream) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (el as any).srcObject = null;
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el as any).srcObject = props.stream;
    const p = el.play();
    if (p && typeof p.then === "function") {
      p.catch((e: unknown) => {
        setPlayError(e instanceof Error ? e.message : String(e));
      });
    }
  }, [props.stream]);

  return (
    <div className="relative overflow-hidden rounded-[12px] border border-black/10 bg-black shadow-[0_1px_14px_rgba(0,0,0,0.08)]">
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

export function RoomCall(props: {
  roomId: string;
  userId: string | null;
  displayName: string;
}) {
  const call = useRoomCall({
    roomId: props.roomId,
    userId: props.userId,
    displayName: props.displayName,
  });

  const participantsById = useMemo(() => {
    const m = new Map<string, (typeof call.participants)[number]>();
    for (const p of call.participants) m.set(p.userId, p);
    return m;
  }, [call.participants]);

  const myLabel =
    props.displayName?.trim() ||
    (props.userId ? `${props.userId.slice(0, 8)}...${props.userId.slice(-4)}` : "You");

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
      </div>

      {call.error ? (
        <div className="mt-3 rounded-[10px] border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-800">
          {call.error}
        </div>
      ) : null}

      <div className="mt-3">
        <StreamTile
          stream={call.localStream}
          label={`${myLabel} (You)`}
          muted
          mirror
          rightBadge={[
            call.micOn ? "Mic" : null,
            call.camOn ? "Cam" : null,
          ]
            .filter(Boolean)
            .join(" ") || null}
        />
      </div>

      <div className="mt-3">
        {call.remoteStreams.length === 0 ? (
          <div className="text-xs font-semibold text-[var(--muted)]">
            No one else in the call yet.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {call.remoteStreams.map((r) => {
              const p = participantsById.get(r.userId);
              const label = p?.displayName?.trim()
                ? p.displayName
                : `${r.userId.slice(0, 8)}...${r.userId.slice(-4)}`;
              const badge = [
                p?.micOn ? "Mic" : null,
                p?.camOn ? "Cam" : null,
              ]
                .filter(Boolean)
                .join(" ");
              return (
                <StreamTile
                  key={r.userId}
                  stream={r.stream}
                  label={label}
                  rightBadge={badge || null}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

