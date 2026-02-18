import { NextResponse } from "next/server";

import { generateApiKey } from "@/lib/server/apiKeys";
import { requireSupabaseUser } from "@/lib/server/auth";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const ALLOWED_SCOPES = new Set(["telemetry:read", "telemetry:write"]);

function normalizeScopes(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  for (const raw of input) {
    if (typeof raw !== "string") continue;
    const v = raw.trim().toLowerCase();
    if (!v) continue;
    if (!ALLOWED_SCOPES.has(v)) continue;
    if (out.includes(v)) continue;
    out.push(v);
  }
  return out;
}

function normalizeName(input: unknown): string {
  if (typeof input !== "string") return "Default";
  const trimmed = input.trim().replace(/\s+/g, " ").slice(0, 60);
  return trimmed || "Default";
}

export async function GET(req: Request) {
  const auth = await requireSupabaseUser(req);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: 401 });
  }

  const admin = getSupabaseAdminClient();
  const { data, error } = await admin
    .from("api_keys")
    .select("id,name,key_prefix,scopes,created_at,last_used_at,revoked_at")
    .eq("created_by", auth.user.id)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, keys: data ?? [] });
}

export async function POST(req: Request) {
  const auth = await requireSupabaseUser(req);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: 401 });
  }

  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    // ignore
  }

  const name = normalizeName((body as any)?.name);
  const scopes = normalizeScopes((body as any)?.scopes);
  const finalScopes = scopes.length > 0 ? scopes : ["telemetry:read"];

  const admin = getSupabaseAdminClient();

  // Retry a few times on the extremely unlikely hash collision / insert race.
  for (let i = 0; i < 3; i++) {
    const { key, keyPrefix, keyHash } = generateApiKey({ env: "live" });

    const { data, error } = await admin
      .from("api_keys")
      .insert({
        name,
        key_prefix: keyPrefix,
        key_hash: keyHash,
        scopes: finalScopes,
        created_by: auth.user.id,
      })
      .select("id,name,key_prefix,scopes,created_at")
      .single();

    if (error) {
      const msg = String(error.message || "");
      const looksLikeUnique = msg.toLowerCase().includes("duplicate") || msg.toLowerCase().includes("unique");
      if (looksLikeUnique && i < 2) continue;
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      apiKey: key,
      record: data,
    });
  }

  return NextResponse.json({ ok: false, error: "failed_to_create_key" }, { status: 500 });
}

