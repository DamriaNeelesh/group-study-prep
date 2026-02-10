export type Persona = 'student' | 'parent' | 'lead';

export type TargetExam = 'board' | 'jee' | 'neet' | 'mixed' | 'unknown';

export type L1MenuId =
  | 'new_batches'
  | 'enrolled_support'
  | 'fees_offers'
  | 'timetable'
  | 'callback';

export type BotQuickReply = { id: string; label: string };

export type BotMessage = { role: 'bot'; text: string };

export type BotResponse = {
  session_id?: string;
  messages: BotMessage[];
  quick_replies?: BotQuickReply[];
};

export function normalizePhoneToE164(
  input: string,
  opts?: { defaultCountry?: 'IN' }
): { ok: true; e164: string } | { ok: false; error: string } {
  const raw = (input ?? '').trim();
  if (!raw) return { ok: false, error: 'Phone number is required.' };

  // Keep leading +, remove everything else non-digit
  const plus = raw.startsWith('+') ? '+' : '';
  const digits = raw.replace(/[^\d]/g, '');
  const candidate = plus ? `+${digits}` : digits;

  // E.164 with + and 8-15 digits
  if (candidate.startsWith('+')) {
    const e164Digits = candidate.slice(1);
    if (e164Digits.length < 8 || e164Digits.length > 15) {
      return { ok: false, error: 'Invalid phone number length.' };
    }
    return { ok: true, e164: `+${e164Digits}` };
  }

  const defaultCountry = opts?.defaultCountry ?? 'IN';
  if (defaultCountry === 'IN') {
    // Common Indian formats: 10-digit mobile; sometimes prefixed with 0 or 91
    if (digits.length === 10) return { ok: true, e164: `+91${digits}` };
    if (digits.length === 11 && digits.startsWith('0'))
      return { ok: true, e164: `+91${digits.slice(1)}` };
    if (digits.length === 12 && digits.startsWith('91'))
      return { ok: true, e164: `+${digits}` };
    return { ok: false, error: 'Please enter a valid 10-digit mobile number.' };
  }

  return { ok: false, error: 'Unsupported default country.' };
}

export function isHandoverTrigger(text: string): boolean {
  const t = (text ?? '').toLowerCase();
  if (!t) return false;
  return (
    /\binstallment(s)?\b/.test(t) ||
    /\bemi\b/.test(t) ||
    /\bpartial\b/.test(t) ||
    /\bdiscount\b/.test(t) ||
    /\bspecial offer\b/.test(t) ||
    /\b3 installments?\b/.test(t)
  );
}

export function inferTargetExam(text: string): TargetExam {
  const t = (text ?? '').toLowerCase();
  if (/\bjee\b/.test(t)) return 'jee';
  if (/\bneet\b/.test(t)) return 'neet';
  if (/\bboard(s)?\b/.test(t)) return 'board';
  return 'unknown';
}

export function inferPersona(text: string): Persona {
  // Heuristic only; we mainly use menu flows.
  const t = (text ?? '').toLowerCase();
  if (/\b(parent|father|mother|guardian)\b/.test(t)) return 'parent';
  if (/\b(student|class|batch|doubt|video)\b/.test(t)) return 'student';
  return 'lead';
}

