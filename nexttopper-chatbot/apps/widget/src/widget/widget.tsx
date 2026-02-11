import { useEffect, useMemo, useRef, useState } from 'react';
import type { BotMessage, BotQuickReply } from './api';
import { botEvent, botStart } from './api';

export type WidgetProps = {
  functionsBaseUrl: string;
};

type UiMessage =
  | { role: 'bot'; text: string }
  | { role: 'user'; text: string }
  | { role: 'system'; text: string };

export function Widget({ functionsBaseUrl }: WidgetProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [quickReplies, setQuickReplies] = useState<BotQuickReply[]>([]);
  const [text, setText] = useState('');
  const listRef = useRef<HTMLDivElement | null>(null);

  const l1 = useMemo<BotQuickReply[]>(
    () => [
      { id: 'new_batches', label: 'New Batches (2026-27)' },
      { id: 'enrolled_support', label: 'My Enrolled Course' },
      { id: 'fees_offers', label: 'Fee Structure & Offers' },
      { id: 'timetable', label: 'Timetable & Schedule' },
      { id: 'callback', label: 'Request Call Back' },
      { id: 'not_satisfied', label: 'Not satisfied' },
    ],
    []
  );

  useEffect(() => {
    if (!open) return;
    if (sessionId) return;
    let cancelled = false;
    (async () => {
      setBusy(true);
      try {
        const res = await botStart(functionsBaseUrl);
        if (cancelled) return;
        if (res.session_id) setSessionId(res.session_id);
        setMessages((prev) => [
          ...prev,
          ...res.messages.map((m: BotMessage) => ({ role: 'bot' as const, text: m.text })),
        ]);
        setQuickReplies(res.quick_replies?.length ? res.quick_replies : l1);
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Something went wrong.';
        setMessages((prev) => [
          ...prev,
          { role: 'system', text: `Bot error: ${msg}` },
        ]);
        setQuickReplies(l1);
      } finally {
        setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [functionsBaseUrl, l1, open, sessionId]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, quickReplies, busy]);

  async function sendText() {
    if (!sessionId) return;
    const trimmed = text.trim();
    if (!trimmed) return;
    setText('');
    setMessages((prev) => [...prev, { role: 'user', text: trimmed }]);
    setBusy(true);
    try {
      const res = await botEvent(functionsBaseUrl, {
        session_id: sessionId,
        type: 'text',
        text: trimmed,
        page_url: location.href,
      });
      setMessages((prev) => [
        ...prev,
        ...res.messages.map((m) => ({ role: 'bot' as const, text: m.text })),
      ]);
      setQuickReplies(res.quick_replies ?? []);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Something went wrong.';
      setMessages((prev) => [...prev, { role: 'system', text: `Bot error: ${msg}` }]);
      setQuickReplies(l1);
    } finally {
      setBusy(false);
    }
  }

  async function onQuickReply(id: string) {
    if (!sessionId) return;
    setMessages((prev) => [...prev, { role: 'user', text: quickReplies.find((q) => q.id === id)?.label ?? id }]);
    setBusy(true);
    try {
      const res = await botEvent(functionsBaseUrl, {
        session_id: sessionId,
        type: 'select',
        selection_id: id,
        page_url: location.href,
      });
      setMessages((prev) => [
        ...prev,
        ...res.messages.map((m) => ({ role: 'bot' as const, text: m.text })),
      ]);
      setQuickReplies(res.quick_replies ?? []);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Something went wrong.';
      setMessages((prev) => [...prev, { role: 'system', text: `Bot error: ${msg}` }]);
      setQuickReplies(l1);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ntw-root">
      <button
        className="ntw-fab"
        type="button"
        aria-label={open ? 'Close chat' : 'Open chat'}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? 'x' : 'Chat'}
      </button>

      {open ? (
        <div className="ntw-panel" role="dialog" aria-label="Next Toppers Counselor Bot">
          <div className="ntw-header">
            <div className="ntw-title">
              <div className="ntw-title-main">Next Toppers</div>
              <div className="ntw-title-sub">Smart Counselor</div>
            </div>
            <button
              className="ntw-close"
              type="button"
              onClick={() => setOpen(false)}
            >
              x
            </button>
          </div>

          <div className="ntw-messages" ref={listRef}>
            {messages.map((m, idx) => (
              <div key={idx} className={`ntw-msg ntw-msg-${m.role}`}>
                <div className="ntw-bubble">{m.text}</div>
              </div>
            ))}
            {busy ? (
              <div className="ntw-msg ntw-msg-bot">
                <div className="ntw-bubble ntw-typing">Typing...</div>
              </div>
            ) : null}
          </div>

          <div className="ntw-quick">
            {quickReplies.map((q) => (
              <button
                key={q.id}
                type="button"
                className="ntw-quick-btn"
                onClick={() => onQuickReply(q.id)}
                disabled={busy}
              >
                {q.label}
              </button>
            ))}
          </div>

          <div className="ntw-input">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void sendText();
              }}
              placeholder="Type your question..."
              disabled={busy || !sessionId}
            />
            <button type="button" onClick={() => void sendText()} disabled={busy || !sessionId}>
              Send
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}


