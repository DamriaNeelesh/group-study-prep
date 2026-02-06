"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import { useEffect, useMemo, useState } from "react";

import type { PresenceMeta, PresenceUser } from "@/hooks/useRoomSync";
import { useWebRTCAudio } from "@/hooks/useWebRTCAudio";

function stopStream(stream: MediaStream | null) {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch {
      // ignore
    }
  }
}

export function AudioChat(props: {
  channel: RealtimeChannel | null;
  selfUserId: string | null;
  presence: PresenceUser[];
  updatePresence: (patch: Partial<PresenceMeta>) => Promise<void>;
}) {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);

  const remoteAudioUserIds = useMemo(() => {
    const selfUserId = props.selfUserId;
    return props.presence
      .filter((u) => u.audio)
      .map((u) => u.userId)
      .filter((id) => id && id !== selfUserId);
  }, [props.presence, props.selfUserId]);

  const { remoteStreams, peerCount } = useWebRTCAudio({
    channel: props.channel,
    selfUserId: props.selfUserId,
    localStream,
    remoteAudioUserIds,
  });

  const isJoined = Boolean(localStream);

  useEffect(() => {
    return () => stopStream(localStream);
  }, [localStream]);

  async function join() {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Your browser does not support getUserMedia().");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });
      setLocalStream(stream);
      await props.updatePresence({ audio: true });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function leave() {
    setError(null);
    stopStream(localStream);
    setLocalStream(null);
    await props.updatePresence({ audio: false });
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-zinc-900">Audio Chat</div>
          <div className="text-xs text-zinc-600">
            Peers: <span className="font-mono">{peerCount}</span>
          </div>
        </div>

        {isJoined ? (
          <button
            className="rounded-md border border-zinc-200 px-3 py-2 text-sm font-medium hover:bg-zinc-50"
            onClick={() => void leave()}
          >
            Leave Audio
          </button>
        ) : (
          <button
            className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800"
            onClick={() => void join()}
          >
            Join Audio
          </button>
        )}
      </div>

      {error ? (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      <div className="mt-3 flex flex-col gap-2">
        {Object.entries(remoteStreams).length === 0 ? (
          <div className="text-xs text-zinc-600">No remote audio yet.</div>
        ) : (
          Object.entries(remoteStreams).map(([userId, stream]) => (
            <div key={userId} className="flex items-center justify-between gap-3">
              <div className="text-xs text-zinc-700">
                Listening to <span className="font-mono">{userId}</span>
              </div>
              <audio
                autoPlay
                playsInline
                ref={(el) => {
                  if (!el) return;
                  if (el.srcObject !== stream) el.srcObject = stream;
                }}
              />
            </div>
          ))
        )}
      </div>
    </div>
  );
}

