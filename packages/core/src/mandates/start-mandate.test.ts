import { beforeEach, describe, expect, it } from 'vitest';
import { istDate, type ISTDate } from '@mfp/shared';
import { DomainError } from '../errors';
import { fakeClockAt } from '../testing/builders';
import type { CreateSubscriptionRequest, FetchedSubscription, SubscriptionProvider } from '../ports/payments';
import type { OutboxEventInput } from '../ports/outbox';
import {
  startMandate,
  type MandateCandidate,
  type NewMandateRecord,
  type StartMandateStore,
  type StartMandateUnitOfWork,
} from './start-mandate';

const clock = fakeClockAt('2026-10-05T11:00');

const CANDIDATE: MandateCandidate = {
  memberId: 'mem_1',
  gymId: 'gym_1',
  planId: 'plan_m1_male',
  planCode: 'M1_MALE',
  pricePaise: 150_000,
  durationMonths: 1,
  providerPlanId: 'plan_Tk7PauN2oiSMXh',
  coveredUntil: istDate('2026-10-31'),
  liveMandate: null,
};

function harness(
  overrides: { candidate?: MandateCandidate | null; subscription?: Partial<FetchedSubscription> } = {},
) {
  const requests: CreateSubscriptionRequest[] = [];
  const saved: NewMandateRecord[] = [];
  const outbox: OutboxEventInput[] = [];

  const provider: SubscriptionProvider = {
    name: 'razorpay',
    createPlan: () => Promise.reject(new Error('not used here')),
    createSubscription: (request) => {
      requests.push(request);
      return Promise.resolve({
        providerSubscriptionId: 'sub_P1aBcD2eFgH3iJ',
        status: 'created',
        shortUrl: 'https://rzp.io/i/aBcD2eFg',
        chargeAt: new Date('2026-11-01T00:00:00.000Z'),
        ...overrides.subscription,
      });
    },
    fetchSubscription: () => Promise.reject(new Error('not used here')),
    cancelSubscription: () => Promise.reject(new Error('not used here')),
  };

  const store: StartMandateStore = {
    findCandidate: () => Promise.resolve(overrides.candidate === undefined ? CANDIDATE : overrides.candidate),
    createMandate: (record) => {
      saved.push(record);
      return Promise.resolve({ id: 'mandate_new' });
    },
    enqueueOutbox: (event) => {
      outbox.push(event);
      return Promise.resolve();
    },
  };

  const uow: StartMandateUnitOfWork = { transaction: (work) => work(store) };
  return { requests, saved, outbox, provider, uow };
}

describe('startMandate', () => {
  let h: ReturnType<typeof harness>;

  beforeEach(() => {
    h = harness();
  });

  it("asks Razorpay for a subscription on the member's own plan, starting after their cover ends", async () => {
    const result = await startMandate({ memberId: 'mem_1', gymId: 'gym_1' }, { clock, provider: h.provider, uow: h.uow });

    expect(result.outcome).toBe('CREATED');
    expect(h.requests[0]).toMatchObject({
      providerPlanId: 'plan_Tk7PauN2oiSMXh',
      // One month, so a hundred cycles — as many as Razorpay accepts.
      totalCount: 100,
      notes: { memberId: 'mem_1', planCode: 'M1_MALE' },
    });
    // Cover runs to 31 October, so the first debit is 1 November at the start of the IST day.
    expect(h.requests[0]?.startAt?.toISOString()).toBe('2026-10-31T18:30:00.000Z');
  });

  it('stores the mandate with the amount and cycle frozen, and the link to authorise on', async () => {
    await startMandate({ memberId: 'mem_1', gymId: 'gym_1' }, { clock, provider: h.provider, uow: h.uow });

    expect(h.saved[0]).toEqual({
      gymId: 'gym_1',
      memberId: 'mem_1',
      planId: 'plan_m1_male',
      providerSubscriptionId: 'sub_P1aBcD2eFgH3iJ',
      providerPlanId: 'plan_Tk7PauN2oiSMXh',
      status: 'CREATED',
      amountPaise: 150_000,
      intervalMonths: 1,
      shortUrl: 'https://rzp.io/i/aBcD2eFg',
      nextChargeOn: '2026-11-01',
    });
  });

  it('sends the member the link, so they do not have to be at the desk to authorise', async () => {
    await startMandate({ memberId: 'mem_1', gymId: 'gym_1' }, { clock, provider: h.provider, uow: h.uow });

    expect(h.outbox[0]).toMatchObject({ type: 'whatsapp.mandate_invite', gymId: 'gym_1' });
    expect(h.outbox[0]?.dedupeKey).toBe('mandate-invite:mandate_new');
  });

  it('can be told to skip the message, for a member standing at the desk with the QR on screen', async () => {
    await startMandate({ memberId: 'mem_1', gymId: 'gym_1', notify: false }, { clock, provider: h.provider, uow: h.uow });

    expect(h.outbox).toHaveLength(0);
  });

  it('gives back the mandate the member already has rather than making a second one', async () => {
    // Two live mandates would debit twice. The one they hold is the answer to "set up autopay".
    const existing = harness({
      candidate: { ...CANDIDATE, liveMandate: { id: 'mandate_old', status: 'ACTIVE', shortUrl: null, nextChargeOn: istDate('2026-11-01') } },
    });

    const result = await startMandate({ memberId: 'mem_1', gymId: 'gym_1' }, { clock, provider: existing.provider, uow: existing.uow });

    expect(result).toMatchObject({ outcome: 'ALREADY_LIVE', mandateId: 'mandate_old', status: 'ACTIVE' });
    expect(existing.requests).toHaveLength(0);
    expect(existing.saved).toHaveLength(0);
  });

  it('returns the unused link when the member was already sent one and never opened it', async () => {
    const pending = harness({
      candidate: { ...CANDIDATE, liveMandate: { id: 'mandate_old', status: 'CREATED', shortUrl: 'https://rzp.io/i/old', nextChargeOn: null } },
    });

    const result = await startMandate({ memberId: 'mem_1', gymId: 'gym_1' }, { clock, provider: pending.provider, uow: pending.uow });

    expect(result).toMatchObject({ outcome: 'ALREADY_LIVE', mandateId: 'mandate_old', shortUrl: 'https://rzp.io/i/old' });
    expect(pending.requests).toHaveLength(0);
  });

  it('refuses a member whose plan has no Razorpay plan behind it', async () => {
    const unmapped = harness({ candidate: { ...CANDIDATE, providerPlanId: null } });

    await expect(startMandate({ memberId: 'mem_1', gymId: 'gym_1' }, { clock, provider: unmapped.provider, uow: unmapped.uow })).rejects.toThrow(
      DomainError,
    );
    expect(unmapped.saved).toHaveLength(0);
  });

  it('refuses a member the gym does not have', async () => {
    const missing = harness({ candidate: null });

    await expect(startMandate({ memberId: 'mem_x', gymId: 'gym_1' }, { clock, provider: missing.provider, uow: missing.uow })).rejects.toThrow(
      DomainError,
    );
  });

  it('starts a trial member the day after the trial ends, which is what autopay is for', async () => {
    const trial = harness({ candidate: { ...CANDIDATE, coveredUntil: istDate('2026-10-08') } });

    await startMandate({ memberId: 'mem_1', gymId: 'gym_1' }, { clock, provider: trial.provider, uow: trial.uow });

    // 9 October at the start of the IST day.
    expect(trial.requests[0]?.startAt?.toISOString()).toBe('2026-10-08T18:30:00.000Z');
  });

  it('starts tomorrow for a member holding no cover at all', async () => {
    const uncovered = harness({ candidate: { ...CANDIDATE, coveredUntil: null } });

    await startMandate({ memberId: 'mem_1', gymId: 'gym_1' }, { clock, provider: uncovered.provider, uow: uncovered.uow });

    expect(uncovered.requests[0]?.startAt?.toISOString()).toBe('2026-10-05T18:30:00.000Z');
  });

  it('can be pointed at a plan other than the one the member is on, for an upgrade', async () => {
    const chosen: { planId: string; providerPlanId: string; pricePaise: number; durationMonths: number; planCode: string } = {
      planId: 'plan_m3_male',
      providerPlanId: 'plan_Tk7W7vptMR6eMv',
      pricePaise: 400_000,
      durationMonths: 3,
      planCode: 'M3_MALE',
    };
    const upgrade = harness({ candidate: { ...CANDIDATE, ...chosen } });

    await startMandate({ memberId: 'mem_1', gymId: 'gym_1', planId: 'plan_m3_male' }, { clock, provider: upgrade.provider, uow: upgrade.uow });

    // Three months, so forty cycles — about ten years, the same span as every other term.
    expect(upgrade.requests[0]).toMatchObject({ providerPlanId: 'plan_Tk7W7vptMR6eMv', totalCount: 40 });
    expect(upgrade.saved[0]).toMatchObject({ amountPaise: 400_000, intervalMonths: 3 });
  });
});

/** Kept honest: the candidate shape is what the repository must produce. */
export type { MandateCandidate, ISTDate };
