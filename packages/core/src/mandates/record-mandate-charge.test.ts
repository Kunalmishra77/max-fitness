import { beforeEach, describe, expect, it } from 'vitest';
import { istDate, type ISTDate } from '@mfp/shared';
import { fakeClockAt } from '../testing/builders';
import type { OutboxEventInput } from '../ports/outbox';
import {
  recordMandateCharge,
  type MandateChargeStore,
  type MandateChargeUnitOfWork,
  type MandateForCharge,
  type MandateChargedUpdate,
  type MandateMembershipInput,
  type MandatePaymentInput,
  type MandateAlertRecord,
} from './record-mandate-charge';

const clock = fakeClockAt('2026-11-01T06:30');

const LIVE_MANDATE: MandateForCharge = {
  id: 'mandate_1',
  gymId: 'gym_1',
  memberId: 'mem_1',
  planId: 'plan_m1_male',
  amountPaise: 150_000,
  intervalMonths: 1,
  status: 'ACTIVE',
};

interface Recorded {
  readonly memberships: MandateMembershipInput[];
  readonly payments: MandatePaymentInput[];
  readonly charged: Array<{ mandateId: string; update: MandateChargedUpdate }>;
  readonly alerts: MandateAlertRecord[];
  readonly outbox: OutboxEventInput[];
  readonly activated: string[];
  readonly closedTasks: string[];
}

function harness(overrides: {
  mandate?: MandateForCharge | null;
  existingPayment?: { id: string; receiptNo: string | null } | null;
  coveredUntil?: ISTDate | null;
  memberCode?: string | null;
  renewalGraceDays?: number;
} = {}) {
  const recorded: Recorded = { memberships: [], payments: [], charged: [], alerts: [], outbox: [], activated: [], closedTasks: [] };
  let counter = 41;

  const store: MandateChargeStore = {
    lockMandateBySubscriptionId: () => Promise.resolve(overrides.mandate === undefined ? LIVE_MANDATE : overrides.mandate),
    findPaymentByProviderPaymentId: () => Promise.resolve(overrides.existingPayment ?? null),
    gymSettings: () => Promise.resolve({ renewalGraceDays: overrides.renewalGraceDays ?? 5 }),
    nextCounterValue: () => Promise.resolve((counter += 1)),
    latestMembershipEndDate: () => Promise.resolve(overrides.coveredUntil === undefined ? istDate('2026-10-31') : overrides.coveredUntil),
    createMembership: (input) => {
      recorded.memberships.push(input);
      return Promise.resolve({ id: 'membership_new' });
    },
    createMandatePayment: (input) => {
      recorded.payments.push(input);
      return Promise.resolve({ id: 'payment_new' });
    },
    markMandateCharged: (mandateId, update) => {
      recorded.charged.push({ mandateId, update });
      return Promise.resolve();
    },
    getMember: () => Promise.resolve({ id: 'mem_1', memberCode: overrides.memberCode === undefined ? 'MF-0007' : overrides.memberCode }),
    activateMember: (memberId) => {
      recorded.activated.push(memberId);
      return Promise.resolve();
    },
    closeOpenCallTasks: (memberId) => {
      recorded.closedTasks.push(memberId);
      return Promise.resolve();
    },
    createAlert: (alert) => {
      recorded.alerts.push(alert);
      return Promise.resolve();
    },
    enqueueOutbox: (event) => {
      recorded.outbox.push(event);
      return Promise.resolve();
    },
  };

  const uow: MandateChargeUnitOfWork = { transaction: (work) => work(store) };
  return { recorded, uow };
}

const CHARGE = {
  providerSubscriptionId: 'sub_P1aBcD2eFgH3iJ',
  providerPaymentId: 'pay_P1aBcD2eFgH3iJ',
  paidAmountPaise: 150_000,
  nextChargeAt: new Date('2026-12-01T00:00:00.000Z'),
} as const;

describe('recordMandateCharge', () => {
  let h: ReturnType<typeof harness>;

  beforeEach(() => {
    h = harness();
  });

  it('turns an autopay debit into a paid membership that chains on from the old one', async () => {
    const result = await recordMandateCharge(CHARGE, { clock, uow: h.uow });

    expect(result.outcome).toBe('RENEWED');
    // The old cover ran to 31 October and the debit landed on 1 November: the new term starts
    // the day the old one ended, so the member's renewal date never drifts.
    expect(h.recorded.memberships[0]).toMatchObject({
      memberId: 'mem_1',
      planId: 'plan_m1_male',
      startDate: '2026-11-01',
      endDate: '2026-11-30',
      durationMonths: 1,
      pricePaise: 150_000,
      status: 'CONFIRMED',
    });
  });

  it('records the payment against the mandate, with a receipt number from the gym counter', async () => {
    await recordMandateCharge(CHARGE, { clock, uow: h.uow });

    expect(h.recorded.payments[0]).toMatchObject({
      mandateId: 'mandate_1',
      memberId: 'mem_1',
      membershipId: 'membership_new',
      amountPaise: 150_000,
      method: 'RAZORPAY',
      status: 'PAID',
      providerPaymentId: 'pay_P1aBcD2eFgH3iJ',
      // The webhook HMAC was verified over the raw bytes before this ran. It is the only
      // signature an autopay debit has, and it is a stronger one than a checkout's.
      providerSignatureOk: true,
    });
    expect(h.recorded.payments[0]?.receiptNo).toMatch(/^MF\/2026-27\/\d{6}$/);
  });

  it('sends the member their receipt, the same two jobs a counter payment raises', async () => {
    await recordMandateCharge(CHARGE, { clock, uow: h.uow });

    expect(h.recorded.outbox.map((event) => event.type)).toEqual(['whatsapp.receipt', 'receipt.pdf']);
    // Keyed on the payment, so a re-delivered webhook cannot send a second receipt.
    expect(h.recorded.outbox[0]?.dedupeKey).toBe('receipt:payment_new');
  });

  it("advances the mandate's own record, so the CRM can say when the next debit is due", async () => {
    await recordMandateCharge(CHARGE, { clock, uow: h.uow });

    expect(h.recorded.charged[0]).toEqual({
      mandateId: 'mandate_1',
      update: {
        status: 'ACTIVE',
        lastChargedAt: clock.now(),
        // 2026-12-01T00:00Z is 05:30 on the 1st in Kolkata, so the business date is the 1st.
        nextChargeOn: '2026-12-01',
        incrementChargeCount: true,
        clearFailureReason: true,
      },
    });
  });

  it('closes the follow-up calls that no longer make sense, and tells the desk', async () => {
    await recordMandateCharge(CHARGE, { clock, uow: h.uow });

    expect(h.recorded.closedTasks).toEqual(['mem_1']);
    expect(h.recorded.alerts[0]).toMatchObject({ gymId: 'gym_1', type: 'ONLINE_PAYMENT', memberId: 'mem_1', title: 'crm.alerts.autopayCharged' });
  });

  it('is a no-op the second time the same debit arrives', async () => {
    const already = harness({ existingPayment: { id: 'payment_old', receiptNo: 'MF/2026-27/000012' } });

    const result = await recordMandateCharge(CHARGE, { clock, uow: already.uow });

    expect(result).toEqual({ outcome: 'ALREADY_RECORDED', paymentId: 'payment_old', receiptNo: 'MF/2026-27/000012' });
    expect(already.recorded.memberships).toHaveLength(0);
    expect(already.recorded.payments).toHaveLength(0);
    expect(already.recorded.outbox).toHaveLength(0);
  });

  it('ignores a subscription this gym never created', async () => {
    // Another integration on the same Razorpay account is not an error worth retrying.
    const unknown = harness({ mandate: null });

    const result = await recordMandateCharge(CHARGE, { clock, uow: unknown.uow });

    expect(result).toEqual({ outcome: 'UNKNOWN_MANDATE' });
    expect(unknown.recorded.payments).toHaveLength(0);
  });

  it('restarts the term from the debit when the member had lapsed beyond the grace window', async () => {
    const lapsed = harness({ coveredUntil: istDate('2026-08-31') });

    await recordMandateCharge(CHARGE, { clock, uow: lapsed.uow });

    expect(lapsed.recorded.memberships[0]).toMatchObject({ startDate: '2026-11-01', endDate: '2026-11-30' });
  });

  it('gives a member with no code yet one, and makes them active', async () => {
    const fresh = harness({ memberCode: null, coveredUntil: null });

    const result = await recordMandateCharge(CHARGE, { clock, uow: fresh.uow });

    expect(fresh.recorded.activated).toEqual(['mem_1']);
    if (result.outcome !== 'RENEWED') throw new Error(`expected a renewal, got ${result.outcome}`);
    expect(result.memberCode).toMatch(/^MF-\d{4}$/);
  });

  it('still records money that arrived on an amount we did not expect, and raises it', async () => {
    // A subscription charge comes from a plan we created, so there is no member-controlled
    // input to tamper with. Refusing to extend would punish a member who has been debited;
    // the alert is what gets it looked at.
    await recordMandateCharge({ ...CHARGE, paidAmountPaise: 120_000 }, { clock, uow: h.uow });

    expect(h.recorded.payments[0]).toMatchObject({ amountPaise: 120_000 });
    expect(h.recorded.memberships[0]).toMatchObject({ pricePaise: 120_000 });
    expect(h.recorded.alerts.map((a) => a.title)).toContain('crm.alerts.autopayAmountUnexpected');
  });

  it('records a debit on a mandate the desk had cancelled, and raises that too', async () => {
    const cancelled = harness({ mandate: { ...LIVE_MANDATE, status: 'CANCELLED' } });

    const result = await recordMandateCharge(CHARGE, { clock, uow: cancelled.uow });

    expect(result.outcome).toBe('RENEWED');
    expect(cancelled.recorded.payments).toHaveLength(1);
    expect(cancelled.recorded.alerts.map((a) => a.title)).toContain('crm.alerts.autopayAfterCancel');
  });

  it('leaves the next charge date alone when the event did not carry one', async () => {
    await recordMandateCharge({ ...CHARGE, nextChargeAt: null }, { clock, uow: h.uow });

    expect(h.recorded.charged[0]?.update.nextChargeOn).toBeNull();
  });
});
