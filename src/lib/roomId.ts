const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ROOM_PATH_RE =
  /\/(?:room|lecture)\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/i;

export function isUuid(input: string) {
  return UUID_RE.test(input.trim());
}

export function looksLikeShortRoomCode(input: string) {
  // Most commonly: user copied the first 8 chars of the UUID shown in UI.
  return /^[0-9a-f]{8}$/i.test(input.trim());
}

export function extractRoomIdFromInput(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (UUID_RE.test(trimmed)) return trimmed.toLowerCase();

  // Handles raw text like: "localhost:3000/room/<uuid>" (no scheme) or pasted link text.
  const m = ROOM_PATH_RE.exec(trimmed);
  if (m?.[1] && UUID_RE.test(m[1])) return m[1].toLowerCase();

  // Handles full URLs with scheme.
  try {
    const url = new URL(trimmed);
    const parts = url.pathname.split("/").filter(Boolean);
    const roomIdx = parts.findIndex((p) => {
      const n = p.toLowerCase();
      return n === "room" || n === "lecture";
    });
    const candidate = roomIdx >= 0 ? (parts[roomIdx + 1] ?? "") : "";
    if (UUID_RE.test(candidate)) return candidate.toLowerCase();
  } catch {
    // ignore
  }

  return null;
}
