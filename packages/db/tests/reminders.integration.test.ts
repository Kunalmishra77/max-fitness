/**
 * Who a reminder slot would message, against a real database (database-design §4.2;
 * whatsapp-automation-engine §5; testing-strategy §4 R1–R12).
 *
 * The SQL is where a reminder goes wrong quietly: an off-by-one on the offset, a member
 * who unsubscribed still coming back, a paused member waking up a day early. This pins
 * each of those, and then feeds the rows to the pure engine to prove the two agree.
 *
 * Everything is written under a throwaway gym and deleted afterwards.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { istDate, type ISTDate, type Language, type MemberStatus } from '@mfp/shared';
import { planSlot } from '@mfp/core';
import { createPrismaClient, type PrismaClient } from '../src/client';
import { toDbDate } from '../src/dates';
import { PrismaReminderCandidates, PrismaReminderRules } from '../src/repositories/reminders.repository';
import { integrationSuite, testDatabaseUrl } from './support';

const run = randomBytes(5).toString('hex');
const gymId = `gym_it_rem_${run}`;
const TODAY = istDate('2026-09-23');
const SLOT = '10:00';

const suite = integrationSuite('reminder candidates');

suite('reminder candidates against Postgres', () => {
  let prisma: PrismaClient;
  let candidates: PrismaReminderCandidates;
  let rules: PrismaReminderRules;

  /** A member with one confirmed membership ending on `endDate`. */
  async function member(
    key: string,
    endDate: ISTDate | null,
    over: { status?: MemberStatus; whatsappOptIn?: boolean; unsubscribed?: boolean; pausedUntil?: ISTDate; mobile?: string; language?: Language } = {},
  ): Promise<string> {
    const id = `mem_it_rem_${run}_${key}`;
    await prisma.member.create({
      data: {
        id,
        gymId,
        fullName: `Rem ${key} Tester`,
        mobile: over.mobile ?? `+9190001${key.padStart(5, '0')}`,
        dob: toDbDate(istDate('1995-01-01')),
        gender: 'MALE',
        language: over.language ?? 'hi',
        status: over.status ?? 'ACTIVE',
        source: 'WALK_IN',
        whatsappOptIn: over.whatsappOptIn ?? true,
        ...(over.unsubscribed === true ? { remindersUnsubscribedAt: new Date('2026-09-01T00:00:00Z') } : {}),
        ...(over.pausedUntil === undefined ? {} : { remindersPausedUntil: toDbDate(over.pausedUntil) }),
      },
    });
    if (endDate !== null) {
      await prisma.membership.create({
        data: {
          gymId,
          memberId: id,
          durationMonths: 1,
          startDate: toDbDate(istDate('2026-08-24')),
          endDate: toDbDate(endDate),
          status: 'CONFIRMED',
          source: 'WALK_IN',
          pricePaise: 150_000,
        },
      });
    }
    return id;
  }

  beforeAll(async () => {
    prisma = createPrismaClient({ connectionString: testDatabaseUrl, poolMax: 4 });
    candidates = new PrismaReminderCandidates(prisma);
    rules = new PrismaReminderRules(prisma);

    await prisma.gym.create({
      data: { id: gymId, slug: gymId, name: 'Reminder test gym', phone: '+919000000007', addressLine: 'Test', city: 'Test', state: 'Test', pincode: '000000', settings: {} },
    });
    await prisma.reminderRule.createMany({
      data: [
        { gymId, code: 'PRE_7', offsetDays: -7, offsetDaysTo: -7, slots: [SLOT], templateName: 'mf_renewal_due', isEnabled: true },
        { gymId, code: 'DUE_TODAY', offsetDays: 0, offsetDaysTo: 0, slots: [SLOT], templateName: 'mf_renewal_due_today', isEnabled: true },
        { gymId, code: 'POST', offsetDays: 1, offsetDaysTo: 7, slots: ['09:30'], templateName: 'mf_membership_expired', isEnabled: true },
        { gymId, code: 'PRE_3', offsetDays: -3, offsetDaysTo: -3, slots: [SLOT], templateName: 'mf_renewal_due', isEnabled: false },
      ],
    });
  });

  afterAll(async () => {
    if (prisma === undefined) return;
    await prisma.membership.deleteMany({ where: { gymId } });
    await prisma.member.deleteMany({ where: { gymId } });
    await prisma.reminderRule.deleteMany({ where: { gymId } });
    await prisma.gym.deleteMany({ where: { id: gymId } });
    await prisma.$disconnect();
  });

  it('finds exactly the members a rule covers today, and nobody else', async () => {
    // Seven days before the end date: the PRE_7 rule's own day.
    const due = await member('01', istDate('2026-09-30'));
    // The last day: DUE_TODAY.
    const today = await member('02', istDate('2026-09-23'));
    // Eight days out and six days out: between the rules, so nothing.
    await member('03', istDate('2026-10-01'));
    await member('04', istDate('2026-09-29'));
    // Expired three days ago: POST covers it, but POST runs at another slot.
    await member('05', istDate('2026-09-20'));
    // No membership at all.
    await member('06', null);

    const rows = await candidates.forSlot(gymId, TODAY, SLOT);

    expect(rows.map((row) => ({ memberId: row.memberId, ruleCode: row.ruleCode }))).toEqual([
      { memberId: due, ruleCode: 'PRE_7' },
      { memberId: today, ruleCode: 'DUE_TODAY' },
    ]);
    expect(rows[0]).toMatchObject({ firstName: 'Rem', language: 'hi', endDate: '2026-09-30' });

    // The same day at the POST slot: only the expired member.
    const post = await candidates.forSlot(gymId, TODAY, '09:30');
    expect(post.map((row) => row.ruleCode)).toEqual(['POST']);
  });

  it('leaves out everyone who should never be messaged', async () => {
    const endDate = istDate('2026-09-30');
    await member('10', endDate, { status: 'LEFT' });
    await member('11', endDate, { whatsappOptIn: false });
    await member('12', endDate, { unsubscribed: true });
    // Paused until today: still paused (BR-5.3 — the pause includes its last day).
    await member('13', endDate, { pausedUntil: TODAY });
    // Paused until yesterday: back in the list.
    const backAgain = await member('14', endDate, { pausedUntil: istDate('2026-09-22') });

    const ids = (await candidates.forSlot(gymId, TODAY, SLOT)).map((row) => row.memberId);

    expect(ids).toContain(backAgain);
    for (const key of ['10', '11', '12', '13']) expect(ids).not.toContain(`mem_it_rem_${run}_${key}`);
  });

  it('agrees with the engine: the rows become one message each, family numbers capped', async () => {
    const shared = '+919000199999';
    await member('20', istDate('2026-09-30'), { mobile: shared, language: 'en' });
    await member('21', istDate('2026-09-30'), { mobile: shared, language: 'en' });

    const rows = (await candidates.forSlot(gymId, TODAY, SLOT)).filter((row) => row.mobile === shared);
    const plan = planSlot(
      { today: TODAY, slot: SLOT, rules: await rules.all(gymId), candidates: rows, maxMessagesPerNumberPerDay: 1 },
      { tokens: { renewUrl: (id) => `https://max.test/r/${id}`, unsubscribePayload: (id) => `UNSUB.${id}` } },
    );

    expect(rows).toHaveLength(2);
    expect(plan.intents).toHaveLength(1);
    expect(plan.intents[0]?.idempotencyKey).toBe(`rem:${rows[0]?.memberId ?? ''}:${rows[0]?.membershipId ?? ''}:PRE_7:2026-09-23:10:00`);
    expect(plan.skipped).toEqual([expect.objectContaining({ reason: 'NUMBER_CAP' })]);
  });

  it('lists the slots the worker has to run, ignoring the rules that are off', async () => {
    expect(await rules.slots(gymId)).toEqual(['09:30', '10:00']);
  });
});
