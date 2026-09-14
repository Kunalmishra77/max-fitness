import type { Clock } from '@mfp/shared';
import { DomainError } from '../errors';
import type { PinHasher } from '../ports/auth';
import { LOGIN_LOCKOUT_MINUTES, LOGIN_MAX_ATTEMPTS } from './login';
import type { CrmActor } from './permissions';
import type { PinSetter } from './staff';

/**
 * Changing your own PIN (security-plan §3.1 and §6: "owner and staff PINs set by them").
 *
 * Nobody else can change an owner's PIN, and the demo owner PIN must not survive
 * handover, so every staff member — owner included — changes their own here, proving it
 * is them with the current PIN.
 *
 * Checking that current PIN is a PIN guess like any other, so it spends the login
 * screen's five attempts and its lockout; otherwise this screen would be a way around
 * both. **A wrong guess is recorded inside the transaction but reported after it**: an
 * error thrown inside would roll the failure count back with everything else, and the
 * lockout would never build up. The database integration test proves the count survives.
 *
 * When it succeeds, every other device is signed out and this one stays signed in — the
 * person changing it is the one person known to be here.
 */

const PIN_PATTERN = /^\d{4,6}$/;

export interface StaffForPinChange {
  readonly pinHash: string;
  readonly isActive: boolean;
  readonly failedPinCount: number;
  readonly lockedUntil: Date | null;
}

export interface OwnPinAuditEntry {
  readonly gymId: string;
  readonly actorType: 'staff';
  readonly actorId: string;
  readonly action: 'staff.pin_change';
  readonly entityType: 'StaffUser';
  readonly entityId: string;
  readonly before: Readonly<Record<string, unknown>>;
  readonly after: Readonly<Record<string, unknown>>;
}

export interface OwnPinStore {
  staffForPinChange(staffUserId: string): Promise<StaffForPinChange | null>;
  recordFailedPin(staffUserId: string, failedCount: number, lockedUntil: Date | null): Promise<void>;
  /** Sets the PIN and clears any lockout. */
  setPin(staffUserId: string, pinHash: string): Promise<void>;
  /** Signs out every session of this person except the one holding `keepToken`. */
  revokeOtherSessions(staffUserId: string, keepToken: string, at: Date): Promise<void>;
  writeAudit(entry: OwnPinAuditEntry): Promise<void>;
}

export interface OwnPinUnitOfWork {
  transaction<T>(work: (store: OwnPinStore) => Promise<T>): Promise<T>;
}

type Outcome =
  | { readonly kind: 'changed' }
  | { readonly kind: 'refused' }
  | { readonly kind: 'locked'; readonly retryAfterSeconds: number }
  | { readonly kind: 'wrong'; readonly attemptsLeft: number }
  | { readonly kind: 'lockedNow' };

export async function changeOwnPin(
  input: { readonly currentPin: string; readonly newPin: string; readonly token: string },
  deps: { readonly actor: CrmActor; readonly clock: Clock; readonly uow: OwnPinUnitOfWork; readonly hasher: PinHasher & PinSetter },
): Promise<{ readonly staffUserId: string }> {
  if (!PIN_PATTERN.test(input.newPin) || input.newPin === input.currentPin) {
    throw new DomainError('VALIDATION_FAILED', 'The new PIN is four to six digits and differs from the current one', { field: 'newPin' });
  }

  const { actor } = deps;
  const now = deps.clock.now();

  const outcome = await deps.uow.transaction(async (store): Promise<Outcome> => {
    const staff = await store.staffForPinChange(actor.staffUserId);
    // A switched-off account is refused exactly like a wrong PIN: nothing to learn here.
    if (staff === null || !staff.isActive) return { kind: 'refused' };

    if (staff.lockedUntil !== null && staff.lockedUntil.getTime() > now.getTime()) {
      return { kind: 'locked', retryAfterSeconds: Math.ceil((staff.lockedUntil.getTime() - now.getTime()) / 1000) };
    }

    if (!(await deps.hasher.verify(staff.pinHash, input.currentPin))) {
      const failedCount = staff.failedPinCount + 1;
      const lockedNow = failedCount >= LOGIN_MAX_ATTEMPTS;
      await store.recordFailedPin(actor.staffUserId, failedCount, lockedNow ? new Date(now.getTime() + LOGIN_LOCKOUT_MINUTES * 60_000) : null);
      // Returned, not thrown: throwing here would roll the failure count back.
      return lockedNow ? { kind: 'lockedNow' } : { kind: 'wrong', attemptsLeft: LOGIN_MAX_ATTEMPTS - failedCount };
    }

    await store.setPin(actor.staffUserId, await deps.hasher.hash(input.newPin));
    await store.revokeOtherSessions(actor.staffUserId, input.token, now);
    await store.writeAudit({
      gymId: actor.gymId,
      actorType: 'staff',
      actorId: actor.staffUserId,
      action: 'staff.pin_change',
      entityType: 'StaffUser',
      entityId: actor.staffUserId,
      before: {},
      after: {},
    });
    return { kind: 'changed' };
  });

  switch (outcome.kind) {
    case 'changed':
      return { staffUserId: actor.staffUserId };
    case 'refused':
      throw new DomainError('INVALID_PIN', 'The current PIN is wrong');
    case 'wrong':
      throw new DomainError('INVALID_PIN', 'The current PIN is wrong', { attemptsLeft: outcome.attemptsLeft });
    case 'locked':
      throw new DomainError('ACCOUNT_LOCKED', 'Too many wrong PINs', { retryAfterSeconds: outcome.retryAfterSeconds });
    case 'lockedNow':
      throw new DomainError('ACCOUNT_LOCKED', 'Too many wrong PINs', { retryAfterSeconds: LOGIN_LOCKOUT_MINUTES * 60 });
  }
}
