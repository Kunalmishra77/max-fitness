import { describe, expect, it } from 'vitest';
import { CRM_CAPABILITIES, assertCan, can, mayAfterPinEntry, type CrmActor, type CrmCapability } from './permissions';

const NOW = new Date('2026-09-12T10:00:00Z');

const actor = (role: CrmActor['role'], overrides: Partial<CrmActor> = {}): CrmActor => ({
  staffUserId: 'staff_1',
  gymId: 'gym_1',
  role,
  elevatedUntil: null,
  receptionMayTakePayments: true,
  ...overrides,
});

/** crm-module-spec.md §3, one row per capability. `true` means allowed for that role. */
const MATRIX: Record<CrmCapability, Record<CrmActor['role'], boolean>> = {
  'home.view': { OWNER: true, RECEPTION: true, TRAINER: true, SUPER_ADMIN: true },
  'money.view': { OWNER: true, RECEPTION: false, TRAINER: false, SUPER_ADMIN: true },
  'member.view': { OWNER: true, RECEPTION: true, TRAINER: true, SUPER_ADMIN: true },
  'member.edit': { OWNER: true, RECEPTION: true, TRAINER: false, SUPER_ADMIN: true },
  'payment.record': { OWNER: true, RECEPTION: true, TRAINER: false, SUPER_ADMIN: true },
  'payment.discount': { OWNER: true, RECEPTION: true, TRAINER: false, SUPER_ADMIN: true },
  'payment.void': { OWNER: true, RECEPTION: false, TRAINER: false, SUPER_ADMIN: true },
  'member.markLeft': { OWNER: true, RECEPTION: true, TRAINER: false, SUPER_ADMIN: true },
  'member.reactivate': { OWNER: true, RECEPTION: false, TRAINER: false, SUPER_ADMIN: true },
  'verification.approve': { OWNER: true, RECEPTION: true, TRAINER: false, SUPER_ADMIN: true },
  'attendance.manual': { OWNER: true, RECEPTION: true, TRAINER: true, SUPER_ADMIN: true },
  'call.outcome': { OWNER: true, RECEPTION: true, TRAINER: false, SUPER_ADMIN: true },
  'settings.manage': { OWNER: true, RECEPTION: false, TRAINER: false, SUPER_ADMIN: true },
  'member.export': { OWNER: true, RECEPTION: false, TRAINER: false, SUPER_ADMIN: true },
};

describe('CRM permissions', () => {
  it('covers every capability in the matrix', () => {
    expect([...CRM_CAPABILITIES].sort()).toEqual(Object.keys(MATRIX).sort());
  });

  for (const [capability, roles] of Object.entries(MATRIX) as Array<[CrmCapability, Record<CrmActor['role'], boolean>]>) {
    for (const [role, allowed] of Object.entries(roles) as Array<[CrmActor['role'], boolean]>) {
      it(`${allowed ? 'allows' : 'refuses'} ${role} to ${capability}`, () => {
        expect(can(actor(role, { elevatedUntil: new Date('2100-01-01') }), capability, NOW)).toBe(allowed);
      });
    }
  }

  it('refuses a reception payment when the gym has turned that setting off', () => {
    expect(can(actor('RECEPTION', { receptionMayTakePayments: false }), 'payment.record', NOW)).toBe(false);
    expect(can(actor('OWNER', { receptionMayTakePayments: false }), 'payment.record', NOW)).toBe(true);
  });

  it('needs a recent PIN for sensitive actions, however senior the actor', () => {
    const owner = actor('OWNER', { elevatedUntil: null });
    expect(can(owner, 'settings.manage', NOW)).toBe(false);
    expect(can(owner, 'payment.void', NOW)).toBe(false);
    // Ordinary work needs no re-entry.
    expect(can(owner, 'payment.record', NOW)).toBe(true);
  });

  it('treats an expired elevation as no elevation', () => {
    const owner = actor('OWNER', { elevatedUntil: new Date('2026-09-12T10:00:00Z') });
    expect(can(owner, 'settings.manage', new Date('2026-09-12T09:59:00Z'))).toBe(true);
    expect(can(owner, 'settings.manage', new Date('2026-09-12T10:00:01Z'))).toBe(false);
  });

  it('says whether entering the PIN would be enough, so a screen knows whether to offer it', () => {
    const owner = actor('OWNER', { elevatedUntil: null });
    expect(mayAfterPinEntry(owner, 'payment.void', NOW)).toBe(true);
    // Not a way around the PIN: until one is entered, the action itself is still refused.
    expect(can(owner, 'payment.void', NOW)).toBe(false);

    // A role that may never do it is not offered the PIN at all.
    expect(mayAfterPinEntry(actor('RECEPTION'), 'payment.void', NOW)).toBe(false);
    expect(mayAfterPinEntry(actor('TRAINER'), 'payment.record', NOW)).toBe(false);
    expect(mayAfterPinEntry(actor('RECEPTION', { receptionMayTakePayments: false }), 'payment.record', NOW)).toBe(false);
  });

  it('throws FORBIDDEN with the capability, for the API layer to map', () => {
    try {
      assertCan(actor('TRAINER'), 'payment.record', NOW);
      throw new Error('expected a refusal');
    } catch (error) {
      expect(error).toMatchObject({ code: 'FORBIDDEN', meta: { capability: 'payment.record', role: 'TRAINER' } });
    }
  });
});
