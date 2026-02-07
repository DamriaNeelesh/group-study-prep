"use client";

import { useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";

import { SyncedPlayer } from "@/components/SyncedPlayer";
import { RoomCall } from "@/components/RoomCall";
import { Toast } from "@/components/Toast";
import { SiteHeader } from "@/components/SiteHeader";
import { useRoomSync } from "@/hooks/useRoomSync";
import { useSupabaseAuth } from "@/hooks/useSupabaseAuth";
import { isUuid } from "@/lib/roomId";
import { normalizeYouTubeId } from "@/lib/youtube";

export default function RoomPage() {
  const params = useParams<{ id: string | string[] }>();
  const rawId = typeof params.id === "string" ? params.id : params.id?.[0] ?? "";
  const roomId = isUuid(rawId) ? rawId : "";
  const router = useRouter();
  const auth = useSupabaseAuth();
  const [uiToast, setUiToast] = useState<string | null>(null);

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
    <div className="min-h-screen">
      <SiteHeader
        userId={auth.user?.id ?? null}
        isGuest={Boolean(auth.user?.is_anonymous)}
        onGoogle={() => void auth.signInWithGoogle()}
        onSignOut={() => void auth.signOut()}
      />

      <main className="nt-container pb-12 pt-8">
        <header className="nt-card relative overflow-hidden p-6">
          <div className="pointer-events-none absolute inset-0 opacity-60">
            <div className="absolute -left-24 -top-24 h-64 w-64 rounded-full bg-[var(--accent)]/20 blur-3xl" />
            <div className="absolute -right-24 -top-24 h-64 w-64 rounded-full bg-black/10 blur-3xl" />
          </div>

          <div className="relative flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-[var(--surface-2)] px-3 py-1 text-xs font-extrabold text-[var(--foreground)]">
                  Room
                </span>
                <span className="rounded-full bg-[var(--accent-soft)] px-3 py-1 text-xs font-extrabold text-[var(--accent-2)]">
                  Online: <span className="font-mono">{room.presence.length}</span>
                </span>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <div className="rounded-[12px] border border-black/5 bg-white px-3 py-2 text-sm font-extrabold text-[var(--foreground)]">
                  <span className="font-mono break-all">{rawId}</span>
                </div>
                <button
                  className="nt-btn nt-btn-outline h-10 px-4"
                  onClick={() => {
                    void (async () => {
                      if (!roomId) return;
                      try {
                        await navigator.clipboard?.writeText(roomId);
                        setUiToast("Room ID copied");
                      } catch {
                        setUiToast("Copy failed");
                      }
                    })();
                  }}
                  disabled={!roomId}
                  title="Copy Room ID (UUID)"
                >
                  Copy ID
                </button>
                <button
                  className="nt-btn nt-btn-outline h-10 px-4"
                  onClick={() => {
                    void (async () => {
                      try {
                        await navigator.clipboard?.writeText(location.href);
                        setUiToast("Link copied");
                      } catch {
                        setUiToast("Copy failed");
                      }
                    })();
                  }}
                  disabled={!roomId}
                  title="Copy full room link"
                >
                  Copy Link
                </button>
              </div>

              <div className="mt-3 text-xs font-semibold text-[var(--muted)]">
                Tip: share the link in WhatsApp or your class group, then everyone pastes it on Home to join.
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                className="nt-btn nt-btn-outline"
                onClick={() => {
                  void (async () => {
                    await room.resyncRoom();
                    setUiToast("Resynced");
                  })();
                }}
                disabled={!room.isReady}
                title="Reload room state from DB"
              >
                Resync
              </button>
              <button
                className="nt-btn nt-btn-primary"
                onClick={() => router.push("/")}
                title="Go back to Home"
              >
                Home
              </button>
            </div>
          </div>
        </header>

        {!roomId ? (
          <section className="mt-6 nt-card p-5">
            <div className="text-sm font-extrabold text-[var(--foreground)]">
              Invalid room link
            </div>
            <div className="mt-2 text-sm font-semibold text-[var(--muted)]">
              This page expects a full Room ID (UUID). Paste the full room link (from
              Copy Link) or create a new room from Home.
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                className="nt-btn nt-btn-primary"
                onClick={() => router.push("/")}
              >
                Go Home
              </button>
            </div>
          </section>
        ) : null}

        {!auth.user ? (
          <section className="nt-card p-5">
            <div className="text-sm font-semibold text-[var(--foreground)]">
              Signing in...
            </div>
            {auth.error ? (
              <div className="mt-3 rounded-[10px] border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                {auth.error}
              </div>
            ) : null}
          </section>
        ) : null}

        {room.error ? (
          <section className="rounded-[12px] border border-red-200 bg-red-50 p-5 text-sm font-semibold text-red-800">
            {room.error}
          </section>
        ) : null}

        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
          <section className="lg:col-span-2">
            <div className="nt-card p-5">
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                  <div className="flex flex-col gap-1">
                    <div className="text-sm font-extrabold text-[var(--foreground)]">
                      Synced YouTube
                    </div>
                    <div className="text-xs font-medium text-[var(--muted)]">
                      Broadcast for fast control, DB update for reliable state.
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      className="nt-btn nt-btn-accent"
                      onClick={() => void room.raiseHand()}
                      disabled={!room.isReady || !auth.user}
                    >
                      Raise Hand
                    </button>
                    {me?.handRaised ? (
                      <button
                        className="nt-btn nt-btn-outline"
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
                    className="w-full nt-input"
                    disabled={!room.isReady}
                  />
                  <button
                    type="submit"
                    className="nt-btn nt-btn-primary"
                    disabled={!room.isReady}
                  >
                    Set Video
                  </button>
                </form>

                {videoError ? (
                  <div className="rounded-[10px] border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
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

          <aside className="flex flex-col gap-6 lg:sticky lg:top-24 lg:self-start">
            {roomId ? (
              <RoomCall
                roomId={roomId}
                userId={auth.user?.id ?? null}
                displayName={auth.displayName}
              />
            ) : null}
            <div className="nt-card p-4">
              <div className="text-sm font-extrabold text-[var(--foreground)]">Presence</div>
              <div className="mt-2 flex flex-col gap-2">
                {room.presence.length === 0 ? (
                  <div className="text-xs font-medium text-[var(--muted)]">No one online.</div>
                ) : (
                  room.presence.map((u) => (
                    <div
                      key={u.userId}
                      className="flex items-center justify-between gap-3 rounded-[10px] border border-black/5 bg-white px-3 py-2"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-bold text-[var(--foreground)]">
                          {u.displayName || u.userId.slice(0, 8)}
                        </div>
                        <div className="text-xs font-medium text-[var(--muted)]">
                          <span className="font-mono" title={u.userId}>
                            {u.userId.slice(0, 8)}...{u.userId.slice(-4)}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 text-xs font-semibold text-[var(--muted)]">
                        {u.handRaised ? (
                          <span className="rounded-full bg-amber-50 px-2 py-1 text-amber-700">
                            Hand
                          </span>
                        ) : null}
                        <span className="rounded-full bg-[var(--surface-2)] px-2 py-1 text-[var(--foreground)]">
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

      {uiToast || room.toast ? (
        <Toast
          message={uiToast ?? room.toast ?? ""}
          onDismiss={() => {
            if (uiToast) setUiToast(null);
            else room.clearToast();
          }}
        />
      ) : null}
    </div>
  );
}
