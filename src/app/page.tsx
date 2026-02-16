"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { SiteHeader } from "@/components/SiteHeader";
import { Toast } from "@/components/Toast";
import { useSupabaseAuth } from "@/hooks/useSupabaseAuth";
import { extractRoomIdFromInput, looksLikeShortRoomCode } from "@/lib/roomId";

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
      const newRoomId =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
              const r = Math.floor(Math.random() * 16);
              const v = c === "x" ? r : (r & 0x3) | 0x8;
              return v.toString(16);
            });
      router.push(`/room/${newRoomId}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function joinRoom() {
    const input = roomId.trim();
    if (!input) return;

    let id = input;
    try {
      if (input.includes("/lecture/")) {
        id = input.split("/lecture/")[1].split("?")[0];
      } else if (input.includes("/room/")) {
        id = input.split("/room/")[1].split("?")[0];
      }
    } catch {
      // ignore
    }

    id = extractRoomIdFromInput(id) || id;

    if (!id) {
      setError(
        looksLikeShortRoomCode(input)
          ? "That looks like only the first 8 characters. Paste the full Room ID (UUID) or full room link."
          : "Paste a full Room ID (UUID) or room link like /room/<uuid>.",
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
        <section className="nt-green-card p-7 sm:p-10">
          <div className="relative z-10 grid gap-8 lg:grid-cols-12 lg:items-end">
            <div className="lg:col-span-7">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-white/85">
                <span className="h-2 w-2 rounded-full bg-[#54b0ff]" />
                Synced Group Study
              </div>

              <h1 className="nt-title-display mt-4 text-4xl text-white sm:text-5xl lg:text-6xl">
                Study together
                <br />
                in one seamless room.
              </h1>

              <p className="mt-4 max-w-2xl text-sm font-medium text-white/78 sm:text-base">
                Share one room link, play the same YouTube lesson at the same timestamp,
                discuss with live camera/audio, and keep everyone aligned with built-in chat.
              </p>

              <div className="mt-5 flex flex-wrap gap-2 text-xs font-semibold text-white/88">
                <span className="rounded-full border border-white/18 bg-black/20 px-3 py-2">
                  Frame-accurate sync
                </span>
                <span className="rounded-full border border-white/18 bg-black/20 px-3 py-2">
                  Camera + mic
                </span>
                <span className="rounded-full border border-white/18 bg-black/20 px-3 py-2">
                  Group chat
                </span>
              </div>
            </div>

            <div className="lg:col-span-5">
              <div className="rounded-[20px] border border-white/20 bg-white/10 p-4 backdrop-blur-md sm:p-5">
                <div className="text-sm font-semibold text-white">Start a room</div>
                <div className="mt-1 text-xs font-medium text-white/78">
                  Create instantly or join with a shared link.
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
                      className="h-12 w-full rounded-full border border-white/30 bg-white/92 px-4 text-sm font-medium text-[#212124] outline-none placeholder:text-[#6e6e73]"
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

                {auth.error || error ? (
                  <div className="mt-3 rounded-[12px] border border-white/20 bg-black/22 px-4 py-3 text-sm font-medium text-white">
                    {auth.error ?? error}
                  </div>
                ) : null}

                <div className="mt-3 text-xs font-medium text-white/72">
                  Tip: use <span className="font-semibold">Copy Link</span> inside the room and
                  send it to your class group.
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="nt-card p-6">
            <div className="nt-chip inline-flex">Realtime Sync</div>
            <div className="mt-3 text-base font-semibold text-[var(--foreground)]">
              Everyone stays on the same timestamp
            </div>
            <div className="mt-2 text-sm font-medium text-[var(--muted)]">
              Play, pause, and seek are synchronized for every participant in the room.
            </div>
          </div>

          <div className="nt-card p-6">
            <div className="nt-chip inline-flex">Live Discussion</div>
            <div className="mt-3 text-base font-semibold text-[var(--foreground)]">
              Talk face-to-face with camera and audio
            </div>
            <div className="mt-2 text-sm font-medium text-[var(--muted)]">
              Join the meet panel when needed, with quick toggles for mic and camera.
            </div>
          </div>

          <div className="nt-card p-6">
            <div className="nt-chip inline-flex">Room Chat</div>
            <div className="mt-3 text-base font-semibold text-[var(--foreground)]">
              Keep notes and questions in one thread
            </div>
            <div className="mt-2 text-sm font-medium text-[var(--muted)]">
              Messages stay in context so late joiners can catch up quickly.
            </div>
          </div>
        </section>

        <section className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-12">
          <aside className="lg:col-span-5">
            <div className="nt-card p-6">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-base font-semibold text-[var(--foreground)]">
                    Your profile
                  </div>
                  <div className="mt-1 text-sm font-medium text-[var(--muted)]">
                    Guest mode works instantly. Google is optional.
                  </div>
                </div>
                {auth.user?.is_anonymous ? <span className="nt-badge">Guest</span> : null}
              </div>

              <div className="mt-4 rounded-[16px] border border-black/8 bg-[var(--surface-2)] p-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">
                    User ID
                  </div>
                  <button
                    className="text-xs font-semibold text-[var(--foreground)] hover:underline disabled:opacity-50"
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
                <div className="mt-1 font-mono text-xs font-semibold text-[var(--foreground)]">
                  {auth.user?.id ? shortId(auth.user.id) : "(connecting...)"}
                </div>
              </div>

              <div className="mt-4 text-xs font-semibold text-[var(--muted)]">Display name</div>
              <input
                value={displayNameInput}
                onChange={(e) => setDisplayNameInput(e.target.value)}
                onBlur={() => void auth.setDisplayName(displayNameInput.trim())}
                placeholder="e.g. Alex"
                className="mt-1 w-full nt-input"
                disabled={!auth.user}
              />
              <div className="mt-2 text-xs font-medium text-[var(--muted)]">
                This appears in room presence, call labels, and chat.
              </div>

              <div className="mt-5 flex flex-col gap-2">
                <button
                  className="nt-btn nt-btn-primary h-11"
                  onClick={() => void auth.signInWithGoogle()}
                  disabled={busy}
                >
                  {auth.user?.is_anonymous ? "Upgrade with Google" : "Sign in with Google"}
                </button>
                <div className="text-xs font-medium text-[var(--muted)]">
                  If Google says identity already exists, use a different account or unlink the
                  old user in Supabase.
                </div>
              </div>
            </div>

            <details className="mt-4 nt-card p-6">
              <summary className="cursor-pointer text-sm font-semibold text-[var(--foreground)]">
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
              <div className="text-base font-semibold text-[var(--foreground)]">Quick start</div>
              <div className="mt-1 text-sm font-medium text-[var(--muted)]">
                Recommended flow for every study session.
              </div>

              <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="rounded-[16px] border border-black/8 bg-white/88 p-4">
                  <div className="text-xs font-semibold text-[var(--muted)]">Step 1</div>
                  <div className="mt-1 text-sm font-semibold text-[var(--foreground)]">Create room</div>
                  <div className="mt-1 text-xs font-medium text-[var(--muted)]">
                    Click Create Room on this page.
                  </div>
                </div>

                <div className="rounded-[16px] border border-black/8 bg-white/88 p-4">
                  <div className="text-xs font-semibold text-[var(--muted)]">Step 2</div>
                  <div className="mt-1 text-sm font-semibold text-[var(--foreground)]">Share link</div>
                  <div className="mt-1 text-xs font-medium text-[var(--muted)]">
                    Inside room, tap Copy Link and share.
                  </div>
                </div>

                <div className="rounded-[16px] border border-black/8 bg-white/88 p-4">
                  <div className="text-xs font-semibold text-[var(--muted)]">Step 3</div>
                  <div className="mt-1 text-sm font-semibold text-[var(--foreground)]">Study live</div>
                  <div className="mt-1 text-xs font-medium text-[var(--muted)]">
                    Watch, discuss, and chat in sync.
                  </div>
                </div>
              </div>

              <div className="mt-5 rounded-[16px] border border-black/8 bg-[var(--surface-2)] p-4 text-sm font-medium text-[var(--foreground)]">
                Room links look like <span className="font-mono">/room/&lt;uuid&gt;</span>.
                Pasting only the first 8 characters will not work.
              </div>
            </div>
          </section>
        </section>
      </main>

      {uiToast ? <Toast message={uiToast} onDismiss={() => setUiToast(null)} /> : null}
    </div>
  );
}
