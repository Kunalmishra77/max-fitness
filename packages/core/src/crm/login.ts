import { createHash, randomBytes } from 'node:crypto';
import { isValidIndianMobile, toE164, type Clock, type Language } from '@mfp/shared';
import { DomainError } from '../errors';
import type { PinHasher } from '../ports/auth';
import { PIN_ELEVATION_MINUTES, type CrmRole } from './permissions';

/**
 * Staff sign-in (security-plan.md §3.1; crm-ux-blueprint §1; ADR-094).
 *
 * One field takes **either a mobile number or an email address**. The owner asked for
 * `admin@` and `reception@` rather than two phone numbers to remember, and the desk still
 * has people who only know the number — so the identifier is sniffed rather than chosen
 * from a dropdown, because a dropdown is one more thing to get wrong at a busy counter.
 *
 * A 4–6 digit PIN is weak by design — it has to be typed one-handed — so the protection is
 * around it: Argon2id hashing (the hasher is injected), five attempts before a 15-minute
 * lockout counted against the **account** rather than the thing typed (so trying the email
 * five times and the mobile five times is still five), and the same answer for an unknown
 * sign-in as for a wrong PIN, so the screen never confirms who works here.
 *
 * The session token is random and handed to the browser once; only its SHA-256 hash is
 * stored, so a leaked database does not hand anyone a working session.
 */

export const LOGIN_MAX_ATTEMPTS = 5;
export const LOGIN_LOCKOUT_MINUTES = 15;
export const SESSION_IDLE_HOURS = 12;
export const SESSION_TRUSTED_DAYS = 30;

const PIN_PATTERN = /^\d{4,6}$/;
/** Deliberately loose: the address is only ever looked up, never sent to. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const TOKEN_BYTES = 32;

export interface StaffForLogin {
  readonly id: string;
  readonly gymId: string;
  readonly name: string;
  readonly role: CrmRole;
  readonly language: Language;
  readonly pinHash: string;
  readonly isActive: boolean;
  readonly failedPinCount: number;
  readonly lockedUntil: Date | null;
}

export interface NewSessionRecord {
  readonly staffUserId: string;
  readonly tokenHash: string;
  readonly expiresAt: Date;
  readonly ipHash: string | null;
  readonly userAgent: string | null;
  readonly trusted: boolean;
}

export interface LoginStore {
  findStaffByMobile(gymId: string, mobile: string): Promise<StaffForLogin | null>;
  findStaffByEmail(gymId: string, email: string): Promise<StaffForLogin | null>;
  recordFailedPin(staffUserId: string, failedCount: number, lockedUntil: Date | null): Promise<void>;
  clearFailedPins(staffUserId: string, lastLoginAt: Date): Promise<void>;
  createSession(record: NewSessionRecord): Promise<void>;
}

export type { PinHasher };

/** What the session cookie resolves to on every CRM request. */
export interface LoggedInStaff {
  readonly staffUserId: string;
  readonly gymId: string;
  readonly role: CrmRole;
  readonly name: string;
  readonly language: Language;
  /** Signing in counts as entering the PIN (security-plan.md §3.1). */
  readonly elevatedUntil: Date;
  readonly receptionMayTakePayments: boolean;
}

export interface LoginInput {
  /** A mobile number or an email address; which one it is, is worked out here. */
  readonly identifier: string;
  readonly pin: string;
  readonly ipHash: string | null;
  readonly userAgent: string | null;
  /** "This is my phone": a longer session (security-plan.md §3.1). */
  readonly trusted: boolean;
}

export function sessionTokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function elevationExpiry(from: Date): Date {
  return new Date(from.getTime() + PIN_ELEVATION_MINUTES * 60_000);
}

export async function login(
  input: LoginInput,
  deps: {
    readonly store: LoginStore;
    readonly hasher: PinHasher;
    readonly clock: Clock;
    readonly gymId: string;
    /** Defaults to the owner's setting; the CRM passes the gym's value. */
    readonly receptionMayTakePayments?: boolean;
  },
): Promise<{ token: string; actor: LoggedInStaff }> {
  // An address is trimmed and lower-cased before anything else: a phone keyboard
  // capitalises the first letter, and nobody at a desk at 6am will notice it did.
  const typed = input.identifier.trim();
  const email = typed.toLowerCase();
  const looksLikeEmail = EMAIL_PATTERN.test(email);

  if (!PIN_PATTERN.test(input.pin) || !(looksLikeEmail || isValidIndianMobile(typed))) {
    throw new DomainError('VALIDATION_FAILED', 'Enter a mobile number or email, and a PIN');
  }

  const now = deps.clock.now();
  const staff = looksLikeEmail ? await deps.store.findStaffByEmail(deps.gymId, email) : await deps.store.findStaffByMobile(deps.gymId, toE164(typed));

  // An unknown sign-in and a wrong PIN look the same from outside.
  if (staff === null || !staff.isActive) {
    throw new DomainError('INVALID_PIN', 'Sign-in or PIN is wrong');
  }
  if (staff.lockedUntil !== null && staff.lockedUntil.getTime() > now.getTime()) {
    throw new DomainError('ACCOUNT_LOCKED', 'Too many wrong PINs', {
      retryAfterSeconds: Math.ceil((staff.lockedUntil.getTime() - now.getTime()) / 1000),
    });
  }

  if (!(await deps.hasher.verify(staff.pinHash, input.pin))) {
    const failedCount = staff.failedPinCount + 1;
    const locked = failedCount >= LOGIN_MAX_ATTEMPTS;
    await deps.store.recordFailedPin(staff.id, failedCount, locked ? new Date(now.getTime() + LOGIN_LOCKOUT_MINUTES * 60_000) : null);
    if (locked) {
      throw new DomainError('ACCOUNT_LOCKED', 'Too many wrong PINs', { retryAfterSeconds: LOGIN_LOCKOUT_MINUTES * 60 });
    }
    throw new DomainError('INVALID_PIN', 'Sign-in or PIN is wrong', { attemptsLeft: LOGIN_MAX_ATTEMPTS - failedCount });
  }

  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  await deps.store.createSession({
    staffUserId: staff.id,
    tokenHash: sessionTokenHash(token),
    expiresAt: new Date(now.getTime() + (input.trusted ? SESSION_TRUSTED_DAYS * 86_400_000 : SESSION_IDLE_HOURS * 3_600_000)),
    ipHash: input.ipHash,
    userAgent: input.userAgent,
    trusted: input.trusted,
  });
  await deps.store.clearFailedPins(staff.id, now);

  return {
    token,
    actor: {
      staffUserId: staff.id,
      gymId: staff.gymId,
      role: staff.role,
      name: staff.name,
      language: staff.language,
      elevatedUntil: elevationExpiry(now),
      receptionMayTakePayments: deps.receptionMayTakePayments ?? true,
    },
  };
}
