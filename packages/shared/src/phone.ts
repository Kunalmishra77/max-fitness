/**
 * Indian mobile numbers.
 *
 * TRD §5: store E.164 (`+91XXXXXXXXXX`); validate `^[6-9]\d{9}$` after normalisation.
 * Numbers arrive from a dozen places — a web form, a CSV import, a WhatsApp webhook,
 * the kiosk keypad — in every format a person might type, so normalisation happens
 * once, here, and everything downstream sees E.164.
 *
 * A mobile is deliberately not unique on `Member` (database-design.md §2): families
 * share one number, and BR-5.6 gives each of them their own reminder.
 */

const NATIONAL_PATTERN = /^[6-9]\d{9}$/;
const E164_PATTERN = /^\+91[6-9]\d{9}$/;

export type E164Mobile = string & { readonly __brand: 'E164Mobile' };

export class InvalidMobileError extends Error {
  constructor() {
    // Deliberately no value in the message: this ends up in logs (CLAUDE.md §2.8).
    super('Not a valid Indian mobile number');
    this.name = 'InvalidMobileError';
  }
}

/** Strip everything a human might type around the digits: spaces, dashes, dots, brackets. */
function digitsOnly(input: string): string {
  return input.replace(/[\s\-().\u00A0\u2010-\u2015]/g, '');
}

/**
 * Reduce any Indian mobile spelling to its 10 national digits, or `null`.
 *
 * Accepts `9876543210`, `09876543210`, `+91 98765 43210`, `0091-9876543210`,
 * `91 9876543210`. Rejects landlines, short codes and numbers starting 0-5,
 * which India does not issue to mobiles.
 */
export function nationalMobileDigits(input: string): string | null {
  if (typeof input !== 'string') return null;
  let s = digitsOnly(input.trim());

  if (s.startsWith('+')) {
    s = s.slice(1);
    if (!s.startsWith('91')) return null; // we only handle +91
    s = s.slice(2);
  } else if (s.startsWith('0091')) {
    s = s.slice(4);
  } else if (s.startsWith('00')) {
    return null; // some other country's international prefix
  } else if (s.length === 12 && s.startsWith('91')) {
    s = s.slice(2);
  } else if (s.length === 11 && s.startsWith('0')) {
    s = s.slice(1);
  }

  if (!/^\d+$/.test(s)) return null;
  return NATIONAL_PATTERN.test(s) ? s : null;
}

/** Normalise to E.164, or `null` when the input is not a valid Indian mobile. */
export function normaliseIndianMobile(input: string): E164Mobile | null {
  const national = nationalMobileDigits(input);
  return national === null ? null : (`+91${national}` as E164Mobile);
}

/** Normalise to E.164 or throw. Use at validated boundaries where a bad value is a bug. */
export function toE164(input: string): E164Mobile {
  const e164 = normaliseIndianMobile(input);
  if (e164 === null) {
    throw new InvalidMobileError();
  }
  return e164;
}

export function isValidIndianMobile(input: string): boolean {
  return normaliseIndianMobile(input) !== null;
}

export function isE164Mobile(value: unknown): value is E164Mobile {
  return typeof value === 'string' && E164_PATTERN.test(value);
}

/** The 10 national digits of an E.164 number, for display at the desk. */
export function nationalNumber(mobile: E164Mobile): string {
  return mobile.slice(3);
}

/** `+919876543210` -> `98765 43210`. Display only; never store this form. */
export function formatIndianMobile(mobile: E164Mobile): string {
  const n = nationalNumber(mobile);
  return `${n.slice(0, 5)} ${n.slice(5)}`;
}

/** The `wa.me` deep link reception staff tap to open a chat. */
export function whatsappLink(mobile: E164Mobile, text?: string): string {
  const base = `https://wa.me/${mobile.slice(1)}`;
  return text === undefined ? base : `${base}?text=${encodeURIComponent(text)}`;
}
