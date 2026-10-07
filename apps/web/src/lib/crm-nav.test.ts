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
const keys = (role: CrmActor['role']) => crmNavItems(actor(role), now).map((item) => item.key);

describe('crmNavItems', () => {
  it('gives the owner every place, grouped for the day, the members and the business', () => {
    const items = crmNavItems(actor('OWNER'), now);
    expect(items.map((item) => item.key)).toEqual([
      'home', 'members', 'fees', 'attendance', 'calls', 'leads', 'messages', 'diet', 'announce', 'bot', 'gallery', 'reports', 'import', 'staff', 'kiosk', 'settings', 'pin',
    ]);
    expect(new Set(items.map((item) => item.group))).toEqual(new Set(['today', 'people', 'business', 'account']));
  });

  it('has no entry of its own for QR arrivals, who are members like anybody else', () => {
    // The gym asked for it gone: the Members screen says how many are waiting and
    // opens the queue, so a QR arrival is not a separate kind of person (ADR-086).
    for (const role of ['OWNER', 'RECEPTION', 'TRAINER'] as const) expect(keys(role)).not.toContain('verify');
  });

  it('keeps money, settings, staff, the register import and the announcement from reception', () => {
    // One message to every member is the owner's alone (ADR-079).
    expect(keys('RECEPTION')).toEqual(['home', 'members', 'fees', 'attendance', 'calls', 'leads', 'messages', 'diet', 'pin']);
    expect(keys('RECEPTION')).not.toContain('announce');
  });

  it('shows diet plans to a trainer, whose job the gym floor is (ADR-089)', () => {
    expect(keys('TRAINER')).toContain('diet');
  });
});
