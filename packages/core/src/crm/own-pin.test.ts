import { beforeEach, describe, expect, it } from 'vitest';
import { fakeClockAt } from '../testing/builders';
import { LOGIN_LOCKOUT_MINUTES, LOGIN_MAX_ATTEMPTS } from './login';
import { changeOwnPin, type OwnPinAuditEntry, type OwnPinStore, type StaffForPinChange } from './own-pin';
import type { CrmActor } from './permissions';

/**
 * Changing your own PIN (security-plan §3.1 and §6: "owner and staff PINs set by them").
 *
 * The demo owner PIN cannot survive handover, and nobody else can change an owner's PIN,
 * so every staff member — owner included — changes their own, proving it is them with the
 * current PIN. Checking that current PIN is a PIN guess like any other, so it spends the
 * same five attempts as the login screen; otherwise this screen would be a way around the
 * lockout. When it succeeds, every other device is signed out and this one stays in.
 */

const clock = fakeClockAt('2026-09-14T11:00');
const owner: CrmActor = { staffUserId: 'staff_owner', gymId: 'gym_1', role: 'OWNER', elevatedUntil: null, receptionMayTakePayments: true };

const hasher = {
  hash: (pin: string) => Promise.resolve(`hash:${pin}`),
  verify: (stored: string, pin: string) => Promise.resolve(stored === `hash:${pin}`),
};

const me: StaffForPinChange = { pinHash: 'hash:2468', isActive: true, failedPinCount: 0, lockedUntil: null };

class FakeStore implements OwnPinStore {
  staff: StaffForPinChange | null = me;
  readonly failures: Array<{ staffUserId: string; failedCount: number; lockedUntil: Date | null }> = [];
  readonly pins: Array<{ staffUserId: string; pinHash: string }> = [];
  readonly revoked: Array<{ staffUserId: string; keepToken: string; at: Date }> = [];
  readonly audit: OwnPinAuditEntry[] = [];

  staffForPinChange(staffUserId: string) {
    return Promise.resolve(staffUserId === 'staff_owner' ? this.staff : null);
  }
  recordFailedPin(staffUserId: string, failedCount: number, lockedUntil: Date | null) {
    this.failures.push({ staffUserId, failedCount, lockedUntil });
    return Promise.resolve();
  }
  setPin(staffUserId: string, pinHash: string) {
    this.pins.push({ staffUserId, pinHash });
    return Promise.resolve();
  }
  revokeOtherSessions(staffUserId: string, keepToken: string, at: Date) {
    this.revoked.push({ staffUserId, keepToken, at });
    return Promise.resolve();
  }
  writeAudit(entry: OwnPinAuditEntry) {
    this.audit.push(entry);
    return Promise.resolve();
  }
}

describe('changeOwnPin', () => {
  let store: FakeStore;
  beforeEach(() => {
    store = new FakeStore();
  });

  const change = (currentPin = '2468', newPin = '905173') =>
    changeOwnPin({ currentPin, newPin, token: 'tok_this_phone' }, { actor: owner, clock, uow: { transaction: (work) => work(store) }, hasher });

  it('sets the new PIN, keeps this phone signed in and signs every other device out', async () => {
    await expect(change()).resolves.toEqual({ staffUserId: 'staff_owner' });

    expect(store.pins).toEqual([{ staffUserId: 'staff_owner', pinHash: 'hash:905173' }]);
    expect(store.revoked).toEqual([{ staffUserId: 'staff_owner', keepToken: 'tok_this_phone', at: clock.now() }]);
    expect(store.audit).toHaveLength(1);
    expect(store.audit[0]).toMatchObject({ action: 'staff.pin_change', entityType: 'StaffUser', entityId: 'staff_owner', actorId: 'staff_owner' });
    // Neither PIN nor any hash in the audit log.
    expect(JSON.stringify(store.audit)).not.toMatch(/2468|905173|hash:/);
  });

  it('refuses a wrong current PIN, counting it against the same five attempts as the login screen', async () => {
    await expect(change('1111')).rejects.toMatchObject({ code: 'INVALID_PIN', meta: { attemptsLeft: LOGIN_MAX_ATTEMPTS - 1 } });

    expect(store.failures).toEqual([{ staffUserId: 'staff_owner', failedCount: 1, lockedUntil: null }]);
    expect(store.pins).toEqual([]);
    expect(store.revoked).toEqual([]);
  });

  it('locks the account on the fifth wrong PIN, like the login screen', async () => {
    store.staff = { ...me, failedPinCount: LOGIN_MAX_ATTEMPTS - 1 };
    await expect(change('1111')).rejects.toMatchObject({ code: 'ACCOUNT_LOCKED' });
    expect(store.failures[0]?.lockedUntil).toEqual(new Date(clock.now().getTime() + LOGIN_LOCKOUT_MINUTES * 60_000));
  });

  it('refuses while locked, without spending an attempt or looking at the PIN', async () => {
    store.staff = { ...me, lockedUntil: new Date(clock.now().getTime() + 60_000) };
    await expect(change()).rejects.toMatchObject({ code: 'ACCOUNT_LOCKED' });
    expect(store.failures).toEqual([]);
    expect(store.pins).toEqual([]);
  });

  it('refuses a new PIN that is not four to six digits, or the same as the current one', async () => {
    await expect(change('2468', '12')).rejects.toMatchObject({ code: 'VALIDATION_FAILED', meta: { field: 'newPin' } });
    await expect(change('2468', '2468')).rejects.toMatchObject({ code: 'VALIDATION_FAILED', meta: { field: 'newPin' } });
    expect(store.failures).toEqual([]);
    expect(store.pins).toEqual([]);
  });

  it('refuses someone who has been switched off, the same way a wrong PIN is refused', async () => {
    store.staff = { ...me, isActive: false };
    await expect(change()).rejects.toMatchObject({ code: 'INVALID_PIN' });

    store.staff = null;
    await expect(change()).rejects.toMatchObject({ code: 'INVALID_PIN' });
    expect(store.pins).toEqual([]);
  });
});
