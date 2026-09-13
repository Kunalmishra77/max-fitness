/**
 * Masking helpers for logs, error reports and any screen a stranger might see.
 *
 * CLAUDE.md §2.8 and coding-standards.md §7: never log a full mobile, email, token
 * or image. These functions are the only sanctioned way to put such a value into a
 * log line. Pino's redaction paths are the safety net, not the plan.
 */

const REDACTED = '[redacted]';

/**
 * `+919876543210` -> `+91 98xxxxx210`.
 *
 * Keeps the leading two and trailing three digits: enough for reception to confirm
 * "yes, that's the number ending 210" without the log being a contact list.
 */
export function maskMobile(mobile: string | null | undefined): string {
  if (!mobile) return REDACTED;
  const digits = mobile.replace(/\D/g, '');
  if (digits.length < 6) return REDACTED;
  const national = digits.length > 10 ? digits.slice(-10) : digits;
  const prefix = digits.length > 10 ? `+${digits.slice(0, digits.length - 10)} ` : '';
  return `${prefix}${national.slice(0, 2)}${'x'.repeat(national.length - 5)}${national.slice(-3)}`;
}

/**
 * `arjun.sharma@example.com` -> `ar***@example.com`.
 *
 * The domain survives because it is useful for debugging delivery and is not
 * personally identifying on its own; the local part does not.
 */
export function maskEmail(email: string | null | undefined): string {
  if (!email) return REDACTED;
  const at = email.lastIndexOf('@');
  if (at <= 0 || at === email.length - 1) return REDACTED;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const keep = local.length <= 2 ? 1 : 2;
  return `${local.slice(0, keep)}***@${domain}`;
}

/**
 * Tokens, session ids, device tokens, signatures, API keys.
 *
 * Nothing of the value survives. A "first four characters" convention leaks entropy
 * from short-lived tokens for no operational benefit — correlate with the request id
 * instead.
 */
export function maskToken(_token: string | null | undefined): string {
  return REDACTED;
}

/** `Arjun Sharma` -> `Arjun S.` — for owner-visible logs where a name aids recognition. */
export function maskName(name: string | null | undefined): string {
  if (!name) return REDACTED;
  const parts = name.trim().split(/\s+/);
  const first = parts[0];
  if (first === undefined || first.length === 0) return REDACTED;
  if (parts.length === 1) return first;
  const lastInitial = parts[parts.length - 1]?.charAt(0) ?? '';
  return `${first} ${lastInitial}.`;
}

/** A storage key or media id — never log the object itself, and never a signed URL. */
export function maskStorageKey(key: string | null | undefined): string {
  if (!key) return REDACTED;
  const slash = key.lastIndexOf('/');
  return slash === -1 ? REDACTED : `${key.slice(0, slash + 1)}***`;
}

/** Field names pino must redact. Kept beside the maskers so the two cannot drift apart. */
export const LOG_REDACT_PATHS: readonly string[] = [
  'mobile',
  '*.mobile',
  '*.*.mobile',
  'email',
  '*.email',
  '*.*.email',
  'pin',
  '*.pin',
  'pinHash',
  '*.pinHash',
  'token',
  '*.token',
  'tokenHash',
  '*.tokenHash',
  'vector',
  '*.vector',
  'vectorEnc',
  '*.vectorEnc',
  'dob',
  '*.dob',
  'authorization',
  'cookie',
  'req.headers.authorization',
  'req.headers.cookie',
  'password',
  '*.password',
] as const;
