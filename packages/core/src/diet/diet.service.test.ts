import { beforeEach, describe, expect, it } from 'vitest';
import { istDate } from '@mfp/shared';
import { fakeClockAt } from '../testing/builders';
import type { OutboxEventInput } from '../ports/outbox';
import type { CrmActor } from '../crm/permissions';
import { recordDietReply, startDietPlans, type DietMemberRecord, type DietProfileRecord, type DietStore } from './diet.service';

/**
 * Collecting the answers over WhatsApp (ADR-089).
 *
 * The rules worth holding down: nobody is messaged who has not agreed to be, a question
 * is asked once and remembered, an unreadable reply is asked again rather than skipped,
 * and the plan is only requested when there is enough to write one. Everything about the
 * wording lives in the templates; this is about who gets asked what, and when.
 */

const clock = fakeClockAt('2026-10-02T11:00');
const owner: CrmActor = { staffUserId: 'staff_1', gymId: 'gym_1', role: 'OWNER', elevatedUntil: null, receptionMayTakePayments: true };
const trainer: CrmActor = { ...owner, staffUserId: 'staff_3', role: 'TRAINER' };

const member = (over: Partial<DietMemberRecord> = {}): DietMemberRecord => ({
  id: 'mem_1',
  gymId: 'gym_1',
  fullName: 'Suresh Yadav',
  language: 'hi',
  gender: 'MALE',
  status: 'ACTIVE',
  whatsappOptIn: true,
  remindersUnsubscribedAt: null,
  dob: istDate('1995-05-05'),
  ...over,
});

class FakeDietStore implements DietStore {
  members = new Map<string, DietMemberRecord>([['mem_1', member()]]);
  profiles = new Map<string, DietProfileRecord>();
  readonly outbox: OutboxEventInput[] = [];
  readonly saved: Array<{ memberId: string; patch: Partial<DietProfileRecord> }> = [];

  memberForDiet(_gymId: string, memberId: string) {
    return Promise.resolve(this.members.get(memberId) ?? null);
  }
  memberByMobile() {
    return Promise.resolve(null);
  }
  loadProfile(_gymId: string, memberId: string) {
    return Promise.resolve(this.profiles.get(memberId) ?? null);
  }
  saveProfile(_gymId: string, memberId: string, patch: Partial<DietProfileRecord>) {
    this.saved.push({ memberId, patch });
    this.profiles.set(memberId, { ...(this.profiles.get(memberId) ?? { memberId, pendingQuestion: null, nudgesSent: 0, completedAt: null }), ...patch });
    return Promise.resolve();
  }
  enqueueOutbox(event: OutboxEventInput) {
    if (!this.outbox.some((queued) => queued.dedupeKey === event.dedupeKey)) this.outbox.push(event);
    return Promise.resolve();
  }
}

const deps = (store: FakeDietStore, actor: CrmActor = owner) => ({
  actor,
  clock,
  uow: { transaction: <T>(work: (s: DietStore) => Promise<T>) => work(store) },
});

describe('startDietPlans', () => {
  let store: FakeDietStore;
  beforeEach(() => {
    store = new FakeDietStore();
  });

  it('asks the first question and remembers that it is waiting on it', async () => {
    const result = await startDietPlans({ memberIds: ['mem_1'] }, deps(store));

    expect(result).toEqual({ started: ['mem_1'], skipped: [] });
    expect(store.profiles.get('mem_1')?.pendingQuestion).toBe('weight');
    expect(store.outbox.map((event) => event.type)).toEqual(['whatsapp.diet_question']);
    expect(store.outbox[0]?.dedupeKey).toBe('diet-ask:mem_1:weight:1');
  });

  it('fills the age from the date of birth the gym already has', async () => {
    await startDietPlans({ memberIds: ['mem_1'] }, deps(store));
    // Born May 1995, asked in October 2026 → 31. Asking again would be rude and pointless.
    expect(store.profiles.get('mem_1')?.ageYears).toBe(31);
  });

  it('will not message a member who never agreed to messages', async () => {
    store.members.set('mem_2', member({ id: 'mem_2', whatsappOptIn: false }));
    store.members.set('mem_3', member({ id: 'mem_3', remindersUnsubscribedAt: new Date('2026-09-01T00:00:00Z') }));
    store.members.set('mem_4', member({ id: 'mem_4', status: 'LEFT' }));

    const result = await startDietPlans({ memberIds: ['mem_1', 'mem_2', 'mem_3', 'mem_4'] }, deps(store));

    expect(result.started).toEqual(['mem_1']);
    expect(result.skipped).toEqual([
      { memberId: 'mem_2', reason: 'NOT_OPTED_IN' },
      { memberId: 'mem_3', reason: 'UNSUBSCRIBED' },
      { memberId: 'mem_4', reason: 'MEMBER_NOT_ACTIVE' },
    ]);
    expect(store.outbox).toHaveLength(1);
  });

  it('does not start again over a member who is mid-answer', async () => {
    await startDietPlans({ memberIds: ['mem_1'] }, deps(store));
    await store.saveProfile('gym_1', 'mem_1', { weightGrams: 72_000, pendingQuestion: 'height' });

    const result = await startDietPlans({ memberIds: ['mem_1'] }, deps(store));

    expect(result).toEqual({ started: [], skipped: [{ memberId: 'mem_1', reason: 'ALREADY_ASKING' }] });
    expect(store.profiles.get('mem_1')?.pendingQuestion).toBe('height');
  });

  it('lets a trainer start one and refuses somebody with no business doing it', async () => {
    await expect(startDietPlans({ memberIds: ['mem_1'] }, deps(store, trainer))).resolves.toBeDefined();
    const kiosk: CrmActor = { ...owner, role: 'KIOSK' as CrmActor['role'] };
    await expect(startDietPlans({ memberIds: ['mem_1'] }, deps(new FakeDietStore(), kiosk))).rejects.toThrow(
      expect.objectContaining({ code: 'FORBIDDEN' }) as Error,
    );
  });
});

describe('recordDietReply', () => {
  let store: FakeDietStore;
  beforeEach(async () => {
    store = new FakeDietStore();
    await startDietPlans({ memberIds: ['mem_1'] }, deps(store));
    store.outbox.length = 0;
  });

  const reply = (text: string) => recordDietReply({ memberId: 'mem_1', text }, deps(store));

  it('stores the answer and asks the next thing', async () => {
    const result = await reply('72 kg');

    expect(result).toEqual({ outcome: 'ASKED', question: 'height' });
    expect(store.profiles.get('mem_1')?.weightGrams).toBe(72_000);
    expect(store.profiles.get('mem_1')?.pendingQuestion).toBe('height');
    expect(store.outbox[0]?.dedupeKey).toBe('diet-ask:mem_1:height:1');
  });

  it('asks the same thing again when it cannot read the answer, and keeps nothing', async () => {
    const result = await reply('bahut zyada');

    expect(result).toEqual({ outcome: 'REASKED', question: 'weight' });
    expect(store.profiles.get('mem_1')?.weightGrams).toBeUndefined();
    expect(store.profiles.get('mem_1')?.pendingQuestion).toBe('weight');
    // A different key, or the nudge would be deduped away as the question already asked.
    expect(store.outbox[0]?.dedupeKey).toBe('diet-ask:mem_1:weight:2');
  });

  it('asks for a plan once there is enough, and stops waiting on the member', async () => {
    await reply('72');
    await reply('170');
    await reply('muscle gain');
    await reply('veg');
    await reply('none');
    await reply('4');
    await reply('desk job');
    const result = await reply('5');

    expect(result).toEqual({ outcome: 'COMPLETE' });
    expect(store.profiles.get('mem_1')?.pendingQuestion).toBeNull();
    expect(store.profiles.get('mem_1')?.completedAt).toEqual(clock.now());
    expect(store.outbox.map((event) => event.type)).toContain('diet.generate');
    expect(store.outbox.find((event) => event.type === 'diet.generate')?.dedupeKey).toBe('diet-generate:mem_1:1');
  });

  it('ignores a reply from a member nobody asked anything', async () => {
    await store.saveProfile('gym_1', 'mem_1', { pendingQuestion: null });
    expect(await reply('72')).toEqual({ outcome: 'NOT_ASKING' });
    expect(store.outbox).toEqual([]);
  });

  it('gives up asking after three unreadable tries rather than badgering them', async () => {
    await reply('eh');
    await reply('eh');
    const third = await reply('eh');

    expect(third).toEqual({ outcome: 'GAVE_UP', question: 'weight' });
    expect(store.profiles.get('mem_1')?.pendingQuestion).toBeNull();
  });
});
