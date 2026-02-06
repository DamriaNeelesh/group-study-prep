const YOUTUBE_ID_RE = /^[a-zA-Z0-9_-]{11}$/;

export function normalizeYouTubeId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (YOUTUBE_ID_RE.test(trimmed)) return trimmed;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  // https://youtu.be/<id>
  if (url.hostname === "youtu.be") {
    const id = url.pathname.split("/").filter(Boolean)[0] ?? "";
    return YOUTUBE_ID_RE.test(id) ? id : null;
  }

  const host = url.hostname.replace(/^www\./, "");
  if (host !== "youtube.com" && host !== "m.youtube.com") return null;

  // https://youtube.com/watch?v=<id>
  const v = url.searchParams.get("v");
  if (v && YOUTUBE_ID_RE.test(v)) return v;

  // https://youtube.com/shorts/<id>
  const parts = url.pathname.split("/").filter(Boolean);
  const [a, b] = parts;
  if (a === "shorts" || a === "embed") {
    const id = b ?? "";
    return YOUTUBE_ID_RE.test(id) ? id : null;
  }

  return null;
}

