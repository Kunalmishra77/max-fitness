import { beforeEach, describe, expect, it } from 'vitest';
import { istDate, type E164Mobile } from '@mfp/shared';
import { DomainError } from '../errors';
import type { Plan } from '../pricing/plans';
import { buildPlan, fakeClockAt } from '../testing/builders';
import { FakePaymentProvider } from '../testing/payments';
import type { CheckoutSettings } from './checkout.rules';
import {
  createCheckoutOrder,
  type CheckoutDeps,
  type CheckoutStore,
  type MemberForCheckout,
  type NewPaymentRecord,
  type PendingMembershipRecord,
  type ReusableMembershipQuery,
} from './checkout.service';

class FakeCheckoutStore implements CheckoutStore {
  member: MemberForCheckout | null = null;
  plans: Plan[] = [];
  readonly memberships: Array<PendingMembershipRecord & { id: string; createdAt: Date }> = [];
  readonly payments: Array<NewPaymentRecord & { id: string; providerOrderId: string | null }> = [];
  createdAt = new Date('2026-09-11T04:30:00Z');

  getMemberForCheckout(memberId: string) {
    return Promise.resolve(this.member?.id === memberId ? this.member : null);
  }
  getPlans() {
    return Promise.resolve(this.plans);
  }
  findReusablePendingMembership(query: ReusableMembershipQuery) {
    const found = this.memberships.find(
      (m) =>
        m.memberId === query.memberId &&
        m.planId === query.planId &&
        m.startDate === query.startDate &&
        m.pricePaise === query.pricePaise &&
        m.admissionPaise === query.admissionPaise &&
        m.createdAt > query.createdAfter,
    );
    return Promise.resolve(found === undefined ? null : { id: found.id, createdAt: found.createdAt });
  }
  createPendingMembership(record: PendingMembershipRecord) {
    const created = { ...record, id: `ms_${this.memberships.length + 1}`, createdAt: this.createdAt };
    this.memberships.push(created);
    return Promise.resolve({ id: created.id, createdAt: created.createdAt });
  }
  createPayment(record: NewPaymentRecord) {
    const id = `pay_${this.payments.length + 1}`;
    this.payments.push({ ...record, id, providerOrderId: null });
    return Promise.resolve(id);
  }
  setProviderOrderId(paymentId: string, providerOrderId: string) {
    this.payments.find((p) => p.id === paymentId)!.providerOrderId = providerOrderId;
    return Promise.resolve();
  }
}

const settings: CheckoutSettings = {
  pricing: { admissionFeePaise: 0, otherGenderPricing: 'ASK_AT_DESK', allowDeskDiscounts: true },
  maxStartDateDaysAhead: 15,
  renewalGraceDays: 5,
};

const maleQuarter = buildPlan({ durationMonths: 3, gender: 'MALE', pricePaise: 400_000 });
const femaleMonthly = buildPlan({ durationMonths: 1, gender: 'FEMALE', pricePaise: 120_000 });

const pendingMember: MemberForCheckout = {
  id: 'mem_1',
  gymId: 'gym_1',
  status: 'PENDING_PAYMENT',
  gender: 'MALE',
  fullName: 'Rohit Sharma',
  mobile: '+919876543210' as E164Mobile,
  email: 'rohit@example.com',
  hasConfirmedMembership: false,
  latestConfirmedEndDate: null,
};

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    return error instanceof DomainError ? error.code : 'not a DomainError';
  }
  return undefined;
}

describe('createCheckoutOrder', () => {
  let store: FakeCheckoutStore;
  let provider: FakePaymentProvider;
  let deps: CheckoutDeps;

  beforeEach(() => {
    store = new FakeCheckoutStore();
    store.member = pendingMember;
    store.plans = [maleQuarter, femaleMonthly];
    provider = new FakePaymentProvider('razorpay');
    deps = { clock: fakeClockAt('2026-09-11T10:00'), uow: { transaction: (work) => work(store) }, provider, settings };
  });

  const signup = (overrides: Partial<Parameters<typeof createCheckoutOrder>[0]> = {}) =>
    createCheckoutOrder(
      { memberId: 'mem_1', planId: maleQuarter.id, startDate: istDate('2026-09-11'), payAtReception: false, mode: 'signup', ...overrides },
      deps,
    );

  it('creates a pending membership, a payment and a provider order priced on the server', async () => {
    const result = await signup();

    expect(store.memberships).toEqual([
      expect.objectContaining({
        gymId: 'gym_1',
        memberId: 'mem_1',
        planId: maleQuarter.id,
        durationMonths: 3,
        startDate: '2026-09-11',
        endDate: '2026-12-10',
        pricePaise: 400_000,
        admissionPaise: 0,
        source: 'WEBSITE',
      }),
    ]);
    expect(store.payments).toEqual([
      { id: 'pay_1', gymId: 'gym_1', memberId: 'mem_1', membershipId: 'ms_1', amountPaise: 400_000, method: 'RAZORPAY', providerOrderId: 'order_1' },
    ]);
    expect(provider.orders).toEqual([
      { amountPaise: 400_000, currency: 'INR', receipt: 'pay_1', notes: { memberId: 'mem_1', membershipId: 'ms_1' } },
    ]);
    expect(result).toEqual({
      kind: 'ONLINE',
      paymentId: 'pay_1',
      provider: 'razorpay',
      providerOrderId: 'order_1',
      publicKeyId: 'rzp_test_key',
      amountPaise: 400_000,
      membership: { id: 'ms_1', startDate: '2026-09-11', endDate: '2026-12-10' },
      prefill: { name: 'Rohit Sharma', contact: '+919876543210', email: 'rohit@example.com' },
    });
  });

  it('records a simulated payment when the demo provider is in use', async () => {
    deps = { ...deps, provider: new FakePaymentProvider('simulated') };
    const result = await signup();
    expect(store.payments[0]!.method).toBe('SIMULATED');
    expect(result).toMatchObject({ kind: 'ONLINE', provider: 'simulated' });
  });

  it('reserves the plan for 48 hours when paying at reception, without a payment or an order', async () => {
    const result = await signup({ payAtReception: true });

    expect(result).toEqual({
      kind: 'PAY_AT_RECEPTION',
      amountPaise: 400_000,
      reservedUntil: new Date('2026-09-13T04:30:00Z'),
      membership: { id: 'ms_1', startDate: '2026-09-11', endDate: '2026-12-10' },
    });
    expect(store.payments).toHaveLength(0);
    expect(provider.orders).toHaveLength(0);
  });

  it('reuses the pending membership when the same order is retried', async () => {
    await signup();
    await signup();
    expect(store.memberships).toHaveLength(1);
    expect(store.payments).toHaveLength(2);
  });

  it('does not reuse a pending membership priced before the owner changed the fee (BR-2.8)', async () => {
    await signup();
    store.plans = [{ ...maleQuarter, pricePaise: 450_000 }, femaleMonthly];

    const result = await signup();

    expect(store.memberships.map((m) => m.pricePaise)).toEqual([400_000, 450_000]);
    expect(result).toMatchObject({ amountPaise: 450_000, membership: { id: 'ms_2' } });
  });

  it('does not reuse a reservation whose 48-hour hold has run out', async () => {
    store.createdAt = new Date('2026-09-09T04:00:00Z');
    await signup({ payAtReception: true });
    store.createdAt = new Date('2026-09-11T04:30:00Z');

    const result = await signup({ payAtReception: true });

    expect(store.memberships).toHaveLength(2);
    expect(result).toMatchObject({ reservedUntil: new Date('2026-09-13T04:30:00Z') });
  });

  it('adds the admission fee only to a first membership (BR-2.6)', async () => {
    deps = { ...deps, settings: { ...settings, pricing: { ...settings.pricing, admissionFeePaise: 50_000 } } };
    expect((await signup()).amountPaise).toBe(450_000);

    store.member = { ...pendingMember, hasConfirmedMembership: true };
    expect((await signup({ startDate: istDate('2026-09-12') })).amountPaise).toBe(400_000);
  });

  it('starts a renewal from the old end date within the grace period (case P6)', async () => {
    store.member = { ...pendingMember, status: 'ACTIVE', hasConfirmedMembership: true, latestConfirmedEndDate: istDate('2026-09-08') };

    const result = await createCheckoutOrder(
      { memberId: 'mem_1', planId: maleQuarter.id, startDate: null, payAtReception: false, mode: 'renewal' },
      deps,
    );

    expect(result).toMatchObject({ membership: { startDate: '2026-09-09', endDate: '2026-12-08' } });
  });

  it('refuses a sign-up order for a member who is already active', async () => {
    store.member = { ...pendingMember, status: 'ACTIVE' };
    expect(await codeOf(signup())).toBe('CONFLICT');
  });

  it('refuses a renewal for a blocked member', async () => {
    store.member = { ...pendingMember, status: 'BLOCKED' };
    expect(
      await codeOf(
        createCheckoutOrder({ memberId: 'mem_1', planId: maleQuarter.id, startDate: null, payAtReception: false, mode: 'renewal' }, deps),
      ),
    ).toBe('MEMBER_BLOCKED');
  });

  it('refuses a renewal for someone who never completed sign-up', async () => {
    expect(
      await codeOf(
        createCheckoutOrder({ memberId: 'mem_1', planId: maleQuarter.id, startDate: null, payAtReception: false, mode: 'renewal' }, deps),
      ),
    ).toBe('CONFLICT');
  });

  it('lets a member who left pay again (BR-4.4)', async () => {
    store.member = { ...pendingMember, status: 'LEFT', hasConfirmedMembership: true, latestConfirmedEndDate: istDate('2026-06-30') };
    const result = await createCheckoutOrder(
      { memberId: 'mem_1', planId: maleQuarter.id, startDate: null, payAtReception: false, mode: 'renewal' },
      deps,
    );
    expect(result).toMatchObject({ kind: 'ONLINE', membership: { startDate: '2026-09-11' } });
  });

  it('refuses a provider order created for a different amount, and does not attach it', async () => {
    class ShortChangingProvider extends FakePaymentProvider {
      override async createOrder(request: Parameters<FakePaymentProvider['createOrder']>[0]) {
        const order = await super.createOrder(request);
        return { ...order, amountPaise: order.amountPaise - 100 };
      }
    }
    deps = { ...deps, provider: new ShortChangingProvider('razorpay') };

    expect(await codeOf(signup())).toBe('PRICE_MISMATCH');
    expect(store.payments[0]!.providerOrderId).toBeNull();
  });

  it('refuses an unknown member', async () => {
    expect(await codeOf(signup({ memberId: 'mem_unknown' }))).toBe('MEMBER_NOT_FOUND');
  });

  it('requires a start date for a sign-up', async () => {
    expect(await codeOf(signup({ startDate: null }))).toBe('VALIDATION_FAILED');
  });

  it("refuses a plan from the other gender's price list", async () => {
    expect(await codeOf(signup({ planId: femaleMonthly.id }))).toBe('PLAN_GENDER_MISMATCH');
  });
});
