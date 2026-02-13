"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { RoomChatMessage } from "@/hooks/useRoomSyncSocket";

type Props = {
  messages: RoomChatMessage[];
  currentUserId: string | null;
  disabled?: boolean;
  onSend: (message: string) => Promise<unknown> | void;
};

function fmtTime(ms: number) {
  const d = new Date(ms);
  if (!Number.isFinite(d.getTime())) return "--:--";
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

export function RoomChatPanel(props: Props) {
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const sorted = useMemo(
    () => [...props.messages].sort((a, b) => a.atMs - b.atMs),
    [props.messages],
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [sorted.length]);

  return (
    <div className="nt-card flex h-[420px] flex-col p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-extrabold text-[var(--foreground)]">Chat</div>
        <span className="nt-badge">{sorted.length}</span>
      </div>

      <div className="mt-3 flex-1 space-y-2 overflow-y-auto rounded-[12px] border border-black/10 bg-[var(--surface-2)] p-3">
        {sorted.length === 0 ? (
          <div className="rounded-[10px] border border-dashed border-black/10 bg-white/70 p-3 text-xs font-semibold text-[var(--muted)]">
            No messages yet. Start the discussion.
          </div>
        ) : (
          sorted.map((m) => {
            const mine = Boolean(props.currentUserId && m.userId === props.currentUserId);
            return (
              <div
                key={m.id}
                className={`max-w-[90%] rounded-[12px] px-3 py-2 text-xs shadow-[0_8px_22px_rgba(0,0,0,0.06)] ${
                  mine
                    ? "ml-auto border border-[var(--accent)]/35 bg-[var(--accent)]/12 text-[var(--foreground)]"
                    : "border border-black/10 bg-white text-[var(--foreground)]"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-extrabold">{mine ? "You" : m.displayName}</span>
                  <span className="font-mono text-[10px] text-[var(--muted)]">
                    {fmtTime(m.atMs)}
                  </span>
                </div>
                <div className="mt-1 whitespace-pre-wrap text-[13px] font-medium leading-5">
                  {m.message}
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      <form
        className="mt-3 flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (sending) return;
          const message = input.trim();
          if (!message) return;
          setSending(true);
          Promise.resolve(props.onSend(message))
            .then((result) => {
              if (
                result &&
                typeof result === "object" &&
                "ok" in result &&
                (result as { ok?: unknown }).ok === false
              ) {
                return;
              }
              setInput("");
            })
            .finally(() => setSending(false));
        }}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a message..."
          className="min-h-[44px] max-h-28 flex-1 resize-y rounded-[12px] border border-black/10 bg-white px-3 py-2 text-sm font-medium text-[var(--foreground)] outline-none placeholder:text-[var(--muted)]"
          disabled={Boolean(props.disabled) || sending}
          rows={2}
        />
        <button
          type="submit"
          className="nt-btn nt-btn-primary h-11 px-4"
          disabled={Boolean(props.disabled) || sending || !input.trim()}
        >
          {sending ? "Sending..." : "Send"}
        </button>
      </form>
    </div>
  );
}
