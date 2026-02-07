"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";

import {
  extractRoomIdFromInput,
  looksLikeShortRoomCode,
} from "@/lib/roomId";

function LogoMark() {
  return (
    <div className="flex items-center gap-2">
      <div className="rounded-lg bg-[var(--primary)] px-3 py-2 text-sm font-extrabold tracking-tight text-white shadow-[0_10px_30px_rgba(0,0,0,0.14)]">
        Study<span className="text-[var(--accent)]">Room</span>
      </div>
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <path
          d="M3 12h12"
          stroke="var(--accent)"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <path
          d="M12 5l7 7-7 7"
          stroke="var(--accent)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

export function SiteHeader(props: {
  userId: string | null;
  isGuest: boolean;
  onGoogle: () => void;
  onSignOut: () => void;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [joinError, setJoinError] = useState<string | null>(null);

  const trimmed = q.trim();
  const canGo = trimmed.length > 0;

  const handleJoin = useCallback(() => {
    const input = q.trim();
    if (!input) return;

    const id = extractRoomIdFromInput(input);
    if (id) {
      setJoinError(null);
      router.push(`/room/${id}`);
      setQ("");
      return;
    }

    const userId = props.userId?.toLowerCase() ?? null;
    if (
      looksLikeShortRoomCode(input) &&
      userId &&
      userId.startsWith(input.toLowerCase())
    ) {
      setJoinError(null);
      router.push(`/room/${userId}`);
      setQ("");
      return;
    }

    setJoinError(
      looksLikeShortRoomCode(input)
        ? "That looks like a short code (first 8 chars). Please paste the full Room ID (UUID) or the full room link."
        : "Paste a full room link or UUID.",
    );
  }, [props.userId, q, router]);

  async function copyUserId() {
    const userId = props.userId;
    if (!userId) return;
    try {
      await navigator.clipboard?.writeText(userId);
    } catch {
      // ignore
    }
  }

  const rightCtaLabel = useMemo(() => {
    if (!props.userId) return "Continue with Google";
    if (props.isGuest) return "Continue with Google";
    return "Sign out";
  }, [props.isGuest, props.userId]);

  return (
    <div className="sticky top-0 z-50">
      <div className="nt-nav">
        <div className="nt-container flex items-center gap-4 py-3">
          <Link href="/" className="shrink-0">
            <LogoMark />
          </Link>

          <form
            className="hidden flex-1 items-center gap-0 md:flex"
            onSubmit={(e) => {
              e.preventDefault();
              if (!canGo) return;
              handleJoin();
            }}
          >
            <div className="flex w-full max-w-[560px] items-center overflow-hidden rounded-[10px] bg-[var(--surface-2)]">
              <div className="px-3 text-[var(--muted)]">
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  aria-hidden="true"
                >
                  <path
                    d="M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16Z"
                    stroke="currentColor"
                    strokeWidth="2"
                  />
                  <path
                    d="m21 21-4.3-4.3"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
              </div>
              <input
                className="h-10 w-full bg-transparent px-2 text-sm font-medium text-[var(--foreground)] outline-none"
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  if (joinError) setJoinError(null);
                }}
                placeholder="Paste room link or UUID..."
              />
              <button
                type="submit"
                className="h-10 px-4 text-sm font-bold text-white"
                style={{ background: "var(--primary)" }}
                disabled={!canGo}
              >
                Join
              </button>
            </div>
            {joinError ? (
              <div className="ml-3 text-xs font-semibold text-red-700">
                {joinError}
              </div>
            ) : null}
          </form>

          <div className="ml-auto flex items-center gap-4">
            <nav className="hidden items-center gap-5 text-sm font-semibold text-[var(--foreground)] md:flex">
              <Link className="hover:underline" href="/">
                Home
              </Link>
              <a
                className="hover:underline"
                href="https://supabase.com/docs"
                target="_blank"
                rel="noreferrer"
              >
                Docs
              </a>
            </nav>

            {props.userId ? (
              <>
                <button
                  type="button"
                  className="hidden rounded-full bg-white px-3 py-1 text-xs font-semibold text-[var(--foreground)] shadow-[0_1px_10px_rgba(0,0,0,0.06)] sm:inline"
                  title="Click to copy full Guest ID"
                  onClick={() => void copyUserId()}
                >
                  <span className="font-mono">
                    {props.userId.slice(0, 8)}...{props.userId.slice(-4)}
                  </span>
                  {props.isGuest ? (
                    <span className="ml-2 nt-badge">Guest</span>
                  ) : null}
                </button>

                <button
                  type="button"
                  className="nt-btn nt-btn-outline h-10 w-10 p-0 sm:hidden"
                  title="Copy full Guest ID"
                  onClick={() => void copyUserId()}
                >
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                    aria-hidden="true"
                  >
                    <path
                      d="M9 9h10v10H9V9Z"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              </>
            ) : null}

            <button
              className="nt-btn nt-btn-primary"
              onClick={() => {
                if (!props.userId) {
                  props.onGoogle();
                  return;
                }
                if (props.isGuest) props.onGoogle();
                else props.onSignOut();
              }}
            >
              {rightCtaLabel}
            </button>
          </div>
        </div>
      </div>

      <div className="md:hidden">
        <div className="nt-container pb-3">
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!canGo) return;
              handleJoin();
            }}
          >
            <input
              className="h-11 w-full rounded-[10px] bg-[var(--surface-2)] px-4 text-sm font-semibold text-[var(--foreground)] outline-none placeholder:text-[var(--muted)]"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                if (joinError) setJoinError(null);
              }}
              placeholder="Paste room link or UUID..."
            />
            <button
              type="submit"
              className="nt-btn nt-btn-primary h-11 px-4"
              disabled={!canGo}
            >
              Join
            </button>
          </form>
          {joinError ? (
            <div className="mt-2 text-xs font-semibold text-red-700">
              {joinError}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
