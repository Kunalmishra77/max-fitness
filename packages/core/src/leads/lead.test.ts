import { describe, expect, it } from 'vitest';
import { FakeClock, LeadCreateSchema, type E164Mobile } from '@mfp/shared';
import type { OutboxEventInput } from '../ports/outbox';
import { ist } from '../testing/builders';
import {
  LEAD_DEDUPE_WINDOW_DAYS,
  MIN_FORM_FILL_MS,
  appendNote,
  decideLeadDedupe,
  dedupeWindowStart,
  detectBot,
  repeatEnquiryNote,
} from './lead.rules';
import { submitLead, type LeadAlertRecord, type LeadStore, type LeadUnitOfWork, type NewLeadRecord } from './lead.service';

const NOW = ist('2026-09-10T19:00');
const days = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

describe('decideLeadDedupe — BR-10.3', () => {
  it('creates a lead when this mobile has not enquired recently', () => {
    expect(decideLeadDedupe([], NOW)).toEqual({ action: 'create' });
  });

  it('merges into a lead from within the last 7 days', () => {
    expect(decideLeadDedupe([{ id: 'l1', createdAt: days(3) }], NOW)).toEqual({ action: 'merge', leadId: 'l1' });
  });

  it('merges at exactly 7 days, and creates just past it', () => {
    expect(decideLeadDedupe([{ id: 'l1', createdAt: days(LEAD_DEDUPE_WINDOW_DAYS) }], NOW).action).toBe('merge');
    expect(
      decideLeadDedupe([{ id: 'l1', createdAt: new Date(days(LEAD_DEDUPE_WINDOW_DAYS).getTime() - 1) }], NOW).action,
    ).toBe('create');
  });

  it('merges into the newest when several are in the window', () => {
    const decision = decideLeadDedupe(
      [
        { id: 'older', createdAt: days(6) },
        { id: 'newest', createdAt: days(1) },
        { id: 'middle', createdAt: days(3) },
      ],
      NOW,
    );
    expect(decision).toEqual({ action: 'merge', leadId: 'newest' });
  });

  it('ignores leads a repository over-fetched from outside the window', () => {
    expect(decideLeadDedupe([{ id: 'ancient', createdAt: days(40) }], NOW)).toEqual({ action: 'create' });
  });

  it('computes the window start for the query', () => {
    expect(dedupeWindowStart(NOW).getTime()).toBe(days(7).getTime());
  });
});

describe('notes', () => {
  it('records a repeat enquiry with the IST date, source and goal', () => {
    expect(repeatEnquiryNote('WEBSITE_HERO', 'BUILD_MUSCLE', ist('2026-09-10T23:30'))).toBe(
      'Enquired again on 2026-09-10 via WEBSITE_HERO (goal: BUILD_MUSCLE)',
    );
  });

  it('appends without losing earlier notes', () => {
    expect(appendNote(null, 'b')).toBe('b');
    expect(appendNote('   ', 'b')).toBe('b');
    expect(appendNote('a', 'b')).toBe('a\nb');
  });
});

describe('detectBot', () => {
  it('flags a filled honeypot', () => {
    expect(detectBot({ honeypot: 'Acme Ltd', renderedAt: undefined, now: NOW })).toBe('HONEYPOT');
  });

  it('flags a submission faster than a person can type', () => {
    expect(detectBot({ honeypot: undefined, renderedAt: NOW.getTime() - 500, now: NOW })).toBe('TOO_FAST');
  });

  it('accepts a normal submission', () => {
    expect(detectBot({ honeypot: '', renderedAt: NOW.getTime() - MIN_FORM_FILL_MS, now: NOW })).toBeNull();
    expect(detectBot({ honeypot: undefined, renderedAt: undefined, now: NOW })).toBeNull();
  });

  it('does not punish a client clock ahead of the server', () => {
    expect(detectBot({ honeypot: undefined, renderedAt: NOW.getTime() + 60_000, now: NOW })).toBeNull();
  });
});

// ── submitLead with an in-memory store ────────────────────────────────────────

interface StoredLead extends NewLeadRecord {
  id: string;
  createdAt: Date;
  notes: string | null;
}

function memoryUow(seed: StoredLead[] = []) {
  const leads = [...seed];
  const alerts: LeadAlertRecord[] = [];
  const outbox: OutboxEventInput[] = [];
  let committed = 0;
  let nextId = 1;
  let clockNow = NOW;

  const store: LeadStore = {
    findLeadsByMobileSince: (gymId, mobile, since) =>
      Promise.resolve(leads.filter((l) => l.gymId === gymId && l.mobile === mobile && l.createdAt >= since)),
    createLead: (lead) => {
      const id = `lead_${nextId++}`;
      leads.push({ ...lead, id, createdAt: clockNow, notes: null });
      return Promise.resolve(id);
    },
    appendLeadNote: (leadId, update) => {
      const lead = leads.find((l) => l.id === leadId);
      if (lead) lead.notes = update(lead.notes);
      return Promise.resolve();
    },
    createAlert: (alert) => {
      alerts.push(alert);
      return Promise.resolve();
    },
    enqueueOutbox: (event) => {
      outbox.push(event);
      return Promise.resolve();
    },
  };

  const uow: LeadUnitOfWork = {
    async transaction(work) {
      const result = await work(store);
      committed += 1;
      return result;
    },
  };

  return {
    uow,
    leads,
    alerts,
    outbox,
    commits: () => committed,
    setNow: (d: Date) => {
      clockNow = d;
    },
  };
}

const input = (overrides: Record<string, unknown> = {}) =>
  LeadCreateSchema.parse({ name: 'Neha Gupta', mobile: '98765 43210', goal: 'LOSE_WEIGHT', consentContact: true, ...overrides });

describe('submitLead', () => {
  it('creates a lead with the mobile in E.164 and one owner alert, in one transaction', async () => {
    const mem = memoryUow();
    const result = await submitLead(input(), { gymId: 'gym_1', clock: new FakeClock(NOW), uow: mem.uow });

    expect(result).toEqual({ leadId: 'lead_1', merged: false });
    expect(mem.commits()).toBe(1);
    expect(mem.leads[0]).toMatchObject({ gymId: 'gym_1', name: 'Neha Gupta', mobile: '+919876543210', goal: 'LOSE_WEIGHT', source: 'WEBSITE_HERO', utm: null });
    expect(mem.alerts).toEqual([
      { gymId: 'gym_1', type: 'NEW_LEAD', title: 'crm.alerts.newLead', params: { leadId: 'lead_1', name: 'Neha Gupta', goal: 'LOSE_WEIGHT' } },
    ]);
    // The Alert row is the record the owner's alert job reads; there is no second
    // copy of the same intent in the outbox (ADR-065).
    expect(mem.outbox).toEqual([]);
  });

  it('keeps UTM data when present', async () => {
    const mem = memoryUow();
    await submitLead(input({ utm: { source: 'google', medium: 'gbp' } }), { gymId: 'gym_1', clock: new FakeClock(NOW), uow: mem.uow });
    expect(mem.leads[0]?.utm).toEqual({ source: 'google', medium: 'gbp' });
  });

  it('BR-10.3 — folds a repeat enquiry into the recent lead, with a note and no second alert', async () => {
    const mem = memoryUow([
      {
        id: 'existing',
        gymId: 'gym_1',
        name: 'Neha',
        mobile: '+919876543210' as E164Mobile,
        goal: 'GET_FIT',
        source: 'WEBSITE_OTHER',
        utm: null,
        createdAt: days(2),
        notes: 'Asked about timings',
      },
    ]);

    const result = await submitLead(input({ goal: 'BUILD_MUSCLE' }), { gymId: 'gym_1', clock: new FakeClock(NOW), uow: mem.uow });

    expect(result).toEqual({ leadId: 'existing', merged: true });
    expect(mem.leads).toHaveLength(1);
    expect(mem.leads[0]?.notes).toBe('Asked about timings\nEnquired again on 2026-09-10 via WEBSITE_HERO (goal: BUILD_MUSCLE)');
    expect(mem.alerts).toHaveLength(0);
    expect(mem.outbox).toHaveLength(0);
  });

  it('treats the same mobile at a different gym as a different enquiry', async () => {
    const mem = memoryUow([
      { id: 'other-gym', gymId: 'gym_2', name: 'Neha', mobile: '+919876543210' as E164Mobile, goal: 'GET_FIT', source: 'WEBSITE_HERO', utm: null, createdAt: days(1), notes: null },
    ]);
    const result = await submitLead(input(), { gymId: 'gym_1', clock: new FakeClock(NOW), uow: mem.uow });
    expect(result.merged).toBe(false);
  });

  it('matches a repeat enquiry however the number was typed', async () => {
    const mem = memoryUow();
    const clock = new FakeClock(NOW);
    await submitLead(input({ mobile: '9876543210' }), { gymId: 'gym_1', clock, uow: mem.uow });
    clock.advanceDays(1);
    mem.setNow(clock.now());
    const second = await submitLead(input({ mobile: '+91 98765-43210' }), { gymId: 'gym_1', clock, uow: mem.uow });
    expect(second).toEqual({ leadId: 'lead_1', merged: true });
  });

  it('creates a new lead once the 7-day window has passed', async () => {
    const mem = memoryUow();
    const clock = new FakeClock(NOW);
    await submitLead(input(), { gymId: 'gym_1', clock, uow: mem.uow });
    clock.advanceDays(8);
    mem.setNow(clock.now());
    const later = await submitLead(input(), { gymId: 'gym_1', clock, uow: mem.uow });
    expect(later).toEqual({ leadId: 'lead_2', merged: false });
    expect(mem.alerts).toHaveLength(2);
  });

  it('writes nothing when the transaction fails part-way', async () => {
    const mem = memoryUow();
    const failing: LeadUnitOfWork = {
      async transaction(work) {
        const staged: string[] = [];
        const store: LeadStore = {
          findLeadsByMobileSince: () => Promise.resolve([]),
          createLead: () => {
            staged.push('lead');
            return Promise.resolve('lead_x');
          },
          appendLeadNote: () => Promise.resolve(),
          createAlert: () => Promise.reject(new Error('alert insert failed')),
          enqueueOutbox: () => Promise.resolve(),
        };
        return work(store);
      },
    };
    await expect(submitLead(input(), { gymId: 'gym_1', clock: new FakeClock(NOW), uow: failing })).rejects.toThrow('alert insert failed');
    expect(mem.leads).toHaveLength(0);
  });
});
