import type { Clock } from '@mfp/shared';
import { DomainError } from '../errors';
import type { PinHasher } from '../ports/auth';
import { LOGIN_LOCKOUT_MINUTES, LOGIN_MAX_ATTEMPTS, elevationExpiry } from './login';
import type { CrmActor } from './permissions';

/**
 * Re-entering the PIN for a sensitive action (security-plan.md §3.1).
 *
 * Voiding a payment, changing settings and exporting a member need the PIN again, so a
 * phone left unlocked on the desk cannot be used for them.
 *
 * Elevation is the same PIN as the login, so it carries the same five-attempt lockout:
 * without that, this would be an unlimited PIN oracle that walks straight around the
 * login screen's limit. And it is not a separate flag — touching the session's
 * `lastSeenAt` is what makes the next `PIN_ELEVATION_MINUTES` count as elevated, which
 * is the same rule `actorFor` reads on every request.
 */

const PIN_PATTERN = /^\d{4,6}$/;

export interface StaffForElevation {
  readonly pinHash: string;
  readonly isActive: boolean;
  readonly failedPinCount: number;
  readonly lockedUntil: Date | null;
}

export interface ElevationStore {
  staffForElevation(staffUserId: string): Promise<StaffForElevation | null>;
  recordFailedPin(staffUserId: string, failedCount: number, lockedUntil: Date | null): Promise<void>;
  clearFailedPins(staffUserId: string, at: Date): Promise<void>;
  /** Elevation is stored as "the PIN was entered now" on the session row. */
  touchSession(token: string, now: Date): Promise<void>;
}

/** Returns when the elevation lapses, so the caller can say "five minutes". */
export async function elevateSession(
  input: { readonly token: string; readonly pin: string },
  deps: { readonly actor: CrmActor; readonly store: ElevationStore; readonly hasher: PinHasher; readonly clock: Clock },
): Promise<Date> {
  if (!PIN_PATTERN.test(input.pin)) throw new DomainError('VALIDATION_FAILED', 'Enter your PIN');

  const now = deps.clock.now();
  const staff = await deps.store.staffForElevation(deps.actor.staffUserId);
  if (staff === null || !staff.isActive) throw new DomainError('INVALID_PIN', 'That PIN is wrong');

  if (staff.lockedUntil !== null && staff.lockedUntil.getTime() > now.getTime()) {
    throw new DomainError('ACCOUNT_LOCKED', 'Too many wrong PINs', {
      retryAfterSeconds: Math.ceil((staff.lockedUntil.getTime() - now.getTime()) / 1000),
    });
  }

  if (!(await deps.hasher.verify(staff.pinHash, input.pin))) {
    const failedCount = staff.failedPinCount + 1;
    const locked = failedCount >= LOGIN_MAX_ATTEMPTS;
    await deps.store.recordFailedPin(deps.actor.staffUserId, failedCount, locked ? new Date(now.getTime() + LOGIN_LOCKOUT_MINUTES * 60_000) : null);
    if (locked) throw new DomainError('ACCOUNT_LOCKED', 'Too many wrong PINs', { retryAfterSeconds: LOGIN_LOCKOUT_MINUTES * 60 });
    throw new DomainError('INVALID_PIN', 'That PIN is wrong', { attemptsLeft: LOGIN_MAX_ATTEMPTS - failedCount });
  }

  await deps.store.clearFailedPins(deps.actor.staffUserId, now);
  await deps.store.touchSession(input.token, now);
  return elevationExpiry(now);
}
