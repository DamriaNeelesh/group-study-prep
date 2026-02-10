export type BotQuickReply = { id: string; label: string };

export type BotMessage = { role: 'bot'; text: string };

export type BotResponse = {
  session_id?: string;
  messages: BotMessage[];
  quick_replies?: BotQuickReply[];
};

export type NtUser = { id: string | null; name: string | null; mobile: string | null };

export function getVisitorId(): string {
  const key = 'nt_bot_visitor_id';
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const id = crypto.randomUUID();
  localStorage.setItem(key, id);
  return id;
}

export function getNtUserFromLocalStorage(): NtUser {
  return {
    id: localStorage.getItem('user_id'),
    name: localStorage.getItem('userName'),
    mobile: localStorage.getItem('userMobile'),
  };
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Request failed (${res.status}): ${text || res.statusText}`);
  }
  return (await res.json()) as T;
}

export async function botStart(functionsBaseUrl: string): Promise<BotResponse> {
  const visitor_id = getVisitorId();
  const page_url = location.href;
  const nt_user = getNtUserFromLocalStorage();
  return await postJson<BotResponse>(`${functionsBaseUrl}/bot_start`, {
    visitor_id,
    page_url,
    nt_user,
  });
}

export async function botEvent(
  functionsBaseUrl: string,
  payload:
    | { session_id: string; type: 'select'; selection_id: string; page_url: string }
    | { session_id: string; type: 'text'; text: string; page_url: string }
): Promise<BotResponse> {
  return await postJson<BotResponse>(`${functionsBaseUrl}/bot_event`, payload);
}

