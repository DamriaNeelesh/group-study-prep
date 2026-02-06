"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { requireSupabaseBrowserClient } from "@/lib/supabase/client";
import { useSupabaseAuth } from "@/hooks/useSupabaseAuth";

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
    const id = roomId.trim();
    if (!id) return;
    router.push(`/room/${id}`);
  }

  return (
    <div className="min-h-screen bg-zinc-50">
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-10">
        <header className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
            StudyRoom
          </h1>
          <p className="text-sm text-zinc-600">
            Realtime YouTube sync and audio chat using Supabase Realtime +
            WebRTC.
          </p>
        </header>

        <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm text-zinc-700">
                User:{" "}
                <span className="font-mono text-zinc-900">
                  {auth.user?.id ?? "(not signed in)"}
                </span>
              </div>
              {auth.user ? (
                <button
                  className="rounded-md border border-zinc-200 px-3 py-2 text-sm font-medium hover:bg-zinc-50"
                  onClick={() => void auth.signOut()}
                >
                  Sign out
                </button>
              ) : null}
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-xs font-medium text-zinc-700">
                Display name
              </label>
              <input
                value={displayNameInput}
                onChange={(e) => setDisplayNameInput(e.target.value)}
                onBlur={() => void auth.setDisplayName(displayNameInput.trim())}
                placeholder="e.g. Alex"
                className="rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400"
                disabled={!auth.user}
              />
              <div className="text-xs text-zinc-500">
                This is used for Presence in rooms.
              </div>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button
                className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => void createRoom()}
                disabled={!auth.user || busy}
              >
                Create Room
              </button>

              <div className="flex gap-2">
                <input
                  value={roomId}
                  onChange={(e) => setRoomId(e.target.value)}
                  placeholder="Room ID (uuid)"
                  className="w-full rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400"
                />
                <button
                  className="rounded-md border border-zinc-200 px-3 py-2 text-sm font-medium hover:bg-zinc-50"
                  onClick={joinRoom}
                  disabled={!roomId.trim() || busy}
                >
                  Join
                </button>
              </div>
            </div>

            <details className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2">
              <summary className="cursor-pointer text-sm font-medium text-zinc-800">
                Email login (optional)
              </summary>
              <div className="mt-3 flex flex-col gap-2">
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-400"
                />
                <button
                  className="rounded-md border border-zinc-200 px-3 py-2 text-sm font-medium hover:bg-white"
                  onClick={() => void auth.signInWithEmailOtp(email)}
                  disabled={!email.trim()}
                >
                  Send magic link
                </button>
                <div className="text-xs text-zinc-600">
                  For the rest of the app, anonymous auth works fine.
                </div>
              </div>
            </details>

            {auth.error ? (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                {auth.error}
              </div>
            ) : null}

            {error ? (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                {error}
              </div>
            ) : null}
          </div>
        </section>
      </main>
    </div>
  );
}
