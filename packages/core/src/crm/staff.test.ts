import { beforeEach, describe, expect, it } from 'vitest';
import { fakeClockAt } from '../testing/builders';
import type { CrmActor } from './permissions';
import {
  addStaff,
  resetStaffPin,
  setStaffActive,
  type NewStaffRecord,
  type StaffAuditEntry,
  type StaffForManagement,
  type StaffStore,
} from './staff';

/**
 * Managing the people who log in (crm-ux-blueprint §14; crm-module-spec §3; security-plan §3.1).
 *
 * The demo PINs must not survive handover: the owner adds reception and trainers with
 * PINs of their own, resets a forgotten PIN, and switches off someone who has left.
 * Three rules carry the security weight — a PIN never reaches the audit log in any form,
 * a reset or a switch-off signs that person out of every device at once, and nobody can
 * make another owner or lock the owner out from this screen.
 */

const clock = fakeClockAt('2026-09-14T11:00');
const owner: CrmActor = {
  staffUserId: 'staff_owner',
  gymId: 'gym_1',
  role: 'OWNER',
  elevatedUntil: new Date(clock.now().getTime() + 60_000),
  receptionMayTakePayments: true,
};
const ownerWithoutPin: CrmActor = { ...owner, elevatedUntil: null };
const reception: CrmActor = { ...owner, staffUserId: 'staff_rec', role: 'RECEPTION' };

const hasher = {
  hash: (pin: string) => Promise.resolve(`hash:${pin}`),
  verify: (stored: string, pin: string) => Promise.resolve(stored === `hash:${pin}`),
};

class FakeStore implements StaffStore {
  staff: StaffForManagement[] = [
    { id: 'staff_owner', gymId: 'gym_1', role: 'OWNER', isActive: true },
    { id: 'staff_rec', gymId: 'gym_1', role: 'RECEPTION', isActive: true },
  ];
  takenMobiles = new Set(['+919000000001', '+919000000002']);
  readonly created: NewStaffRecord[] = [];
  readonly pins: Array<{ staffUserId: string; pinHash: string }> = [];
  readonly active: Array<{ staffUserId: string; isActive: boolean }> = [];
  readonly revoked: Array<{ staffUserId: string; at: Date }> = [];
  readonly audit: StaffAuditEntry[] = [];

  findStaff(gymId: string, staffUserId: string) {
    return Promise.resolve(this.staff.find((row) => row.id === staffUserId && row.gymId === gymId) ?? null);
  }
  mobileTaken(_gymId: string, mobile: string) {
    return Promise.resolve(this.takenMobiles.has(mobile));
  }
  createStaff(record: NewStaffRecord) {
    this.created.push(record);
    return Promise.resolve('staff_new');
  }
  setPin(staffUserId: string, pinHash: string) {
    this.pins.push({ staffUserId, pinHash });
    return Promise.resolve();
  }
  setActive(staffUserId: string, isActive: boolean) {
    this.active.push({ staffUserId, isActive });
    return Promise.resolve();
  }
  revokeSessions(staffUserId: string, at: Date) {
    this.revoked.push({ staffUserId, at });
    return Promise.resolve();
  }
  writeAudit(entry: StaffAuditEntry) {
    this.audit.push(entry);
    return Promise.resolve();
  }
}

describe('addStaff', () => {
  let store: FakeStore;
  beforeEach(() => {
    store = new FakeStore();
  });

  const add = (input: Partial<Parameters<typeof addStaff>[0]> = {}, actor: CrmActor = owner) =>
    addStaff(
      { name: 'रीना शर्मा', mobile: '+919000000003', role: 'RECEPTION', pin: '4826', ...input },
      { actor, clock, uow: { transaction: (work) => work(store) }, hasher },
    );

  it('adds a receptionist with a hashed PIN, in Hindi by default, and never writes the PIN anywhere else', async () => {
    await expect(add()).resolves.toEqual({ staffUserId: 'staff_new' });

    expect(store.created).toEqual([
      { gymId: 'gym_1', name: 'रीना शर्मा', mobile: '+919000000003', role: 'RECEPTION', pinHash: 'hash:4826', language: 'hi' },
    ]);
    expect(store.audit).toHaveLength(1);
    expect(store.audit[0]).toMatchObject({ action: 'staff.add', entityType: 'StaffUser', entityId: 'staff_new', actorId: 'staff_owner' });
    // Not the PIN, not its hash: an audit log is read by people.
    expect(JSON.stringify(store.audit)).not.toMatch(/4826|hash:/);
  });

  it('adds a trainer too', async () => {
    await add({ role: 'TRAINER', mobile: '+919000000004' });
    expect(store.created[0]).toMatchObject({ role: 'TRAINER' });
  });

  it('refuses a mobile number someone at this gym already logs in with', async () => {
    await expect(add({ mobile: '+919000000002' })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(store.created).toEqual([]);
  });

  it('refuses to make another owner from here', async () => {
    await expect(add({ role: 'OWNER' as never })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(add({ role: 'SUPER_ADMIN' as never })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(store.created).toEqual([]);
  });

  it('refuses a PIN that is not four to six digits', async () => {
    await expect(add({ pin: '12' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(add({ pin: '12a4' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('needs the owner, with a PIN entered a moment ago', async () => {
    await expect(add({}, ownerWithoutPin)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(add({}, reception)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(store.created).toEqual([]);
  });
});

describe('resetStaffPin', () => {
  let store: FakeStore;
  beforeEach(() => {
    store = new FakeStore();
  });

  const reset = (staffUserId = 'staff_rec', pin = '7391', actor: CrmActor = owner) =>
    resetStaffPin({ staffUserId, pin }, { actor, clock, uow: { transaction: (work) => work(store) }, hasher });

  it('sets the new PIN and signs that person out of every device', async () => {
    await expect(reset()).resolves.toEqual({ staffUserId: 'staff_rec' });

    expect(store.pins).toEqual([{ staffUserId: 'staff_rec', pinHash: 'hash:7391' }]);
    expect(store.revoked).toEqual([{ staffUserId: 'staff_rec', at: clock.now() }]);
    expect(store.audit[0]).toMatchObject({ action: 'staff.pin_reset', entityId: 'staff_rec' });
    expect(JSON.stringify(store.audit)).not.toMatch(/7391|hash:/);
  });

  it("does not reset an owner's PIN here: an owner changes their own, with the current one", async () => {
    await expect(reset('staff_owner')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(store.pins).toEqual([]);
  });

  it('refuses someone who is not at this gym, and a PIN that is not four to six digits', async () => {
    await expect(reset('staff_elsewhere')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(reset('staff_rec', '99')).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('needs the owner, with a PIN entered a moment ago', async () => {
    await expect(reset('staff_rec', '7391', ownerWithoutPin)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('setStaffActive', () => {
  let store: FakeStore;
  beforeEach(() => {
    store = new FakeStore();
  });

  const set = (staffUserId: string, active: boolean, actor: CrmActor = owner) =>
    setStaffActive({ staffUserId, active }, { actor, clock, uow: { transaction: (work) => work(store) } });

  it('switches off someone who has left, and signs them out everywhere at once', async () => {
    await expect(set('staff_rec', false)).resolves.toEqual({ changed: true });

    expect(store.active).toEqual([{ staffUserId: 'staff_rec', isActive: false }]);
    expect(store.revoked).toEqual([{ staffUserId: 'staff_rec', at: clock.now() }]);
    expect(store.audit[0]).toMatchObject({ action: 'staff.deactivate', entityId: 'staff_rec' });
  });

  it('switches someone back on without touching sessions, and does nothing when nothing would change', async () => {
    store.staff = store.staff.map((row) => (row.id === 'staff_rec' ? { ...row, isActive: false } : row));
    await expect(set('staff_rec', true)).resolves.toEqual({ changed: true });
    expect(store.revoked).toEqual([]);
    expect(store.audit[0]).toMatchObject({ action: 'staff.activate' });

    await expect(set('staff_owner', true)).resolves.toEqual({ changed: false });
    expect(store.audit).toHaveLength(1);
  });

  it('refuses to switch off an owner, including yourself', async () => {
    await expect(set('staff_owner', false)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(store.active).toEqual([]);
  });

  it('needs the owner, with a PIN entered a moment ago', async () => {
    await expect(set('staff_rec', false, ownerWithoutPin)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(set('staff_rec', false, reception)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
