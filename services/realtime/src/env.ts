export function requiredEnv(name: string): string {
  const raw = process.env[name];
  const v = typeof raw === "string" ? raw.trim() : "";
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

export function optionalEnv(name: string): string | undefined {
  const raw = process.env[name];
  const v = typeof raw === "string" ? raw.trim() : "";
  return v.length > 0 ? v : undefined;
}

export function envInt(name: string, fallback: number): number {
  const raw = optionalEnv(name);
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

