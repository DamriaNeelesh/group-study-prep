"use client";

import type { YouTubeEvent, YouTubePlayer } from "react-youtube";
import YouTube from "react-youtube";
import { useCallback, useEffect, useRef, useState } from "react";

type Props = {
  videoId: string | null;
  isPaused: boolean;
  effectivePositionSeconds: number;
  playbackRate: number;
  onPlay: (positionSeconds: number) => void;
  onPause: (positionSeconds: number) => void;
  onSeek: (positionSeconds: number) => void;
};

function clampNonNegative(n: number) {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n;
}

export function SyncedPlayer(props: Props) {
  const playerRef = useRef<YouTubePlayer | null>(null);
  const [playerReady, setPlayerReady] = useState(false);
  const suppressEventsRef = useRef(false);
  const lastVideoIdRef = useRef<string | null>(null);
  const [seekInput, setSeekInput] = useState<string>("");
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);

  const withSuppressedEvents = useCallback(async (fn: () => void | Promise<void>) => {
    suppressEventsRef.current = true;
    try {
      await fn();
    } finally {
      // Give YouTube a moment to fire state changes before re-enabling local event handling.
      setTimeout(() => {
        suppressEventsRef.current = false;
      }, 250);
    }
  }, []);

  const getCurrentTimeSafe = useCallback(() => {
    const p = playerRef.current;
    if (!p) return 0;
    try {
      const t = p.getCurrentTime();
      return clampNonNegative(Number(t));
    } catch {
      return 0;
    }
  }, []);

  const onReady = useCallback(
    (e: YouTubeEvent) => {
      playerRef.current = e.target;
      setPlayerReady(true);
    },
    [],
  );

  const onStateChange = useCallback(
    (e: YouTubeEvent<number>) => {
      if (suppressEventsRef.current) return;
      // https://developers.google.com/youtube/iframe_api_reference#Playback_status
      // 1 = playing, 2 = paused
      if (e.data === 1) {
        setAutoplayBlocked(false);
        props.onPlay(getCurrentTimeSafe());
      }
      if (e.data === 2) props.onPause(getCurrentTimeSafe());
    },
    [getCurrentTimeSafe, props],
  );

  const wantsPlaying = Boolean(props.videoId && !props.isPaused);

  // If the room is playing but the browser blocks autoplay, show a "Start" overlay.
  useEffect(() => {
    if (!playerReady) return;
    if (!props.videoId) {
      setAutoplayBlocked(false);
      return;
    }
    if (!wantsPlaying) {
      setAutoplayBlocked(false);
      return;
    }

    const p = playerRef.current;
    if (!p) return;

    let cancelled = false;
    const id = setTimeout(() => {
      if (cancelled) return;
      try {
        const state = p.getPlayerState();
        // 1 = playing, 3 = buffering
        if (state !== 1 && state !== 3) setAutoplayBlocked(true);
      } catch {
        // ignore
      }
    }, 900);

    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [playerReady, props.videoId, wantsPlaying]);

  // Keep player aligned with authoritative room state.
  useEffect(() => {
    const p = playerRef.current;
    if (!p) return;
    if (!props.videoId) return;

    void withSuppressedEvents(async () => {
      const targetSeconds = clampNonNegative(props.effectivePositionSeconds);
      const videoChanged = lastVideoIdRef.current !== props.videoId;

      if (videoChanged) {
        lastVideoIdRef.current = props.videoId;
        setAutoplayBlocked(false);
        try {
          if (props.isPaused) {
            p.cueVideoById({ videoId: props.videoId, startSeconds: targetSeconds });
          } else {
            // `loadVideoById` is better at starting at the right timestamp for late joiners.
            p.loadVideoById({ videoId: props.videoId, startSeconds: targetSeconds });
          }
        } catch {
          // ignore
        }
      } else {
        try {
          const current = p.getCurrentTime();
          if (Math.abs(Number(current) - targetSeconds) > 1.25) {
            p.seekTo(targetSeconds, true);
          }
        } catch {
          // ignore
        }
      }

      try {
        p.setPlaybackRate(props.playbackRate);
      } catch {
        // ignore
      }

      try {
        if (props.isPaused) p.pauseVideo();
        else p.playVideo();
      } catch {
        // ignore (autoplay restrictions, etc.)
      }
    });
  }, [
    props.effectivePositionSeconds,
    props.isPaused,
    props.playbackRate,
    props.videoId,
    withSuppressedEvents,
  ]);

  // Detect manual seeks from the native YouTube controls (best-effort).
  useEffect(() => {
    const p = playerRef.current;
    if (!p) return;
    if (!props.videoId) return;

    let last = 0;
    let lastTickAt = Date.now();

    const id = setInterval(() => {
      if (!playerRef.current) return;
      if (suppressEventsRef.current) {
        last = getCurrentTimeSafe();
        lastTickAt = Date.now();
        return;
      }

      const now = Date.now();
      const dt = (now - lastTickAt) / 1000;
      lastTickAt = now;

      const t = getCurrentTimeSafe();
      const expected = last + dt;
      last = t;

      if (Math.abs(t - expected) > 2.0) {
        props.onSeek(t);
      }
    }, 1000);

    return () => clearInterval(id);
  }, [getCurrentTimeSafe, props]);

  return (
    <div className="w-full">
      <div className="relative overflow-hidden rounded-[var(--radius-card)] border border-black/10 bg-white shadow-[var(--shadow-card)]">
        {props.videoId ? (
          <YouTube
            videoId={props.videoId}
            onReady={onReady}
            onStateChange={onStateChange}
            className="w-full"
            iframeClassName="aspect-video w-full"
            opts={{
              width: "100%",
              height: "100%",
              playerVars: {
                autoplay: 0,
                controls: 1,
                rel: 0,
                modestbranding: 1,
              },
            }}
          />
        ) : (
          <div className="flex aspect-video w-full items-center justify-center bg-[var(--surface-2)] text-sm font-semibold text-[var(--muted)]">
            Set a YouTube video to start.
          </div>
        )}

        {props.videoId && wantsPlaying && autoplayBlocked ? (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-md rounded-[14px] border border-white/20 bg-black/70 px-4 py-4 text-center text-white shadow-[0_20px_60px_rgba(0,0,0,0.35)]">
              <div className="text-sm font-extrabold">
                Click to start synced playback
              </div>
              <div className="mt-1 text-xs font-semibold text-white/80">
                Autoplay is blocked. You will join live at{" "}
                <span className="font-mono text-white">
                  {Math.floor(props.effectivePositionSeconds)}s
                </span>
                .
              </div>
              <button
                className="mt-3 nt-btn nt-btn-accent h-11 w-full"
                onClick={() => {
                  setAutoplayBlocked(false);
                  void withSuppressedEvents(async () => {
                    const p = playerRef.current;
                    if (!p) return;
                    const t = clampNonNegative(props.effectivePositionSeconds);
                    try {
                      p.seekTo(t, true);
                    } catch {
                      // ignore
                    }
                    try {
                      p.playVideo();
                    } catch {
                      // ignore
                    }
                  });
                }}
              >
                Start Now
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm font-semibold text-[var(--muted)]">
          {props.videoId ? (
            <span>
              State:{" "}
              <span className="font-extrabold text-[var(--foreground)]">
                {props.isPaused ? "Paused" : "Playing"}
              </span>{" "}
              at{" "}
              <span className="font-mono text-[var(--foreground)]">
                {Math.floor(props.effectivePositionSeconds)}s
              </span>
            </span>
          ) : (
            <span className="font-extrabold text-[var(--foreground)]">No video</span>
          )}
        </div>

        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const n = Number(seekInput);
            if (!Number.isFinite(n)) return;
            props.onSeek(clampNonNegative(n));
            setSeekInput("");
          }}
        >
          <input
            value={seekInput}
            onChange={(e) => setSeekInput(e.target.value)}
            placeholder="Seek (sec)"
            className="w-32 nt-input"
            inputMode="numeric"
          />
          <button
            type="submit"
            className="nt-btn nt-btn-primary"
            disabled={!props.videoId}
          >
            Seek
          </button>
        </form>
      </div>
    </div>
  );
}
