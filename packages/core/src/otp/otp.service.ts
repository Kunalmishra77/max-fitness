import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import type { Clock, E164Mobile } from '@mfp/shared';
import { DomainError } from '../errors';
import type { OtpSender } from '../ports/otp';
import { issueToken, verifyToken } from '../tokens/signed-links';

export type { OtpSender } from '../ports/otp';

/**
 * One-time codes (api-specification §/otp; qr-onboarding-flow §3; ADR-060).
 *
 * The code is stored only as an HMAC keyed with the server secret and bound to the
 * number and purpose, so a database read does not reveal a live code and a hash cannot
 * be reused for another number. Limits: three sends a number in fifteen minutes, ten
 * minutes to use a code, five guesses. Only the newest code for a number counts.
 */

export type OtpPurpose = 'SIGNUP' | 'QR_EXISTING';

export const OTP_TTL_SECONDS = 600;
export const OTP_TOKEN_TTL_SECONDS = 900;
export const OTP_MAX_SENDS = 3;
export const OTP_SEND_WINDOW_MINUTES = 15;
export const OTP_MAX_ATTEMPTS = 5;

export interface OtpRecord {
  readonly id: string;
  readonly codeHash: string;
  attempts: number;
  consumedAt: Date | null;
  readonly expiresAt: Date;
}

export interface OtpStore {
  countSince(gymId: string, mobile: E164Mobile, purpose: OtpPurpose, since: Date): Promise<number>;
  create(row: { gymId: string; mobile: E164Mobile; purpose: OtpPurpose; codeHash: string; expiresAt: Date; createdAt: Date }): Promise<void>;
  /** The newest code for the number that is neither used nor expired. */
  latestOpen(gymId: string, mobile: E164Mobile, purpose: OtpPurpose, now: Date): Promise<OtpRecord | null>;
  recordFailedAttempt(id: string): Promise<void>;
  /** Marks the code used; false when someone else used it first. */
  consume(id: string, at: Date): Promise<boolean>;
}


interface OtpDeps {
  readonly clock: Clock;
  readonly store: OtpStore;
  readonly gymId: string;
  readonly secret: string;
}

function hashCode(secret: string, mobile: E164Mobile, purpose: OtpPurpose, code: string): string {
  return createHmac('sha256', secret).update(`otp|${purpose}|${mobile}|${code}`).digest('base64url');
}

function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

const newCode = (): string => String(randomInt(0, 1_000_000)).padStart(6, '0');

/**
 * Send a code. The code comes back to the caller only so DEMO_MODE can show it on screen;
 * a live route must never return it.
 */
export async function sendOtp(
  input: { mobile: E164Mobile; purpose: OtpPurpose; language: 'hi' | 'en' },
  deps: OtpDeps & { readonly sender: OtpSender; readonly randomCode?: () => string },
): Promise<{ expiresInSec: number; code: string }> {
  const now = deps.clock.now();
  const since = new Date(now.getTime() - OTP_SEND_WINDOW_MINUTES * 60_000);
  const recent = await deps.store.countSince(deps.gymId, input.mobile, input.purpose, since);
  if (recent >= OTP_MAX_SENDS) {
    throw new DomainError('OTP_RATE_LIMITED', 'Too many codes for this number', { retryAfterSeconds: OTP_SEND_WINDOW_MINUTES * 60 });
  }

  const code = (deps.randomCode ?? newCode)();
  await deps.store.create({
    gymId: deps.gymId,
    mobile: input.mobile,
    purpose: input.purpose,
    codeHash: hashCode(deps.secret, input.mobile, input.purpose, code),
    expiresAt: new Date(now.getTime() + OTP_TTL_SECONDS * 1000),
    createdAt: now,
  });
  await deps.sender.send(input.mobile, code, input.language);
  return { expiresInSec: OTP_TTL_SECONDS, code };
}

/** Exchange a right code for a token bound to the number and purpose. */
export async function verifyOtp(input: { mobile: E164Mobile; purpose: OtpPurpose; code: string }, deps: OtpDeps): Promise<{ otpToken: string }> {
  if (!/^\d{6}$/.test(input.code)) throw new DomainError('VALIDATION_FAILED', 'A code is six digits', { field: 'code' });

  const now = deps.clock.now();
  const open = await deps.store.latestOpen(deps.gymId, input.mobile, input.purpose, now);
  if (open === null) throw new DomainError('OTP_EXPIRED', 'No live code for this number');
  if (open.attempts >= OTP_MAX_ATTEMPTS) throw new DomainError('OTP_LOCKED', 'Too many wrong codes');

  if (!sameHash(open.codeHash, hashCode(deps.secret, input.mobile, input.purpose, input.code))) {
    const attemptsLeft = OTP_MAX_ATTEMPTS - open.attempts - 1;
    await deps.store.recordFailedAttempt(open.id);
    throw new DomainError('OTP_INVALID', 'Wrong code', { attemptsLeft });
  }
  if (!(await deps.store.consume(open.id, now))) throw new DomainError('OTP_EXPIRED', 'Code already used');

  return {
    otpToken: issueToken({ purpose: 'otp', subject: `${input.purpose}:${input.mobile}`, ttlSeconds: OTP_TOKEN_TTL_SECONDS, secret: deps.secret, clock: deps.clock }),
  };
}

/** Whether a token proves this number for this purpose, right now. */
export function checkOtpToken(token: string, expected: { mobile: E164Mobile; purpose: OtpPurpose }, deps: { clock: Clock; secret: string }): boolean {
  const result = verifyToken({ token, purpose: 'otp', secret: deps.secret, clock: deps.clock });
  return result.valid && result.subject === `${expected.purpose}:${expected.mobile}`;
}
