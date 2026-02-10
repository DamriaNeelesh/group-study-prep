import { describe, expect, it } from 'vitest';
import { isHandoverTrigger, normalizePhoneToE164 } from '../src/index';

describe('normalizePhoneToE164', () => {
  it('normalizes indian 10-digit numbers to +91', () => {
    expect(normalizePhoneToE164('9999999999')).toEqual({
      ok: true,
      e164: '+919999999999',
    });
  });

  it('accepts already-e164 numbers', () => {
    expect(normalizePhoneToE164('+14155552671')).toEqual({
      ok: true,
      e164: '+14155552671',
    });
  });

  it('rejects empty input', () => {
    expect(normalizePhoneToE164('')).toEqual({
      ok: false,
      error: 'Phone number is required.',
    });
  });
});

describe('isHandoverTrigger', () => {
  it('matches emi', () => {
    expect(isHandoverTrigger('Can I pay via EMI?')).toBe(true);
  });

  it('matches installments', () => {
    expect(isHandoverTrigger('3 installments possible?')).toBe(true);
  });

  it('does not match normal text', () => {
    expect(isHandoverTrigger('What is your refund policy?')).toBe(false);
  });
});
