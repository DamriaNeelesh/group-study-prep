import { jwtVerify } from "jose";

export type VerifiedUser = {
  userId: string;
  isAnonymous: boolean;
};

export async function verifySupabaseJwt(args: {
  token: string;
  jwtSecret?: string;
}): Promise<VerifiedUser> {
  if (!args.jwtSecret) throw new Error("Missing SUPABASE_JWT_SECRET for local JWT verification.");

  const secret = new TextEncoder().encode(args.jwtSecret);
  const { payload } = await jwtVerify(args.token, secret, { algorithms: ["HS256"] });

  const userId = typeof payload.sub === "string" ? payload.sub : "";
  if (!userId) throw new Error("Invalid JWT: missing sub");

  const isAnonymous = Boolean((payload as Record<string, unknown>)["is_anonymous"]);
  return { userId, isAnonymous };
}

