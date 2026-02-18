"use client";

import { useEffect, useMemo, useState } from "react";

import { SiteHeader } from "@/components/SiteHeader";
import { Toast } from "@/components/Toast";
import { useSupabaseAuth } from "@/hooks/useSupabaseAuth";

type ApiKeyRecord = {
  id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

function formatTs(ts: string | null) {
  if (!ts) return "Never";
  const d = new Date(ts);
  if (!Number.isFinite(d.getTime())) return "Unknown";
  return d.toLocaleString();
}

function shortPrefix(v: string) {
  const s = String(v || "");
  if (s.length <= 12) return s;
  return s.slice(0, 12);
}

export default function ApiKeysPage() {
  const auth = useSupabaseAuth();
  const token = auth.session?.access_token || null;

  const [keys, setKeys] = useState<ApiKeyRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uiToast, setUiToast] = useState<string | null>(null);

  const [newName, setNewName] = useState("Telemetry (default)");
  const [scopeRead, setScopeRead] = useState(true);
  const [scopeWrite, setScopeWrite] = useState(false);
  const [createdKey, setCreatedKey] = useState<string | null>(null);

  const scopes = useMemo(() => {
    const s: string[] = [];
    if (scopeRead) s.push("telemetry:read");
    if (scopeWrite) s.push("telemetry:write");
    return s;
  }, [scopeRead, scopeWrite]);

  async function refresh() {
    if (!token) return;
    setError(null);
    const res = await fetch("/api/api-keys", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = (await res.json().catch(() => null)) as any;
    if (!res.ok || !json?.ok) {
      setError(String(json?.error || "Failed to load keys"));
      return;
    }
    setKeys((json.keys || []) as ApiKeyRecord[]);
  }

  useEffect(() => {
    if (!token) return;
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function createKey() {
    if (!token) return;
    setBusy(true);
    setError(null);
    setCreatedKey(null);
    try {
      const res = await fetch("/api/api-keys", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ name: newName, scopes }),
      });
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok || !json?.ok) {
        setError(String(json?.error || "Failed to create key"));
        return;
      }
      setCreatedKey(String(json.apiKey || ""));
      setUiToast("API key created");
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function revokeKey(id: string) {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/api-keys/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok || !json?.ok) {
        setError(String(json?.error || "Failed to revoke key"));
        return;
      }
      setUiToast("Key revoked");
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen">
      <SiteHeader
        userId={auth.user?.id ?? null}
        isGuest={Boolean(auth.user?.is_anonymous)}
        onGoogle={() => void auth.signInWithGoogle()}
        onSignOut={() => void auth.signOut()}
      />

      <main className="nt-container pb-14 pt-8">
        <header className="nt-card p-6">
          <div className="text-sm font-extrabold text-[var(--foreground)]">API Keys</div>
          <div className="mt-2 text-sm font-medium text-[var(--muted)]">
            Create keys to read telemetry from the backend (room events, commands, chat, meet activity).
            Keys are shown only once at creation time.
          </div>
        </header>

        <section className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <div className="nt-card p-6">
              <div className="text-sm font-semibold text-[var(--foreground)]">Create key</div>
              <div className="mt-4 flex flex-col gap-3">
                <label className="text-xs font-semibold text-[var(--muted)]">Name</label>
                <input
                  className="nt-input"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. Analytics dashboard"
                  disabled={!token || busy}
                />

                <div className="mt-2 text-xs font-semibold text-[var(--muted)]">Scopes</div>
                <label className="flex items-center gap-2 text-sm font-medium text-[var(--foreground)]">
                  <input
                    type="checkbox"
                    checked={scopeRead}
                    onChange={(e) => setScopeRead(e.target.checked)}
                    disabled={!token || busy}
                  />
                  telemetry:read
                </label>
                <label className="flex items-center gap-2 text-sm font-medium text-[var(--foreground)]">
                  <input
                    type="checkbox"
                    checked={scopeWrite}
                    onChange={(e) => setScopeWrite(e.target.checked)}
                    disabled={!token || busy}
                  />
                  telemetry:write
                </label>

                <button
                  className="nt-btn nt-btn-accent h-11 mt-2"
                  onClick={() => void createKey()}
                  disabled={!token || busy || !scopeRead}
                  title={!scopeRead ? "telemetry:read is required" : undefined}
                >
                  Create key
                </button>

                {createdKey ? (
                  <div className="mt-3 rounded-[16px] border border-black/10 bg-white p-4">
                    <div className="text-xs font-semibold text-[var(--muted)]">Your new key</div>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <div className="min-w-0 font-mono text-xs font-semibold text-[var(--foreground)] break-all">
                        {createdKey}
                      </div>
                      <button
                        className="nt-btn nt-btn-outline h-9 px-4"
                        onClick={() => {
                          void (async () => {
                            try {
                              await navigator.clipboard?.writeText(createdKey);
                              setUiToast("Key copied");
                            } catch {
                              setUiToast("Copy failed");
                            }
                          })();
                        }}
                      >
                        Copy
                      </button>
                    </div>
                    <div className="mt-2 text-[11px] font-medium text-[var(--muted)]">
                      Store this key securely. You won&apos;t be able to view it again after leaving this page.
                    </div>
                  </div>
                ) : null}

                {auth.error || error ? (
                  <div className="mt-3 rounded-[14px] border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-800">
                    {auth.error ?? error}
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <div className="lg:col-span-7">
            <div className="nt-card p-6">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-[var(--foreground)]">
                    Your keys
                  </div>
                  <div className="mt-1 text-xs font-medium text-[var(--muted)]">
                    Use these in requests as <span className="font-mono">x-studyroom-api-key</span>.
                  </div>
                </div>
                <button
                  className="nt-btn nt-btn-outline h-10 px-4"
                  onClick={() => void refresh()}
                  disabled={!token || busy}
                >
                  Refresh
                </button>
              </div>

              {!token ? (
                <div className="mt-4 text-sm font-medium text-[var(--muted)]">Signing in...</div>
              ) : keys.length === 0 ? (
                <div className="mt-4 text-sm font-medium text-[var(--muted)]">
                  No keys yet. Create one on the left.
                </div>
              ) : (
                <div className="mt-4 flex flex-col gap-3">
                  {keys.map((k) => {
                    const revoked = Boolean(k.revoked_at);
                    return (
                      <div
                        key={k.id}
                        className="rounded-[16px] border border-black/10 bg-white px-4 py-3"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-sm font-extrabold text-[var(--foreground)] truncate">
                              {k.name}
                            </div>
                            <div className="mt-1 text-xs font-semibold text-[var(--muted)]">
                              Prefix{" "}
                              <span className="font-mono text-[var(--foreground)]">
                                {shortPrefix(k.key_prefix)}
                              </span>{" "}
                              <span className="mx-2 text-black/15">|</span>
                              Scopes{" "}
                              <span className="font-mono text-[var(--foreground)]">
                                {(k.scopes || []).join(", ") || "(none)"}
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            {revoked ? (
                              <span className="nt-badge">Revoked</span>
                            ) : (
                              <span className="rounded-full bg-[var(--accent-soft)] px-3 py-1 text-xs font-semibold text-[var(--accent-2)]">
                                Active
                              </span>
                            )}
                            <button
                              className="nt-btn nt-btn-outline h-10 px-4"
                              onClick={() => void revokeKey(k.id)}
                              disabled={busy || revoked}
                            >
                              Revoke
                            </button>
                          </div>
                        </div>

                        <div className="mt-3 grid grid-cols-1 gap-2 text-xs font-semibold text-[var(--muted)] sm:grid-cols-3">
                          <div>
                            Created{" "}
                            <span className="font-mono text-[var(--foreground)]">
                              {formatTs(k.created_at)}
                            </span>
                          </div>
                          <div>
                            Last used{" "}
                            <span className="font-mono text-[var(--foreground)]">
                              {formatTs(k.last_used_at)}
                            </span>
                          </div>
                          <div>
                            Revoked{" "}
                            <span className="font-mono text-[var(--foreground)]">
                              {formatTs(k.revoked_at)}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </section>
      </main>

      {uiToast ? <Toast message={uiToast} onDismiss={() => setUiToast(null)} /> : null}
    </div>
  );
}

