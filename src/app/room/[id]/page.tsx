"use client";

import { useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";

import { AudioChat } from "@/components/AudioChat";
import { SyncedPlayer } from "@/components/SyncedPlayer";
import { Toast } from "@/components/Toast";
import { useRoomSync } from "@/hooks/useRoomSync";
import { useSupabaseAuth } from "@/hooks/useSupabaseAuth";
import { normalizeYouTubeId } from "@/lib/youtube";

export default function RoomPage() {
  const params = useParams<{ id: string | string[] }>();
  const roomId = typeof params.id === "string" ? params.id : params.id?.[0] ?? "";
  const router = useRouter();
  const auth = useSupabaseAuth();

  const room = useRoomSync({
    roomId,
    userId: auth.user?.id ?? null,
    displayName: auth.displayName,
  });

  const [videoInput, setVideoInput] = useState("");
  const [videoError, setVideoError] = useState<string | null>(null);

  const me = useMemo(() => {
    if (!auth.user) return null;
    return room.presence.find((u) => u.userId === auth.user?.id) ?? null;
  }, [auth.user, room.presence]);

  return (
    <div className="min-h-screen bg-zinc-50">
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-10">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-col gap-1">
            <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              Room
            </div>
            <h1 className="text-xl font-semibold tracking-tight text-zinc-900">
              <span className="font-mono">{roomId}</span>
            </h1>
            <div className="text-sm text-zinc-600">
              Online: <span className="font-mono">{room.presence.length}</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm font-medium hover:bg-zinc-50"
              onClick={() => {
                void navigator.clipboard?.writeText(location.href);
              }}
            >
              Copy Link
            </button>
            <button
              className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm font-medium hover:bg-zinc-50"
              onClick={() => void room.resyncRoom()}
              disabled={!room.isReady}
            >
              Resync
            </button>
            <button
              className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm font-medium hover:bg-zinc-50"
              onClick={() => router.push("/")}
            >
              Home
            </button>
          </div>
        </header>

        {!auth.user ? (
          <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
            <div className="text-sm text-zinc-700">Signing in...</div>
            {auth.error ? (
              <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                {auth.error}
              </div>
            ) : null}
          </section>
        ) : null}

        {room.error ? (
          <section className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">
            {room.error}
          </section>
        ) : null}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <section className="lg:col-span-2">
            <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                  <div className="flex flex-col gap-1">
                    <div className="text-sm font-medium text-zinc-900">
                      Synced YouTube
                    </div>
                    <div className="text-xs text-zinc-600">
                      Broadcast for fast control, DB update for reliable state.
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
                      onClick={() => void room.raiseHand()}
                      disabled={!room.isReady || !auth.user}
                    >
                      Raise Hand
                    </button>
                    {me?.handRaised ? (
                      <button
                        className="rounded-md border border-zinc-200 px-3 py-2 text-sm font-medium hover:bg-zinc-50"
                        onClick={() => void room.updatePresence({ handRaised: false })}
                        disabled={!room.isReady}
                      >
                        Lower
                      </button>
                    ) : null}
                  </div>
                </div>

                <form
                  className="flex flex-col gap-2 sm:flex-row sm:items-center"
                  onSubmit={(e) => {
                    e.preventDefault();
                    setVideoError(null);
                    const id = normalizeYouTubeId(videoInput);
                    if (!id) {
                      setVideoError("Please paste a valid YouTube URL or 11-char video ID.");
                      return;
                    }
                    void room.setVideo(id);
                    setVideoInput("");
                  }}
                >
                  <input
                    value={videoInput}
                    onChange={(e) => setVideoInput(e.target.value)}
                    placeholder="YouTube URL or Video ID"
                    className="w-full rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400"
                    disabled={!room.isReady}
                  />
                  <button
                    type="submit"
                    className="rounded-md border border-zinc-200 px-3 py-2 text-sm font-medium hover:bg-zinc-50 disabled:opacity-50"
                    disabled={!room.isReady}
                  >
                    Set Video
                  </button>
                </form>

                {videoError ? (
                  <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                    {videoError}
                  </div>
                ) : null}

                <SyncedPlayer
                  videoId={room.room?.currentVideoId ?? null}
                  isPaused={room.room?.isPaused ?? true}
                  effectivePositionSeconds={room.effectivePlaybackPositionSeconds}
                  playbackRate={room.room?.playbackRate ?? 1}
                  onPlay={(t) => void room.play(t)}
                  onPause={(t) => void room.pause(t)}
                  onSeek={(t) => void room.seek(t)}
                />
              </div>
            </div>
          </section>

          <aside className="flex flex-col gap-6">
            <AudioChat
              channel={room.channel}
              selfUserId={auth.user?.id ?? null}
              presence={room.presence}
              updatePresence={room.updatePresence}
            />

            <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
              <div className="text-sm font-medium text-zinc-900">Presence</div>
              <div className="mt-2 flex flex-col gap-2">
                {room.presence.length === 0 ? (
                  <div className="text-xs text-zinc-600">No one online.</div>
                ) : (
                  room.presence.map((u) => (
                    <div
                      key={u.userId}
                      className="flex items-center justify-between gap-3 rounded-md border border-zinc-100 px-3 py-2"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm text-zinc-900">
                          {u.displayName || u.userId.slice(0, 8)}
                        </div>
                        <div className="text-xs text-zinc-600">
                          <span className="font-mono">{u.userId}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-zinc-600">
                        {u.audio ? (
                          <span className="rounded-full bg-emerald-50 px-2 py-1 text-emerald-700">
                            Audio
                          </span>
                        ) : null}
                        {u.handRaised ? (
                          <span className="rounded-full bg-amber-50 px-2 py-1 text-amber-700">
                            Hand
                          </span>
                        ) : null}
                        <span className="rounded-full bg-zinc-50 px-2 py-1 text-zinc-700">
                          x{u.connections}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </aside>
        </div>
      </main>

      {room.toast ? (
        <Toast message={room.toast} onDismiss={room.clearToast} />
      ) : null}
    </div>
  );
}
