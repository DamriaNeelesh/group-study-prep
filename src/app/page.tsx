"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { requireSupabaseBrowserClient } from "@/lib/supabase/client";
import { useSupabaseAuth } from "@/hooks/useSupabaseAuth";
import { SiteHeader } from "@/components/SiteHeader";
import {
  extractRoomIdFromInput,
  looksLikeShortRoomCode,
} from "@/lib/roomId";

export default function HomePage() {
  const router = useRouter();
  const auth = useSupabaseAuth();

  const [roomId, setRoomId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
      const myUserId = auth.user?.id ?? null;
      if (
        looksLikeShortRoomCode(input) &&
        myUserId?.toLowerCase().startsWith(input.toLowerCase())
      ) {
        setError(null);
        router.push(`/room/${myUserId.toLowerCase()}`);
        return;
      }
      setError(
        looksLikeShortRoomCode(input)
          ? "That looks like only the first 8 characters. Paste the full Room ID (UUID) / full room link, or click your ID badge (top right) to copy the full Guest ID."
          : "Please paste a full Room ID (UUID) or a full room link like /room/<uuid>.",
      );
      return;
    }

    setError(null);
    router.push(`/room/${id}`);
  }

  return (
    <div className="min-h-screen bg-[var(--background)]">
      <SiteHeader
        userId={auth.user?.id ?? null}
        isGuest={Boolean(auth.user?.is_anonymous)}
        onGoogle={() => void auth.signInWithGoogle()}
        onSignOut={() => void auth.signOut()}
      />

      <main className="nt-container py-10">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <section className="lg:col-span-2">
            <div className="nt-green-card p-6">
              <div className="relative z-10 flex flex-col gap-4">
                <div>
                  <div className="text-xs font-bold uppercase tracking-wide text-white/80">
                    Realtime Study Platform
                  </div>
                  <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
                    Watch together. Stay synced.
                  </h1>
                  <p className="mt-2 max-w-xl text-sm text-white/85">
                    YouTube playback sync via Supabase Realtime broadcast + reliable DB state for late joiners.
                  </p>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <button
                    className="nt-btn nt-btn-primary h-12"
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
                      placeholder="Paste full room link or Room ID (UUID)"
                      className="h-12 w-full rounded-[10px] bg-white/90 px-4 text-sm font-semibold text-[#2b2b2b] outline-none placeholder:text-[#717171]"
                    />
                    <button
                      className="nt-btn nt-btn-accent h-12 px-5"
                      type="submit"
                      disabled={!roomId.trim() || busy}
                    >
                      Join
                    </button>
                  </form>
                </div>

                {(auth.error || error) ? (
                  <div className="rounded-[10px] border border-white/20 bg-black/20 px-4 py-3 text-sm text-white">
                    {auth.error ?? error}
                  </div>
                ) : null}
              </div>
            </div>
          </section>

          <aside className="flex flex-col gap-6">
            <div className="nt-card p-5">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-extrabold text-[var(--foreground)]">
                  Your Profile
                </div>
                {auth.user?.is_anonymous ? <span className="nt-badge">Guest</span> : null}
              </div>

              <div className="mt-3 text-xs font-semibold text-[var(--muted)]">
                User ID
              </div>
              <div className="mt-1 rounded-[10px] bg-[var(--surface-2)] px-3 py-2 text-xs font-bold text-[var(--foreground)]">
                <span className="font-mono break-all">
                  {auth.user?.id ?? "(connecting...)"}
                </span>
              </div>

              <div className="mt-4 text-xs font-semibold text-[var(--muted)]">
                Display name (Presence)
              </div>
              <input
                value={displayNameInput}
                onChange={(e) => setDisplayNameInput(e.target.value)}
                onBlur={() => void auth.setDisplayName(displayNameInput.trim())}
                placeholder="e.g. Alex"
                className="mt-1 w-full nt-input"
                disabled={!auth.user}
              />

              <div className="mt-4 flex flex-col gap-2">
                <button
                  className="nt-btn nt-btn-outline"
                  onClick={() => void auth.signInWithGoogle()}
                  disabled={busy}
                >
                  {auth.user?.is_anonymous ? "Upgrade with Google" : "Sign in with Google"}
                </button>
                <div className="text-xs font-medium text-[var(--muted)]">
                  Google is optional. Guests can use rooms without it.
                </div>
              </div>
            </div>

            <details className="nt-card p-5">
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
        </div>
      </main>
    </div>
  );
}
