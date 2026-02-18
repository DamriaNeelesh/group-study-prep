import { NextResponse } from "next/server";

import { hashApiKey } from "@/lib/server/apiKeys";
import { requireSupabaseUser } from "@/lib/server/auth";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

function getApiKeyFromHeaders(req: Request) {
  return (
    req.headers.get("x-studyroom-api-key")?.trim() ||
    req.headers.get("x-api-key")?.trim() ||
    null
  );
}

function hasScope(scopes: unknown, needed: string) {
  if (!Array.isArray(scopes)) return false;
  return scopes.some((s) => typeof s === "string" && s.toLowerCase() === needed);
}

async function validateApiKey(key: string, neededScope: string) {
  const admin = getSupabaseAdminClient();
  const keyHash = hashApiKey(key);
  const { data, error } = await admin
    .from("api_keys")
    .select("id,scopes,revoked_at,created_by")
    .eq("key_hash", keyHash)
    .maybeSingle();

  if (error) return { ok: false as const, error: error.message };
  if (!data) return { ok: false as const, error: "invalid_api_key" };
  if (data.revoked_at) return { ok: false as const, error: "revoked_api_key" };
  const createdBy = (data as any)?.created_by as string | null | undefined;
  if (!createdBy) return { ok: false as const, error: "orphaned_api_key" };
  if (!hasScope(data.scopes, neededScope)) {
    return { ok: false as const, error: "insufficient_scope" };
  }

  // Best-effort usage tracking.
  void admin
    .from("api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", data.id);

  return { ok: true as const, keyId: data.id as string, createdBy };
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ roomId: string }> },
) {
  const params = await ctx.params;
  const roomId = String(params.roomId || "").trim();
  if (!roomId) {
    return NextResponse.json({ ok: false, error: "missing_room_id" }, { status: 400 });
  }

  const url = new URL(req.url);
  const limitRaw = url.searchParams.get("limit");
  const limit = Math.min(
    500,
    Math.max(50, Number(limitRaw || 200) || 200),
  );

  const apiKey = getApiKeyFromHeaders(req);
  const admin = getSupabaseAdminClient();

  let viewerUserId: string | null = null;

  if (apiKey) {
    const res = await validateApiKey(apiKey, "telemetry:read");
    if (!res.ok) {
      return NextResponse.json({ ok: false, error: res.error }, { status: 401 });
    }
    viewerUserId = res.createdBy;
  } else {
    const auth = await requireSupabaseUser(req);
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: 401 });
    }
    viewerUserId = auth.user.id;
  }

  const { data: room, error: roomError } = await admin
    .from("rooms")
    .select("created_by")
    .eq("id", roomId)
    .maybeSingle();

  if (roomError) {
    return NextResponse.json({ ok: false, error: roomError.message }, { status: 500 });
  }
  if (!room) {
    return NextResponse.json({ ok: false, error: "room_not_found" }, { status: 404 });
  }

  const createdBy = (room as any)?.created_by as string | undefined;
  if (!createdBy || createdBy !== viewerUserId) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const { data: events, error } = await admin
    .from("telemetry_events")
    .select("id,at,source,room_id,user_id,type,payload")
    .eq("room_id", roomId)
    .order("at", { ascending: false })
    .limit(limit);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const counts: Record<string, number> = {};
  for (const e of events || []) {
    const type = String((e as any)?.type || "");
    if (!type) continue;
    counts[type] = (counts[type] || 0) + 1;
  }

  return NextResponse.json({
    ok: true,
    roomId,
    limit,
    summary: {
      totalEvents: (events || []).length,
      counts,
      latestAt: (events as any)?.[0]?.at ?? null,
    },
    events: events || [],
  });
}
