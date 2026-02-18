import "server-only";

import { getSupabaseAdminClient } from "@/lib/supabase/admin";

export function getBearerTokenFromRequest(req: Request): string | null {
  const raw = req.headers.get("authorization") || "";
  const m = raw.match(/^Bearer\\s+(.+)$/i);
  return m?.[1]?.trim() || null;
}

export async function requireSupabaseUser(req: Request) {
  const token = getBearerTokenFromRequest(req);
  if (!token) {
    return { ok: false as const, error: "missing_bearer_token" };
  }

  const admin = getSupabaseAdminClient();
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) {
    return { ok: false as const, error: "invalid_token" };
  }

  const user = data.user;
  const isAnonymous = Boolean((user as unknown as { is_anonymous?: boolean }).is_anonymous);
  return { ok: true as const, user: { id: user.id, isAnonymous } };
}

