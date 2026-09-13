import { beforeEach, describe, expect, it } from 'vitest';
import { istDate, type E164Mobile } from '@mfp/shared';
import type { CheckoutSettings } from '../checkout/checkout.rules';
import type { MemberForCheckout } from '../checkout/checkout.service';
import type { OutboxEventInput } from '../ports/outbox';
import { buildPlan, fakeClockAt } from '../testing/builders';
import { recordDeskPayment, type DeskMembershipRecord, type DeskPaymentRecord, type DeskPaymentStore } from './desk-payment';
import type { CrmActor } from './permissions';

const owner: CrmActor = { staffUserId: 'staff_1', gymId: 'gym_1', role: 'OWNER', elevatedUntil: null, receptionMayTakePayments: true };
const reception: CrmActor = { ...owner, staffUserId: 'staff_2', role: 'RECEPTION' };
const trainer: CrmActor = { ...owner, staffUserId: 'staff_3', role: 'TRAINER' };

const maleQuarter = buildPlan({ durationMonths: 3, gender: 'MALE', pricePaise: 400_000 });
const femaleMonthly = buildPlan({ durationMonths: 1, gender: 'FEMALE', pricePaise: 120_000 });

const activeMember: MemberForCheckout = {
  id: 'mem_1',
  gymId: 'gym_1',
  status: 'ACTIVE',
  gender: 'MALE',
  fullName: 'Rohit Sharma',
  mobile: '+919876543210' as E164Mobile,
  email: null,
  hasConfirmedMembership: true,
  latestConfirmedEndDate: istDate('2026-09-14'),
};

class FakeDeskStore implements DeskPaymentStore {
  member: MemberForCheckout | null = activeMember;
  memberCode: string | null = 'MF-0112';
  readonly counters = new Map<string, number>();
  readonly memberships: DeskMembershipRecord[] = [];
  readonly payments: DeskPaymentRecord[] = [];
  readonly activated: Array<{ memberId: string; memberCode: string }> = [];
  readonly closedTasks: string[] = [];
  readonly outbox: OutboxEventInput[] = [];

  getMemberForDesk(memberId: string) {
    return Promise.resolve(this.member?.id === memberId ? this.member : null);
  }
  getPlans() {
    return Promise.resolve([maleQuarter, femaleMonthly]);
  }
  nextCounterValue(gymId: string, key: string) {
    const next = (this.counters.get(`${gymId}:${key}`) ?? 0) + 1;
    this.counters.set(`${gymId}:${key}`, next);
    return Promise.resolve(next);
  }
  createConfirmedMembership(record: DeskMembershipRecord) {
    this.memberships.push(record);
    return Promise.resolve(`ms_${this.memberships.length}`);
  }
  createPaidPayment(record: DeskPaymentRecord) {
    this.payments.push(record);
    return Promise.resolve(`pay_${this.payments.length}`);
  }
  getMember() {
    return Promise.resolve({ id: 'mem_1', memberCode: this.memberCode });
  }
  activateMember(memberId: string, memberCode: string) {
    this.activated.push({ memberId, memberCode });
    return Promise.resolve();
  }
  closeOpenCallTasks(memberId: string) {
    this.closedTasks.push(memberId);
    return Promise.resolve();
  }
  enqueueOutbox(event: OutboxEventInput) {
    this.outbox.push(event);
    return Promise.resolve();
  }
}

const settings: CheckoutSettings = {
  pricing: { admissionFeePaise: 50_000, otherGenderPricing: 'ASK_AT_DESK', allowDeskDiscounts: true },
  maxStartDateDaysAhead: 15,
  renewalGraceDays: 5,
};

describe('recordDeskPayment', () => {
  let store: FakeDeskStore;
  const clock = fakeClockAt('2026-09-12T11:30');

  beforeEach(() => {
    store = new FakeDeskStore();
  });

  const record = (overrides: Partial<Parameters<typeof recordDeskPayment>[0]> = {}, actor: CrmActor = owner) =>
    recordDeskPayment(
      { memberId: 'mem_1', planId: maleQuarter.id, method: 'CASH', ...overrides },
      { actor, clock, uow: { transaction: (work) => work(store) }, settings },
    );

  it('takes the money, numbers the receipt and chains the renewal on (BR-3.4)', async () => {
    const result = await record();

    expect(result).toMatchObject({
      paymentId: 'pay_1',
      membershipId: 'ms_1',
      receiptNo: 'MF/2026-27/000001',
      memberCode: 'MF-0112',
      amountPaise: 400_000,
      startDate: '2026-09-15',
      endDate: '2026-12-14',
    });
    expect(store.memberships[0]).toMatchObject({
      gymId: 'gym_1',
      memberId: 'mem_1',
      planId: maleQuarter.id,
      durationMonths: 3,
      startDate: '2026-09-15',
      endDate: '2026-12-14',
      pricePaise: 400_000,
      // A renewal is never charged admission (BR-2.6), whatever the setting says.
      admissionPaise: 0,
      discountPaise: 0,
      source: 'CRM',
      createdById: 'staff_1',
    });
    expect(store.payments[0]).toMatchObject({
      gymId: 'gym_1',
      memberId: 'mem_1',
      membershipId: 'ms_1',
      amountPaise: 400_000,
      method: 'CASH',
      receiptNo: 'MF/2026-27/000001',
      paidAt: clock.now(),
      recordedById: 'staff_1',
    });
    expect(store.activated).toEqual([{ memberId: 'mem_1', memberCode: 'MF-0112' }]);
    expect(store.closedTasks).toEqual(['mem_1']);
  });

  it('queues the receipt and the PDF, and nothing that would alert the owner about their own entry', async () => {
    const result = await record();
    expect(store.outbox.map((e) => [e.type, e.dedupeKey])).toEqual([
      ['whatsapp.receipt', `receipt:${result.paymentId}`],
      ['receipt.pdf', `pdf:${result.paymentId}`],
      ['kiosk.enroll', 'enroll:mem_1'],
    ]);
  });

  it('charges admission and gives a member code to someone joining at the desk', async () => {
    store.member = { ...activeMember, status: 'PENDING_PAYMENT', hasConfirmedMembership: false, latestConfirmedEndDate: null };
    store.memberCode = null;

    const result = await record();

    expect(result).toMatchObject({ amountPaise: 450_000, startDate: '2026-09-12', memberCode: 'MF-0001' });
    expect(store.memberships[0]).toMatchObject({ admissionPaise: 50_000, startDate: '2026-09-12' });
  });

  it('applies a discount the owner allows, and records why', async () => {
    const result = await record({ discountPaise: 50_000, discountReason: 'Diwali offer' });

    expect(result.amountPaise).toBe(350_000);
    expect(store.memberships[0]).toMatchObject({ discountPaise: 50_000, discountReason: 'Diwali offer' });
    expect(store.payments[0]).toMatchObject({ amountPaise: 350_000 });
  });

  it('refuses a discount without a reason, larger than the fee, or when the gym has them switched off', async () => {
    await expect(record({ discountPaise: 50_000 })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(record({ discountPaise: 500_000, discountReason: 'too much' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

    const noDiscounts = { ...settings, pricing: { ...settings.pricing, allowDeskDiscounts: false } };
    await expect(
      recordDeskPayment(
        { memberId: 'mem_1', planId: maleQuarter.id, method: 'CASH', discountPaise: 10_000, discountReason: 'friend' },
        { actor: owner, clock, uow: { transaction: (work) => work(store) }, settings: noDiscounts },
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('lets reception take money only while the gym allows it, and never a trainer', async () => {
    await expect(record({}, reception)).resolves.toMatchObject({ receiptNo: expect.any(String) });
    await expect(record({}, { ...reception, receptionMayTakePayments: false })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(record({}, trainer)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('refuses an unknown member, a blocked one, or a plan from the other price list', async () => {
    await expect(record({ memberId: 'mem_x' })).rejects.toMatchObject({ code: 'MEMBER_NOT_FOUND' });
    await expect(record({ planId: femaleMonthly.id })).rejects.toMatchObject({ code: 'PLAN_GENDER_MISMATCH' });

    store.member = { ...activeMember, status: 'BLOCKED' };
    await expect(record()).rejects.toMatchObject({ code: 'MEMBER_BLOCKED' });
  });
});
