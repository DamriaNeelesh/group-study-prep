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
  const suppressEventsRef = useRef(false);
  const lastVideoIdRef = useRef<string | null>(null);
  const [seekInput, setSeekInput] = useState<string>("");

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
    },
    [],
  );

  const onStateChange = useCallback(
    (e: YouTubeEvent<number>) => {
      if (suppressEventsRef.current) return;
      // https://developers.google.com/youtube/iframe_api_reference#Playback_status
      // 1 = playing, 2 = paused
      if (e.data === 1) props.onPlay(getCurrentTimeSafe());
      if (e.data === 2) props.onPause(getCurrentTimeSafe());
    },
    [getCurrentTimeSafe, props],
  );

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
        try {
          p.cueVideoById({ videoId: props.videoId, startSeconds: targetSeconds });
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
      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
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
          <div className="flex aspect-video w-full items-center justify-center bg-zinc-50 text-sm text-zinc-500">
            Set a YouTube video to start.
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-zinc-600">
          {props.videoId ? (
            <span>
              State:{" "}
              <span className="font-medium text-zinc-900">
                {props.isPaused ? "Paused" : "Playing"}
              </span>{" "}
              at{" "}
              <span className="font-mono text-zinc-900">
                {Math.floor(props.effectivePositionSeconds)}s
              </span>
            </span>
          ) : (
            <span className="font-medium">No video</span>
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
            className="w-32 rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400"
            inputMode="numeric"
          />
          <button
            type="submit"
            className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800"
            disabled={!props.videoId}
          >
            Seek
          </button>
        </form>
      </div>
    </div>
  );
}

