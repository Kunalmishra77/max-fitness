import { beforeEach, describe, expect, it } from 'vitest';
import { fakeClockAt } from '../testing/builders';
import type { OutboxEventInput } from '../ports/outbox';
import type { MandateAlertRecord } from './record-mandate-charge';
import {
  updateMandateStatus,
  type MandateStatusStore,
  type MandateStatusUnitOfWork,
  type MandateForStatus,
  type MandateStatusPatch,
} from './update-mandate-status';

const clock = fakeClockAt('2026-11-02T04:30');

const CREATED_MANDATE: MandateForStatus = {
  id: 'mandate_1',
  gymId: 'gym_1',
  memberId: 'mem_1',
  status: 'CREATED',
  authorisedAt: null,
};

interface Recorded {
  readonly patches: Array<{ mandateId: string; patch: MandateStatusPatch }>;
  readonly alerts: MandateAlertRecord[];
  readonly outbox: OutboxEventInput[];
  readonly callTasks: Array<{ memberId: string; reason: string }>;
}

function harness(mandate: MandateForStatus | null = CREATED_MANDATE) {
  const recorded: Recorded = { patches: [], alerts: [], outbox: [], callTasks: [] };
  const store: MandateStatusStore = {
    lockMandateBySubscriptionId: () => Promise.resolve(mandate),
    patchMandate: (mandateId, patch) => {
      recorded.patches.push({ mandateId, patch });
      return Promise.resolve();
    },
    createAlert: (alert) => {
      recorded.alerts.push(alert);
      return Promise.resolve();
    },
    openCallTask: (memberId, reason) => {
      recorded.callTasks.push({ memberId, reason });
      return Promise.resolve();
    },
    enqueueOutbox: (event) => {
      recorded.outbox.push(event);
      return Promise.resolve();
    },
  };
  const uow: MandateStatusUnitOfWork = { transaction: (work) => work(store) };
  return { recorded, uow };
}

describe('updateMandateStatus', () => {
  let h: ReturnType<typeof harness>;

  beforeEach(() => {
    h = harness();
  });

  it('records the moment a member authorises, which is when the gym may stop chasing them', async () => {
    const result = await updateMandateStatus(
      { providerSubscriptionId: 'sub_1', status: 'ACTIVE', nextChargeAt: new Date('2026-12-01T00:00:00.000Z'), failureReason: null },
      { clock, uow: h.uow },
    );

    expect(result.outcome).toBe('UPDATED');
    expect(h.recorded.patches[0]?.patch).toMatchObject({
      status: 'ACTIVE',
      authorisedAt: clock.now(),
      nextChargeOn: '2026-12-01',
    });
  });

  it('does not move an authorisation timestamp that is already set', async () => {
    const authorised = harness({ ...CREATED_MANDATE, status: 'ACTIVE', authorisedAt: new Date('2026-10-01T06:00:00.000Z') });

    await updateMandateStatus({ providerSubscriptionId: 'sub_1', status: 'ACTIVE', nextChargeAt: null, failureReason: null }, { clock, uow: authorised.uow });

    expect(authorised.recorded.patches[0]?.patch.authorisedAt).toBeUndefined();
  });

  describe('when Razorpay halts the mandate', () => {
    const halted = {
      providerSubscriptionId: 'sub_1',
      status: 'HALTED',
      nextChargeAt: null,
      failureReason: 'insufficient funds',
    } as const;

    beforeEach(async () => {
      h = harness({ ...CREATED_MANDATE, status: 'ACTIVE', authorisedAt: new Date('2026-10-01T06:00:00.000Z') });
      await updateMandateStatus(halted, { clock, uow: h.uow });
    });

    it('stamps when it halted and why', () => {
      expect(h.recorded.patches[0]?.patch).toMatchObject({ status: 'HALTED', haltedAt: clock.now(), failureReason: 'insufficient funds' });
    });

    it('tells the owner, because nothing else about the member looks wrong', () => {
      expect(h.recorded.alerts[0]).toMatchObject({ gymId: 'gym_1', type: 'SYSTEM', memberId: 'mem_1', title: 'crm.alerts.autopayHalted' });
    });

    it('asks the member to set it up again', () => {
      expect(h.recorded.outbox[0]).toMatchObject({ type: 'whatsapp.mandate_halted', gymId: 'gym_1' });
      // Keyed on the mandate, so Razorpay re-delivering the event does not message twice.
      expect(h.recorded.outbox[0]?.dedupeKey).toBe('mandate-halted:mandate_1');
    });

    it('puts the member on the call list, because a message may not be read', () => {
      expect(h.recorded.callTasks).toEqual([{ memberId: 'mem_1', reason: 'DUE_SOON_NO_RESPONSE' }]);
    });
  });

  it('does not raise the halt twice when Razorpay re-delivers the event', async () => {
    const alreadyHalted = harness({ ...CREATED_MANDATE, status: 'HALTED', authorisedAt: new Date('2026-10-01T06:00:00.000Z') });

    const result = await updateMandateStatus(
      { providerSubscriptionId: 'sub_1', status: 'HALTED', nextChargeAt: null, failureReason: 'insufficient funds' },
      { clock, uow: alreadyHalted.uow },
    );

    expect(result.outcome).toBe('UNCHANGED');
    expect(alreadyHalted.recorded.alerts).toHaveLength(0);
    expect(alreadyHalted.recorded.outbox).toHaveLength(0);
    expect(alreadyHalted.recorded.callTasks).toHaveLength(0);
  });

  it('stamps a cancellation and tells the member it has stopped', async () => {
    const active = harness({ ...CREATED_MANDATE, status: 'ACTIVE', authorisedAt: new Date('2026-10-01T06:00:00.000Z') });

    await updateMandateStatus({ providerSubscriptionId: 'sub_1', status: 'CANCELLED', nextChargeAt: null, failureReason: null }, { clock, uow: active.uow });

    expect(active.recorded.patches[0]?.patch).toMatchObject({ status: 'CANCELLED', cancelledAt: clock.now() });
    expect(active.recorded.outbox[0]).toMatchObject({ type: 'whatsapp.mandate_cancelled' });
    // Cancelling is a normal thing a member may do from their own UPI app. It is not an alert.
    expect(active.recorded.alerts).toHaveLength(0);
  });

  it('ignores a subscription this gym never created', async () => {
    const unknown = harness(null);

    const result = await updateMandateStatus({ providerSubscriptionId: 'sub_1', status: 'ACTIVE', nextChargeAt: null, failureReason: null }, { clock, uow: unknown.uow });

    expect(result).toEqual({ outcome: 'UNKNOWN_MANDATE' });
    expect(unknown.recorded.patches).toHaveLength(0);
  });

  it('never walks a mandate backwards out of a settled state', async () => {
    // Razorpay can deliver events out of order. A `subscription.pending` arriving after the
    // member cancelled must not make the mandate look live again — the reminder engine reads
    // this status to decide whether to chase them (ADR-105 §5).
    const cancelled = harness({ ...CREATED_MANDATE, status: 'CANCELLED', authorisedAt: new Date('2026-10-01T06:00:00.000Z') });

    const result = await updateMandateStatus({ providerSubscriptionId: 'sub_1', status: 'PENDING', nextChargeAt: null, failureReason: null }, { clock, uow: cancelled.uow });

    expect(result.outcome).toBe('UNCHANGED');
    expect(cancelled.recorded.patches).toHaveLength(0);
  });
});
