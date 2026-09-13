import { beforeEach, describe, expect, it } from 'vitest';
import { fakeClockAt } from '../testing/builders';
import { LOGIN_MAX_ATTEMPTS, elevationExpiry } from './login';
import type { CrmActor } from './permissions';
import { elevateSession, type ElevationStore, type StaffForElevation } from './elevate';

/**
 * Re-entering the PIN for a sensitive action (security-plan.md §3.1).
 *
 * Voiding a payment, changing settings and exporting a member need the PIN again, so a
 * phone left unlocked on the desk cannot be used for them. Elevation is not a separate
 * secret: it is the same PIN, the same five-attempt lockout, and the same session row —
 * touching `lastSeenAt` is what makes the next five minutes count as elevated.
 */

const owner: CrmActor = { staffUserId: 'staff_1', gymId: 'gym_1', role: 'OWNER', elevatedUntil: null, receptionMayTakePayments: true };

const staff: StaffForElevation = { pinHash: 'hash:2468', isActive: true, failedPinCount: 0, lockedUntil: null };

class FakeStore implements ElevationStore {
  staff: StaffForElevation | null = staff;
  readonly touched: Array<{ token: string; now: Date }> = [];
  readonly failed: Array<{ staffUserId: string; failedCount: number; lockedUntil: Date | null }> = [];
  cleared = 0;

  staffForElevation(staffUserId: string) {
    return Promise.resolve(staffUserId === 'staff_1' ? this.staff : null);
  }
  recordFailedPin(staffUserId: string, failedCount: number, lockedUntil: Date | null) {
    this.failed.push({ staffUserId, failedCount, lockedUntil });
    return Promise.resolve();
  }
  clearFailedPins(_staffUserId: string) {
    this.cleared += 1;
    return Promise.resolve();
  }
  touchSession(token: string, now: Date) {
    this.touched.push({ token, now });
    return Promise.resolve();
  }
}

/** The PIN is right only when it matches the hash the fake stored. */
const hasher = { verify: (storedHash: string, pin: string) => Promise.resolve(storedHash === `hash:${pin}`) };

describe('elevateSession', () => {
  let store: FakeStore;
  const clock = fakeClockAt('2026-09-12T11:30');

  beforeEach(() => {
    store = new FakeStore();
  });

  const elevate = (pin: string, actor: CrmActor = owner) => elevateSession({ token: 'tok_1', pin }, { actor, store, hasher, clock });

  it('marks the session as elevated for the next five minutes', async () => {
    await expect(elevate('2468')).resolves.toEqual(elevationExpiry(clock.now()));

    expect(store.touched).toEqual([{ token: 'tok_1', now: clock.now() }]);
    expect(store.cleared).toBe(1);
  });

  it('refuses a wrong PIN and does not elevate the session', async () => {
    await expect(elevate('9999')).rejects.toMatchObject({ code: 'INVALID_PIN', meta: { attemptsLeft: LOGIN_MAX_ATTEMPTS - 1 } });

    expect(store.touched).toEqual([]);
    expect(store.failed).toEqual([{ staffUserId: 'staff_1', failedCount: 1, lockedUntil: null }]);
  });

  it('locks the account after five wrong PINs, like the login screen does', async () => {
    store.staff = { ...staff, failedPinCount: LOGIN_MAX_ATTEMPTS - 1 };
    await expect(elevate('9999')).rejects.toMatchObject({ code: 'ACCOUNT_LOCKED' });

    expect(store.failed[0]?.lockedUntil).toEqual(new Date(clock.now().getTime() + 15 * 60_000));
  });

  it('refuses while the account is locked, without spending an attempt', async () => {
    store.staff = { ...staff, lockedUntil: new Date(clock.now().getTime() + 60_000) };
    await expect(elevate('2468')).rejects.toMatchObject({ code: 'ACCOUNT_LOCKED' });

    expect(store.failed).toEqual([]);
    expect(store.touched).toEqual([]);
  });

  it('refuses a PIN that is not four to six digits, and a staff member who has been switched off', async () => {
    await expect(elevate('12')).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

    store.staff = { ...staff, isActive: false };
    await expect(elevate('2468')).rejects.toMatchObject({ code: 'INVALID_PIN' });

    store.staff = null;
    await expect(elevate('2468')).rejects.toMatchObject({ code: 'INVALID_PIN' });
    expect(store.touched).toEqual([]);
  });
});
