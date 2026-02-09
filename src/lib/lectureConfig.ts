"use client";

function normalizeBase(value: string) {
  return value.trim().replace(/\/$/, "");
}

function isLocalhostHost(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1";
}

function isProbablyLocalhostUrl(value: string) {
  try {
    const u = new URL(value);
    return isLocalhostHost(u.hostname);
  } catch {
    return false;
  }
}

function isLocalPageHost() {
  if (typeof window === "undefined") return false;
  return isLocalhostHost(window.location.hostname);
}

/**
 * Returns the Lecture API base URL.
 * - In dev on localhost, it falls back to `http://localhost:4001` if env is missing.
 * - On non-localhost (Vercel/production), it never falls back to localhost.
 */
export function getLectureApiBaseUrl(): string | null {
  const raw = process.env.NEXT_PUBLIC_LECTURE_API_URL;
  if (raw && raw.trim()) {
    const base = normalizeBase(raw);

    // If the app is running on a real domain but the API base is localhost,
    // treat it as a misconfiguration and force a friendly error.
    if (typeof window !== "undefined" && !isLocalPageHost() && isProbablyLocalhostUrl(base)) {
      return null;
    }

    return base;
  }

  if (typeof window !== "undefined" && isLocalPageHost()) {
    return "http://localhost:4001";
  }

  return null;
}

export function getLectureApiBaseUrlOrThrow(): string {
  const base = getLectureApiBaseUrl();
  if (base) return base;

  throw new Error(
    "Lecture API is not configured. Set NEXT_PUBLIC_LECTURE_API_URL to your deployed lecture-server URL (e.g. https://<service>.onrender.com) and redeploy the frontend."
  );
}

