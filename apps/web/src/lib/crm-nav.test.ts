// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { CrmActor } from '@mfp/core';
import { crmNavItems } from './crm-nav';

/**
 * One menu for Max Register (ADR-062): the desktop sidebar and the "More" screen list the
 * same places, each shown only to whoever may use it, so a trainer never taps into a
 * screen that only says "not allowed".
 */

const now = new Date('2026-09-18T06:00:00Z');
const actor = (role: CrmActor['role']): CrmActor => ({ staffUserId: 's1', gymId: 'g1', role, elevatedUntil: null, receptionMayTakePayments: true });
const keys = (role: CrmActor['role']) => crmNavItems(actor(role), now, 0).map((item) => item.key);

describe('crmNavItems', () => {
  it('gives the owner every place, grouped for the day, the members and the business', () => {
    const items = crmNavItems(actor('OWNER'), now, 3);
    expect(items.map((item) => item.key)).toEqual([
      'home', 'members', 'fees', 'attendance', 'calls', 'leads', 'verify', 'reports', 'import', 'staff', 'settings', 'pin',
    ]);
    expect(items.find((item) => item.key === 'verify')?.badge).toBe(3);
    expect(new Set(items.map((item) => item.group))).toEqual(new Set(['today', 'people', 'business', 'account']));
  });

  it('keeps money, settings, staff and the register import from reception', () => {
    expect(keys('RECEPTION')).toEqual(['home', 'members', 'fees', 'attendance', 'calls', 'leads', 'verify', 'pin']);
  });

  it('keeps the verify queue from a trainer as well', () => {
    expect(keys('TRAINER')).not.toContain('verify');
    expect(keys('TRAINER')).toContain('attendance');
  });

  it('shows no badge when nothing is waiting', () => {
    expect(crmNavItems(actor('OWNER'), now, 0).find((item) => item.key === 'verify')?.badge).toBeUndefined();
  });
});
