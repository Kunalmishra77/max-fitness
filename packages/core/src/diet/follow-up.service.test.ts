import { beforeEach, describe, expect, it } from 'vitest';
import { istDate } from '@mfp/shared';
import { fakeClockAt } from '../testing/builders';
import type { OutboxEventInput } from '../ports/outbox';
import { recordFollowUpReply, startDietFollowUps, type FollowUpStore, type PlanDueFollowUp } from './follow-up.service';

/**
 * Running the monthly check (ADR-089).
 *
 * The rules that matter: a plan is checked on once a month and not twice, a member who is not
 * reachable is left alone, and when the answers say the plan should change, **a new plan is
 * actually written** — with what they said about the old one, so the model has it.
 */

const clock = fakeClockAt('2026-11-02T13:00');

const due = (over: Partial<PlanDueFollowUp> = {}): PlanDueFollowUp => ({
  planId: 'plan_1',
  memberId: 'mem_1',
  gymId: 'gym_1',
  generatedAt: istDate('2026-10-02'),
  lastFollowUpOn: null,
  weightAtPlanGrams: 72_000,
  whatsappOptIn: true,
  remindersUnsubscribedAt: null,
  memberStatus: 'ACTIVE',
  ...over,
});

class FakeFollowUpStore implements FollowUpStore {
  plans: PlanDueFollowUp[] = [due()];
  followUps = new Map<string, { planId: string; memberId: string; answers: Record<string, unknown>; pendingQuestion: string | null; completedAt: Date | null }>();
  readonly outbox: OutboxEventInput[] = [];
  readonly profilePatches: Array<{ memberId: string; patch: Record<string, unknown> }> = [];

  plansDueFollowUp() {
    return Promise.resolve(this.plans);
  }
  openFollowUpFor(_gymId: string, memberId: string) {
    const found = [...this.followUps.entries()].find(([, row]) => row.memberId === memberId && row.completedAt === null);
    return Promise.resolve(found === undefined ? null : { id: found[0], ...found[1] });
  }
  createFollowUp(input: { gymId: string; memberId: string; planId: string; pendingQuestion: string }) {
    const id = `fu_${this.followUps.size + 1}`;
    this.followUps.set(id, { planId: input.planId, memberId: input.memberId, answers: {}, pendingQuestion: input.pendingQuestion, completedAt: null });
    return Promise.resolve(id);
  }
  saveFollowUp(id: string, patch: { answers?: Record<string, unknown>; pendingQuestion?: string | null; completedAt?: Date | null }) {
    const row = this.followUps.get(id);
    if (row === undefined) throw new Error(`no follow-up ${id}`);
    this.followUps.set(id, {
      ...row,
      ...(patch.answers === undefined ? {} : { answers: patch.answers }),
      ...('pendingQuestion' in patch ? { pendingQuestion: patch.pendingQuestion ?? null } : {}),
      ...('completedAt' in patch ? { completedAt: patch.completedAt ?? null } : {}),
    });
    return Promise.resolve();
  }
  savedWeight(memberId: string, weightGrams: number) {
    this.profilePatches.push({ memberId, patch: { weightGrams } });
    return Promise.resolve();
  }
  enqueueOutbox(event: OutboxEventInput) {
    if (!this.outbox.some((queued) => queued.dedupeKey === event.dedupeKey)) this.outbox.push(event);
    return Promise.resolve();
  }
}

const deps = (store: FakeFollowUpStore) => ({ clock, uow: { transaction: <T>(work: (s: FollowUpStore) => Promise<T>) => work(store) } });

describe('startDietFollowUps', () => {
  let store: FakeFollowUpStore;
  beforeEach(() => {
    store = new FakeFollowUpStore();
  });

  it('asks the first question a month after the plan', async () => {
    const result = await startDietFollowUps({ everyDays: 30 }, deps(store));

    expect(result).toEqual({ started: 1, skipped: 0 });
    expect(store.outbox[0]?.type).toBe('whatsapp.diet_follow_up');
    expect(store.outbox[0]?.dedupeKey).toBe('diet-follow:fu_1:following:1');
  });

  it('leaves a plan alone before it is due, and when the owner has switched follow-ups off', async () => {
    store.plans = [due({ generatedAt: istDate('2026-10-25') })];
    expect(await startDietFollowUps({ everyDays: 30 }, deps(store))).toEqual({ started: 0, skipped: 1 });

    store.plans = [due()];
    expect(await startDietFollowUps({ everyDays: 0 }, deps(store))).toEqual({ started: 0, skipped: 1 });
    expect(store.outbox).toEqual([]);
  });

  it('does not message a member who is no longer reachable', async () => {
    store.plans = [
      due({ memberId: 'mem_2', planId: 'plan_2', whatsappOptIn: false }),
      due({ memberId: 'mem_3', planId: 'plan_3', remindersUnsubscribedAt: new Date('2026-10-10T00:00:00Z') }),
      due({ memberId: 'mem_4', planId: 'plan_4', memberStatus: 'LEFT' }),
    ];
    expect(await startDietFollowUps({ everyDays: 30 }, deps(store))).toEqual({ started: 0, skipped: 3 });
  });

  it('does not open a second check while one is still unanswered', async () => {
    await startDietFollowUps({ everyDays: 30 }, deps(store));
    store.outbox.length = 0;

    expect(await startDietFollowUps({ everyDays: 30 }, deps(store))).toEqual({ started: 0, skipped: 1 });
    expect(store.outbox).toEqual([]);
  });
});

describe('recordFollowUpReply', () => {
  let store: FakeFollowUpStore;
  beforeEach(async () => {
    store = new FakeFollowUpStore();
    await startDietFollowUps({ everyDays: 30 }, deps(store));
    store.outbox.length = 0;
  });

  const reply = (text: string) => recordFollowUpReply({ gymId: 'gym_1', memberId: 'mem_1', text }, deps(store));

  it('walks the four questions and finishes', async () => {
    expect(await reply('mostly')).toEqual({ outcome: 'ASKED', question: 'weight' });
    expect(await reply('73')).toEqual({ outcome: 'ASKED', question: 'energy' });
    expect(await reply('better')).toEqual({ outcome: 'ASKED', question: 'wantsChange' });
    expect(await reply('no')).toEqual({ outcome: 'COMPLETE', newPlan: false });

    expect(store.followUps.get('fu_1')?.completedAt).toEqual(clock.now());
    expect(store.outbox.some((event) => event.type === 'diet.generate')).toBe(false);
  });

  it('writes a new plan when the member asks for one, and sends what they said with it', async () => {
    await reply('sometimes');
    await reply('same');
    await reply('same');
    expect(await reply('yes')).toEqual({ outcome: 'ASKED', question: 'changeWhat' });
    const result = await reply('too much rice, and I cannot eat at 9pm');

    expect(result).toEqual({ outcome: 'COMPLETE', newPlan: true });
    const generate = store.outbox.find((event) => event.type === 'diet.generate');
    expect(generate?.payload).toEqual({ memberId: 'mem_1', feedback: 'too much rice, and I cannot eat at 9pm' });
  });

  it('writes a new plan when the weight has moved, without being asked', async () => {
    await reply('mostly');
    await reply('77');
    await reply('better');
    const result = await reply('no');

    expect(result).toEqual({ outcome: 'COMPLETE', newPlan: true });
    // And the new weight becomes the member's weight, or the new plan is written on the old one.
    expect(store.profilePatches).toEqual([{ memberId: 'mem_1', patch: { weightGrams: 77_000 } }]);
  });

  it('asks again when it cannot read the answer', async () => {
    expect(await reply('kya')).toEqual({ outcome: 'REASKED', question: 'following' });
    expect(store.outbox[0]?.dedupeKey).toBe('diet-follow:fu_1:following:2');
  });

  it('ignores a reply when no check is open', async () => {
    await store.saveFollowUp('fu_1', { pendingQuestion: null, completedAt: clock.now() });
    expect(await reply('mostly')).toEqual({ outcome: 'NOT_ASKING' });
  });
});
