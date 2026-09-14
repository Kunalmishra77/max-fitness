import { beforeEach, describe, expect, it } from 'vitest';
import { fakeClockAt } from '../testing/builders';
import type { CrmActor } from './permissions';
import { advanceLead, type LeadForUpdate, type LeadPipelineStore, type LeadUpdate } from './lead-pipeline';

/**
 * Moving an enquiry along (BR-10.1; crm-ux-blueprint §12).
 *
 * `NEW → CONTACTED → TRIAL_BOOKED → VISITED → CONVERTED | LOST`. The desk does not
 * follow that script exactly — someone phones and walks in the same afternoon — so
 * skipping ahead is allowed; going backwards is not, and neither is touching a lead
 * that has already converted or been lost.
 */

const reception: CrmActor = { staffUserId: 'staff_2', gymId: 'gym_1', role: 'RECEPTION', elevatedUntil: null, receptionMayTakePayments: true };
const trainer: CrmActor = { ...reception, staffUserId: 'staff_3', role: 'TRAINER' };

const newLead: LeadForUpdate = { id: 'lead_1', gymId: 'gym_1', status: 'NEW', notes: null };

class FakeStore implements LeadPipelineStore {
  lead: LeadForUpdate | null = newLead;
  readonly updates: Array<LeadUpdate & { leadId: string }> = [];
  readonly closedTasks: Array<{ leadId: string; closedAt: Date; doneById: string }> = [];

  closeOpenLeadTasks(leadId: string, closedAt: Date, doneById: string) {
    this.closedTasks.push({ leadId, closedAt, doneById });
    return Promise.resolve();
  }

  loadLead(gymId: string, leadId: string) {
    return Promise.resolve(this.lead?.id === leadId && this.lead.gymId === gymId ? this.lead : null);
  }
  updateLead(leadId: string, update: LeadUpdate) {
    this.updates.push({ leadId, ...update });
    return Promise.resolve();
  }
}

describe('advanceLead', () => {
  let store: FakeStore;
  const clock = fakeClockAt('2026-09-12T11:30');

  const move = (input: Partial<Parameters<typeof advanceLead>[0]> = {}, actor: CrmActor = reception) =>
    advanceLead({ leadId: 'lead_1', to: 'CONTACTED', ...input }, { actor, clock, uow: { transaction: (work) => work(store) } });

  beforeEach(() => {
    store = new FakeStore();
  });

  it('marks a new enquiry as contacted, dating the note so the owner can read the history', async () => {
    await expect(move({ note: 'फोन किया, सोमवार को आएँगे' })).resolves.toEqual({ leadId: 'lead_1', status: 'CONTACTED' });

    expect(store.updates).toEqual([
      {
        leadId: 'lead_1',
        status: 'CONTACTED',
        notes: '2026-09-12: फोन किया, सोमवार को आएँगे',
        followUpAt: null,
        convertedMemberId: null,
      },
    ]);
  });

  it('keeps earlier notes when a second one is added', async () => {
    store.lead = { ...newLead, status: 'CONTACTED', notes: '2026-09-10: पहली बार कॉल किया' };
    await move({ to: 'TRIAL_BOOKED', note: 'ट्रायल बुक' });

    expect(store.updates[0]?.notes).toBe('2026-09-10: पहली बार कॉल किया\n2026-09-12: ट्रायल बुक');
  });

  it('remembers when to call back', async () => {
    const followUpAt = new Date('2026-09-14T05:30:00Z');
    await move({ followUpAt });
    expect(store.updates[0]).toMatchObject({ followUpAt });
  });

  it('lets the desk skip ahead, because an enquiry can walk in the same afternoon', async () => {
    await expect(move({ to: 'VISITED' })).resolves.toMatchObject({ status: 'VISITED' });
  });

  it('records which member an enquiry became', async () => {
    await expect(move({ to: 'CONVERTED', convertedMemberId: 'mem_9' })).resolves.toMatchObject({ status: 'CONVERTED' });
    expect(store.updates[0]).toMatchObject({ status: 'CONVERTED', convertedMemberId: 'mem_9' });
  });

  it('refuses to go backwards', async () => {
    store.lead = { ...newLead, status: 'VISITED' };
    await expect(move({ to: 'CONTACTED' })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(store.updates).toEqual([]);
  });

  it('refuses to reopen a lead that converted or was lost', async () => {
    store.lead = { ...newLead, status: 'CONVERTED' };
    await expect(move({ to: 'LOST' })).rejects.toMatchObject({ code: 'CONFLICT' });

    store.lead = { ...newLead, status: 'LOST' };
    await expect(move({ to: 'CONTACTED' })).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('refuses a trainer and an enquiry from another gym', async () => {
    await expect(move({}, trainer)).rejects.toMatchObject({ code: 'FORBIDDEN' });

    store.lead = null;
    await expect(move()).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('closes the enquiry’s open "new lead" call once someone has dealt with it (BR-7 auto-close)', async () => {
    await move({ note: 'फोन किया' });
    expect(store.closedTasks).toEqual([{ leadId: 'lead_1', closedAt: clock.now(), doneById: 'staff_2' }]);
  });

  it('closes it however the enquiry moves, including straight to lost', async () => {
    await move({ to: 'LOST' });
    expect(store.closedTasks).toHaveLength(1);
  });

  it('closes nothing when the move itself is refused', async () => {
    store.lead = { ...newLead, status: 'VISITED' };
    await expect(move({ to: 'CONTACTED' })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(store.closedTasks).toEqual([]);
  });

  it('can mark a lead lost from anywhere in the pipeline', async () => {
    store.lead = { ...newLead, status: 'TRIAL_BOOKED' };
    await expect(move({ to: 'LOST', note: 'दूर पड़ता है' })).resolves.toMatchObject({ status: 'LOST' });
  });
});
