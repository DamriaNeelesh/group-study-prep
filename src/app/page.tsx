"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { requireSupabaseBrowserClient } from "@/lib/supabase/client";
import { useSupabaseAuth } from "@/hooks/useSupabaseAuth";
import { SiteHeader } from "@/components/SiteHeader";
import { Toast } from "@/components/Toast";
import {
  extractRoomIdFromInput,
  looksLikeShortRoomCode,
} from "@/lib/roomId";

function shortId(id: string) {
  const trimmed = id.trim();
  if (trimmed.length <= 14) return trimmed;
  return `${trimmed.slice(0, 8)}...${trimmed.slice(-4)}`;
}

export default function HomePage() {
  const router = useRouter();
  const auth = useSupabaseAuth();

  const [roomId, setRoomId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uiToast, setUiToast] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [displayNameInput, setDisplayNameInput] = useState("");

  useEffect(() => {
    setDisplayNameInput(auth.displayName);
  }, [auth.displayName, auth.user?.id]);

  async function createRoom() {
    if (!auth.user) return;
    setError(null);
    setBusy(true);
    try {
      const supabase = requireSupabaseBrowserClient();
      const id = crypto.randomUUID();
      const { error } = await supabase.from("rooms").insert({ id });
      if (error) throw error;
      router.push(`/room/${id}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function joinRoom() {
    const input = roomId.trim();
    if (!input) return;

    const id = extractRoomIdFromInput(input);
    if (!id) {
      setError(
        looksLikeShortRoomCode(input)
          ? "That looks like only the first 8 characters. Paste the full Room ID (UUID) or the full room link."
          : "Please paste a full Room ID (UUID) or a full room link like /room/<uuid>.",
      );
      return;
    }

    setError(null);
    router.push(`/room/${id}`);
  }

  return (
    <div className="min-h-screen">
      <SiteHeader
        userId={auth.user?.id ?? null}
        isGuest={Boolean(auth.user?.is_anonymous)}
        onGoogle={() => void auth.signInWithGoogle()}
        onSignOut={() => void auth.signOut()}
      />

      <main className="nt-container pb-16 pt-10">
        <section className="nt-green-card p-6 sm:p-10">
          <div className="relative z-10 grid gap-8 lg:grid-cols-12 lg:items-end">
            <div className="lg:col-span-7">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-extrabold uppercase tracking-wide text-white/90">
                <span className="h-2 w-2 rounded-full bg-white/90" />
                Realtime Study Rooms
              </div>
              <h1 className="mt-3 text-4xl font-extrabold tracking-tight text-white sm:text-5xl">
                Study together.
                <br />
                <span className="text-white/90">Stay perfectly synced.</span>
              </h1>
              <p className="mt-3 max-w-2xl text-sm font-semibold text-white/85 sm:text-base">
                Create a room, share the link, and watch YouTube in sync. Includes optional in-room Meet (camera/mic).
              </p>

              <div className="mt-5 flex flex-wrap gap-2 text-xs font-bold text-white/90">
                <span className="rounded-full border border-white/15 bg-black/20 px-3 py-2">
                  YouTube Sync
                </span>
                <span className="rounded-full border border-white/15 bg-black/20 px-3 py-2">
                  Meet (Beta)
                </span>
                <span className="rounded-full border border-white/15 bg-black/20 px-3 py-2">
                  Raise Hand
                </span>
              </div>
            </div>

            <div className="lg:col-span-5">
              <div className="rounded-[16px] border border-white/20 bg-black/20 p-4 backdrop-blur-sm sm:p-5">
                <div className="text-sm font-extrabold text-white">Start</div>
                <div className="mt-1 text-xs font-semibold text-white/80">
                  Create a new room, or paste a room link to join.
                </div>

                <div className="mt-4 grid grid-cols-1 gap-3">
                  <button
                    className="nt-btn nt-btn-accent h-12 w-full"
                    onClick={() => void createRoom()}
                    disabled={!auth.user || busy}
                  >
                    Create Room
                  </button>

                  <form
                    className="flex items-center gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      joinRoom();
                    }}
                  >
                    <input
                      value={roomId}
                      onChange={(e) => setRoomId(e.target.value)}
                      placeholder="Paste room link or UUID"
                      className="h-12 w-full rounded-[12px] bg-white/95 px-4 text-sm font-semibold text-[#2b2b2b] outline-none placeholder:text-[#717171]"
                    />
                    <button
                      className="nt-btn nt-btn-primary h-12 px-5"
                      type="submit"
                      disabled={!roomId.trim() || busy}
                    >
                      Join
                    </button>
                  </form>
                </div>

                {(auth.error || error) ? (
                  <div className="mt-3 rounded-[12px] border border-white/15 bg-black/30 px-4 py-3 text-sm font-semibold text-white">
                    {auth.error ?? error}
                  </div>
                ) : null}

                <div className="mt-3 text-xs font-semibold text-white/75">
                  Tip: inside a room, use <span className="font-extrabold">Copy Link</span>{" "}
                  and share it with classmates.
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="nt-card p-5">
            <div className="text-xs font-extrabold uppercase tracking-wide text-[var(--muted)]">
              Fast Sync
            </div>
            <div className="mt-1 text-sm font-extrabold text-[var(--foreground)]">
              Low-latency controls
            </div>
            <div className="mt-2 text-xs font-semibold text-[var(--muted)]">
              Broadcast for play/pause/seek, DB state for late joiners.
            </div>
          </div>
          <div className="nt-card p-5">
            <div className="text-xs font-extrabold uppercase tracking-wide text-[var(--muted)]">
              Meet (Beta)
            </div>
            <div className="mt-1 text-sm font-extrabold text-[var(--foreground)]">
              Camera + mic in room
            </div>
            <div className="mt-2 text-xs font-semibold text-[var(--muted)]">
              Optional WebRTC meet for small groups. Join only when you need it.
            </div>
          </div>
          <div className="nt-card p-5">
            <div className="text-xs font-extrabold uppercase tracking-wide text-[var(--muted)]">
              Friendly Presence
            </div>
            <div className="mt-1 text-sm font-extrabold text-[var(--foreground)]">
              Names, raise hand
            </div>
            <div className="mt-2 text-xs font-semibold text-[var(--muted)]">
              Add your display name so classmates can recognize you.
            </div>
          </div>
        </section>

        <section className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-12">
          <aside className="lg:col-span-5">
            <div className="nt-card p-6">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-extrabold text-[var(--foreground)]">
                    Your Profile
                  </div>
                  <div className="mt-1 text-xs font-semibold text-[var(--muted)]">
                    Guests work instantly. Google is optional.
                  </div>
                </div>
                {auth.user?.is_anonymous ? <span className="nt-badge">Guest</span> : null}
              </div>

              <div className="mt-4 rounded-[14px] bg-[var(--surface-2)] p-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-extrabold uppercase tracking-wide text-[var(--muted)]">
                    User ID
                  </div>
                  <button
                    className="text-xs font-extrabold text-[var(--foreground)] hover:underline disabled:opacity-50"
                    disabled={!auth.user?.id}
                    onClick={() => {
                      void (async () => {
                        const id = auth.user?.id;
                        if (!id) return;
                        try {
                          await navigator.clipboard?.writeText(id);
                          setUiToast("User ID copied");
                        } catch {
                          setUiToast("Copy failed");
                        }
                      })();
                    }}
                  >
                    Copy
                  </button>
                </div>
                <div className="mt-1 font-mono text-xs font-bold text-[var(--foreground)]">
                  {auth.user?.id ? shortId(auth.user.id) : "(connecting...)"}
                </div>
              </div>

              <div className="mt-4 text-xs font-semibold text-[var(--muted)]">
                Display name
              </div>
              <input
                value={displayNameInput}
                onChange={(e) => setDisplayNameInput(e.target.value)}
                onBlur={() => void auth.setDisplayName(displayNameInput.trim())}
                placeholder="e.g. Alex"
                className="mt-1 w-full nt-input"
                disabled={!auth.user}
              />
              <div className="mt-2 text-xs font-semibold text-[var(--muted)]">
                This shows up in room Presence and Meet.
              </div>

              <div className="mt-5 flex flex-col gap-2">
                <button
                  className="nt-btn nt-btn-primary h-11"
                  onClick={() => void auth.signInWithGoogle()}
                  disabled={busy}
                >
                  {auth.user?.is_anonymous ? "Upgrade with Google" : "Sign in with Google"}
                </button>
                <div className="text-xs font-semibold text-[var(--muted)]">
                  If Google says identity already exists, use a different Google account or unlink the old user in Supabase.
                </div>
              </div>
            </div>

            <details className="mt-4 nt-card p-6">
              <summary className="cursor-pointer text-sm font-extrabold text-[var(--foreground)]">
                Email Login (Optional)
              </summary>
              <div className="mt-4 flex flex-col gap-2">
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="nt-input"
                />
                <button
                  className="nt-btn nt-btn-outline"
                  onClick={() => void auth.signInWithEmailOtp(email)}
                  disabled={!email.trim()}
                >
                  Send magic link
                </button>
              </div>
            </details>
          </aside>

          <section className="lg:col-span-7">
            <div className="nt-card p-6">
              <div className="text-sm font-extrabold text-[var(--foreground)]">
                Quick start
              </div>
              <div className="mt-1 text-xs font-semibold text-[var(--muted)]">
                A simple flow your class can follow every time.
              </div>

              <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="rounded-[14px] border border-black/5 bg-white p-4">
                  <div className="text-xs font-extrabold text-[var(--muted)]">1</div>
                  <div className="mt-1 text-sm font-extrabold text-[var(--foreground)]">
                    Create room
                  </div>
                  <div className="mt-1 text-xs font-semibold text-[var(--muted)]">
                    Click Create Room on Home.
                  </div>
                </div>
                <div className="rounded-[14px] border border-black/5 bg-white p-4">
                  <div className="text-xs font-extrabold text-[var(--muted)]">2</div>
                  <div className="mt-1 text-sm font-extrabold text-[var(--foreground)]">
                    Copy link
                  </div>
                  <div className="mt-1 text-xs font-semibold text-[var(--muted)]">
                    Inside the room, tap Copy Link.
                  </div>
                </div>
                <div className="rounded-[14px] border border-black/5 bg-white p-4">
                  <div className="text-xs font-extrabold text-[var(--muted)]">3</div>
                  <div className="mt-1 text-sm font-extrabold text-[var(--foreground)]">
                    Paste and join
                  </div>
                  <div className="mt-1 text-xs font-semibold text-[var(--muted)]">
                    Everyone pastes the full link or UUID.
                  </div>
                </div>
              </div>

              <div className="mt-5 rounded-[14px] border border-black/5 bg-[var(--surface-2)] p-4 text-xs font-semibold text-[var(--foreground)]">
                Room links look like <span className="font-mono">/room/&lt;uuid&gt;</span>. If you only paste the first 8 characters, it will not work.
              </div>
            </div>
          </section>
        </section>
      </main>

      {uiToast ? <Toast message={uiToast} onDismiss={() => setUiToast(null)} /> : null}
    </div>
  );
}
