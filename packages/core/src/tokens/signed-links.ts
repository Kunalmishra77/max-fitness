import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';
import type { Clock, TokenPurpose } from '@mfp/shared';
import { DomainError } from '../errors';

/**
 * Signed links (security-plan.md §3.1).
 *
 * Members get URLs they did not log in to reach: a renew link in a WhatsApp
 * message, a receipt link, an unsubscribe button payload. Each carries an HMAC over
 * `purpose|subject|exp|nonce`, so a token cannot be forged, cannot be replayed after
 * it expires, and — this is the part that is easy to get wrong — cannot be moved
 * from one purpose to another. A receipt link must not become an unsubscribe.
 *
 * Verification is constant-time. A comparison that returns early on the first wrong
 * byte leaks the signature one byte at a time to anyone patient enough to measure.
 */

const VERSION = 'v1';
const NONCE_BYTES = 9; // 12 base64url characters
const SEPARATOR = '.';

export interface SignedTokenPayload {
  readonly purpose: TokenPurpose;
  /** What the token grants access to — usually a member id. Never a secret. */
  readonly subject: string;
  /** Unix seconds. */
  readonly expiresAt: number;
  readonly nonce: string;
}

export interface IssueTokenInput {
  readonly purpose: TokenPurpose;
  readonly subject: string;
  readonly ttlSeconds: number;
  readonly secret: string;
  readonly clock: Clock;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function signingInput(payload: SignedTokenPayload): string {
  return [VERSION, payload.purpose, payload.subject, String(payload.expiresAt), payload.nonce].join('|');
}

function sign(payload: SignedTokenPayload, secret: string): string {
  return createHmac('sha256', secret).update(signingInput(payload)).digest('base64url');
}

/**
 * Mint a token.
 *
 * TTLs are short and set by the caller: minutes for a registration continuation,
 * days for a renew link. The `nonce` makes two tokens for the same subject and
 * second distinct, so one appearing in a log does not reveal another.
 */
export function issueToken(input: IssueTokenInput): string {
  if (input.secret.length < 32) {
    throw new DomainError('VALIDATION_FAILED', 'Token secret must be at least 32 characters');
  }
  if (!Number.isInteger(input.ttlSeconds) || input.ttlSeconds <= 0) {
    throw new DomainError('VALIDATION_FAILED', 'Token TTL must be a positive whole number of seconds');
  }

  const payload: SignedTokenPayload = {
    purpose: input.purpose,
    subject: input.subject,
    expiresAt: Math.floor(input.clock.now().getTime() / 1000) + input.ttlSeconds,
    nonce: randomBytes(NONCE_BYTES).toString('base64url'),
  };

  const body = base64url(JSON.stringify(payload));
  return `${body}${SEPARATOR}${sign(payload, input.secret)}`;
}

export interface VerifyTokenInput {
  readonly token: string;
  /** The purpose the caller expects. A token for anything else is rejected. */
  readonly purpose: TokenPurpose;
  readonly secret: string;
  readonly clock: Clock;
}

export type VerifyTokenResult =
  | { readonly valid: true; readonly subject: string; readonly expiresAt: number }
  | { readonly valid: false; readonly reason: 'MALFORMED' | 'BAD_SIGNATURE' | 'EXPIRED' | 'WRONG_PURPOSE' };

/**
 * Verify a token.
 *
 * Returns a result rather than throwing: a bad token is an expected event (an old
 * link, a truncated URL, someone poking at the endpoint), not an exception. The
 * caller decides whether that is a 404, a friendly "this link has expired" page, or
 * a security log entry.
 *
 * The order is deliberate — signature before expiry, so a forged token is never
 * distinguishable from an expired one by response timing or message.
 */
export function verifyToken(input: VerifyTokenInput): VerifyTokenResult {
  const parts = input.token.split(SEPARATOR);
  if (parts.length !== 2) {
    return { valid: false, reason: 'MALFORMED' };
  }
  const [body, providedSignature] = parts as [string, string];

  let payload: SignedTokenPayload;
  try {
    const decoded: unknown = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!isPayload(decoded)) {
      return { valid: false, reason: 'MALFORMED' };
    }
    payload = decoded;
  } catch {
    return { valid: false, reason: 'MALFORMED' };
  }

  const expected = sign(payload, input.secret);
  if (!constantTimeEquals(expected, providedSignature)) {
    return { valid: false, reason: 'BAD_SIGNATURE' };
  }

  // Purpose is inside the signed payload, so this check runs on trusted data.
  if (payload.purpose !== input.purpose) {
    return { valid: false, reason: 'WRONG_PURPOSE' };
  }

  if (Math.floor(input.clock.now().getTime() / 1000) >= payload.expiresAt) {
    return { valid: false, reason: 'EXPIRED' };
  }

  return { valid: true, subject: payload.subject, expiresAt: payload.expiresAt };
}

/** Verify or throw, for call sites where an invalid token really is exceptional. */
export function verifyTokenOrThrow(input: VerifyTokenInput): string {
  const result = verifyToken(input);
  if (result.valid) return result.subject;
  const code =
    result.reason === 'EXPIRED'
      ? 'TOKEN_EXPIRED'
      : result.reason === 'WRONG_PURPOSE'
        ? 'TOKEN_WRONG_PURPOSE'
        : 'TOKEN_INVALID';
  throw new DomainError(code, 'This link is not valid', { reason: result.reason });
}

function isPayload(value: unknown): value is SignedTokenPayload {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v['purpose'] === 'string' &&
    typeof v['subject'] === 'string' &&
    typeof v['expiresAt'] === 'number' &&
    Number.isFinite(v['expiresAt']) &&
    typeof v['nonce'] === 'string'
  );
}

/**
 * Constant-time string comparison.
 *
 * `timingSafeEqual` throws on a length mismatch, which would itself leak the
 * length, so both sides are hashed to a fixed 32 bytes first and those are
 * compared.
 */
export function constantTimeEquals(a: string, b: string): boolean {
  const ha = createHmac('sha256', 'length-blind').update(a).digest();
  const hb = createHmac('sha256', 'length-blind').update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** The WhatsApp button payload for BR-6.1, e.g. `UNSUB.<token>`. */
export function buttonPayload(action: 'UNSUB' | 'RESTART', token: string): string {
  return `${action}.${token}`;
}

export function parseButtonPayload(
  payload: string,
): { action: 'UNSUB' | 'RESTART'; token: string } | null {
  const dot = payload.indexOf('.');
  if (dot === -1) return null;
  const action = payload.slice(0, dot);
  const token = payload.slice(dot + 1);
  if (token.length === 0) return null;
  if (action !== 'UNSUB' && action !== 'RESTART') return null;
  return { action, token };
}
