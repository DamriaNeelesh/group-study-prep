"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";

import { extractRoomIdFromInput, looksLikeShortRoomCode } from "@/lib/roomId";

function LogoMark() {
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[linear-gradient(180deg,#4ea0ff,#0071e3)] text-[11px] font-bold text-white shadow-[0_8px_18px_rgba(0,113,227,0.35)]">
        SR
      </div>
      <div className="text-[15px] font-semibold tracking-[-0.02em] text-[var(--foreground)]">
        StudyRoom
      </div>
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

    setJoinError(
      looksLikeShortRoomCode(input)
        ? "That looks like a short code (first 8 chars). Paste the full Room ID or room link."
        : "Paste a full room link or UUID.",
    );
  }, [q, router]);

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
    if (props.isGuest) return "Upgrade with Google";
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
            className="hidden min-w-0 flex-1 items-center gap-3 lg:flex"
            onSubmit={(e) => {
              e.preventDefault();
              if (!canGo) return;
              handleJoin();
            }}
          >
            <div className="flex w-full max-w-[560px] items-center overflow-hidden rounded-full border border-black/10 bg-white/85 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)]">
              <div className="pl-4 text-[var(--muted)]">
                <svg
                  width="16"
                  height="16"
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
                className="h-11 w-full bg-transparent px-3 text-sm font-medium text-[var(--foreground)] outline-none placeholder:text-[var(--muted)]"
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  if (joinError) setJoinError(null);
                }}
                placeholder="Paste room link or UUID"
              />
              <button
                type="submit"
                className="nt-btn nt-btn-accent mr-1.5 h-8 px-4 text-xs"
                disabled={!canGo}
              >
                Join
              </button>
            </div>
            {joinError ? <div className="text-xs font-semibold text-red-700">{joinError}</div> : null}
          </form>

          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            {props.userId ? (
              <>
                <Link
                  href="/api-keys"
                  className="hidden nt-btn nt-btn-outline h-10 px-4 sm:inline-flex"
                  title="Manage API keys"
                >
                  API Keys
                </Link>

                <button
                  type="button"
                  className="hidden rounded-full border border-black/10 bg-white/80 px-3 py-1 text-xs font-semibold text-[var(--foreground)] shadow-[0_6px_14px_rgba(17,24,39,0.08)] sm:inline"
                  title="Copy full user ID"
                  onClick={() => void copyUserId()}
                >
                  <span className="font-mono">
                    {props.userId.slice(0, 8)}...{props.userId.slice(-4)}
                  </span>
                  {props.isGuest ? <span className="ml-2 nt-badge">Guest</span> : null}
                </button>

                <button
                  type="button"
                  className="nt-btn nt-btn-outline h-10 w-10 p-0 sm:hidden"
                  title="Copy full user ID"
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
              className="nt-btn nt-btn-primary h-10"
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

      <div className="border-b border-black/5 bg-white/55 px-0 py-2.5 backdrop-blur lg:hidden">
        <div className="nt-container">
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!canGo) return;
              handleJoin();
            }}
          >
            <input
              className="h-11 w-full rounded-full border border-black/10 bg-white/90 px-4 text-sm font-medium text-[var(--foreground)] outline-none placeholder:text-[var(--muted)]"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                if (joinError) setJoinError(null);
              }}
              placeholder="Paste room link or UUID"
            />
            <button type="submit" className="nt-btn nt-btn-accent h-11 px-4" disabled={!canGo}>
              Join
            </button>
          </form>
          {joinError ? <div className="mt-2 text-xs font-semibold text-red-700">{joinError}</div> : null}
        </div>
      </div>
    </div>
  );
}
