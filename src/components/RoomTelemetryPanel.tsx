"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type TelemetryEvent = {
  id: number | string;
  at: string;
  source: string;
  room_id: string | null;
  user_id: string | null;
  type: string;
  payload: unknown;
};

type TelemetryResponse =
  | {
      ok: true;
      roomId: string;
      limit: number;
      summary: {
        totalEvents: number;
        counts: Record<string, number>;
        latestAt: string | null;
      };
      events: TelemetryEvent[];
    }
  | { ok: false; error: string };

function shortId(id: string | null) {
  const trimmed = String(id || "").trim();
  if (!trimmed) return "";
  if (trimmed.length <= 14) return trimmed;
  return `${trimmed.slice(0, 8)}...${trimmed.slice(-4)}`;
}

function formatTime(ts: string) {
  const d = new Date(ts);
  if (!Number.isFinite(d.getTime())) return ts;
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function compactPayload(payload: unknown, max = 160) {
  if (payload == null) return "";
  try {
    const raw = JSON.stringify(payload);
    if (raw.length <= max) return raw;
    return `${raw.slice(0, max)}...`;
  } catch {
    return "";
  }
}

function getStorageKey(roomId: string) {
  return `nt:telemetry:apiKey:${roomId}`;
}

export function RoomTelemetryPanel(props: {
  roomId: string;
  bearerToken: string | null;
  roomCreatedBy: string | null;
  viewerUserId: string | null;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<TelemetryResponse | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);

  const isOwner = Boolean(props.viewerUserId && props.roomCreatedBy && props.viewerUserId === props.roomCreatedBy);
  const ownershipKnown = Boolean(props.roomCreatedBy);
  const canUseBearer = Boolean(isOwner && props.bearerToken);

  useEffect(() => {
    if (!props.roomId) return;
    try {
      const saved = sessionStorage.getItem(getStorageKey(props.roomId)) || "";
      if (saved) setApiKey(saved);
    } catch {
      // ignore
    }
  }, [props.roomId]);

  const authHeaders = useMemo((): Record<string, string> | null => {
    if (apiKey.trim()) return { "x-studyroom-api-key": apiKey.trim() };
    if (canUseBearer && props.bearerToken) return { Authorization: `Bearer ${props.bearerToken}` };
    return null;
  }, [apiKey, canUseBearer, props.bearerToken]);

  async function refresh() {
    if (!props.roomId) return;
    if (!authHeaders) {
      setError(isOwner ? "Missing bearer token" : "Only the room creator can view telemetry.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/telemetry/room/${props.roomId}?limit=200`, {
        headers: authHeaders,
      });
      const json = (await res.json().catch(() => null)) as TelemetryResponse | null;
      if (!res.ok || !json) {
        setError("Failed to load telemetry");
        setData(null);
        return;
      }
      if (!json.ok) {
        const msg = String((json as any)?.error || "Failed to load telemetry");
        setError(msg);
        setData(json);
        return;
      }
      setData(json);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!autoRefresh) return;
    const id = window.setInterval(() => void refresh(), 12_000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh, authHeaders, props.roomId]);

  useEffect(() => {
    // Load once when a usable auth method becomes available.
    if (!authHeaders) return;
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.roomId, Boolean(authHeaders)]);

  const counts = (data && data.ok ? data.summary.counts : {}) as Record<string, number>;
  const countEntries = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8);

  const maybeMissingTable = String(error || "").toLowerCase().includes("telemetry_events") &&
    String(error || "").toLowerCase().includes("does not exist");

  return (
    <div className="nt-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-extrabold text-[var(--foreground)]">Insights</div>
          <div className="mt-1 text-xs font-semibold text-[var(--muted)]">
            Server-side telemetry for this room.
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="nt-btn nt-btn-outline h-9 px-4"
            onClick={() => void refresh()}
            disabled={busy || !authHeaders}
            title={!authHeaders ? "Not authorized" : "Refresh telemetry"}
          >
            Refresh
          </button>
        </div>
      </div>

      {!ownershipKnown ? (
        <div className="mt-3 text-xs font-semibold text-[var(--muted)]">
          Loading telemetry access...
        </div>
      ) : null}

      {ownershipKnown && !isOwner ? (
        <div className="mt-3 rounded-[12px] border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
          Telemetry is only available to the room creator (to avoid leaking data). If you are the
          creator, open this room from the same account that created it.
        </div>
      ) : null}

      {isOwner ? (
        <div className="mt-3 rounded-[12px] border border-black/10 bg-white p-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-xs font-semibold text-[var(--muted)]">
              Auth
              <span className="ml-2 rounded-full bg-[var(--surface-2)] px-2 py-1 text-[11px] font-semibold text-[var(--foreground)]">
                {apiKey.trim() ? "API key" : canUseBearer ? "Bearer" : "None"}
              </span>
            </div>
            <label className="flex items-center gap-2 text-xs font-semibold text-[var(--muted)]">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
                disabled={!authHeaders}
              />
              Auto refresh
            </label>
          </div>

          <div className="mt-3 flex flex-col gap-2">
            <label className="text-xs font-semibold text-[var(--muted)]">
              Optional API key (session only)
            </label>
            <div className="flex items-center gap-2">
              <input
                className="nt-input w-full"
                value={apiKey}
                onChange={(e) => {
                  const next = e.target.value;
                  setApiKey(next);
                  try {
                    if (next.trim()) sessionStorage.setItem(getStorageKey(props.roomId), next.trim());
                    else sessionStorage.removeItem(getStorageKey(props.roomId));
                  } catch {
                    // ignore
                  }
                }}
                placeholder="srk_live_..."
                type={showKey ? "text" : "password"}
              />
              <button
                className="nt-btn nt-btn-outline h-10 px-4"
                type="button"
                onClick={() => setShowKey((v) => !v)}
                title={showKey ? "Hide key" : "Show key"}
              >
                {showKey ? "Hide" : "Show"}
              </button>
              <Link className="nt-btn nt-btn-outline h-10 px-4" href="/api-keys">
                API Keys
              </Link>
            </div>
            <div className="text-[11px] font-semibold text-[var(--muted)]">
              If telemetry tables are installed, bearer auth works automatically for the room owner.
            </div>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="mt-3 rounded-[12px] border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-800">
          {error}
          {maybeMissingTable ? (
            <div className="mt-1 text-[11px] font-semibold text-red-900/80">
              Run <span className="font-mono">supabase/studyroom_tracking.sql</span> in your Supabase SQL editor,
              then set <span className="font-mono">TELEMETRY_ENABLED=1</span> on the realtime server.
            </div>
          ) : null}
        </div>
      ) : null}

      {data && data.ok ? (
        <div className="mt-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="nt-chip">
              Total <span className="font-mono">{data.summary.totalEvents}</span>
            </span>
            {data.summary.latestAt ? (
              <span className="nt-chip">
                Latest <span className="font-mono">{formatTime(data.summary.latestAt)}</span>
              </span>
            ) : null}
            {countEntries.map(([k, v]) => (
              <span key={k} className="nt-chip">
                {k} <span className="font-mono">{v}</span>
              </span>
            ))}
          </div>

          <div className="mt-3 max-h-[320px] overflow-auto rounded-[16px] border border-black/10 bg-white">
            {(data.events || []).length === 0 ? (
              <div className="p-4 text-xs font-semibold text-[var(--muted)]">
                No telemetry events yet.
              </div>
            ) : (
              <div className="divide-y divide-black/5">
                {(data.events || []).slice(0, 80).map((e) => (
                  <div key={String(e.id)} className="px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-xs font-extrabold text-[var(--foreground)]">{e.type}</div>
                      <div className="text-[11px] font-semibold text-[var(--muted)]">
                        {formatTime(e.at)}
                      </div>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] font-semibold text-[var(--muted)]">
                      {e.user_id ? (
                        <span className="rounded-full bg-[var(--surface-2)] px-2 py-1">
                          user <span className="font-mono">{shortId(e.user_id)}</span>
                        </span>
                      ) : null}
                      <span className="rounded-full bg-[var(--surface-2)] px-2 py-1">
                        src <span className="font-mono">{e.source}</span>
                      </span>
                    </div>
                    {e.payload ? (
                      <div className="mt-2 rounded-[12px] border border-black/10 bg-[var(--surface-2)] px-3 py-2 font-mono text-[10px] text-[var(--foreground)]">
                        {compactPayload(e.payload)}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
