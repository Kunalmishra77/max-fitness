/**
 * The member's state in the second before a reminder goes out (BR-5.3, BR-5.6).
 *
 * This is the query the whole reminder engine leans on: `sendReminder` calls it for
 * every message, and if it throws, nothing is ever sent. It counts the day's messages
 * to one phone number, which is the family cap — so it has to agree with the IST
 * business day, not with UTC.
 *
 * Everything is written under a throwaway gym and deleted afterwards.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { istDate } from '@mfp/shared';
import { createPrismaClient, type PrismaClient } from '../src/client';
import { toDbDate } from '../src/dates';
import { PrismaMessageLogWriter } from '../src/repositories/message-log.repository';
import { PrismaSendContext } from '../src/repositories/reminder-runtime.repository';
import { integrationSuite, testDatabaseUrl } from './support';

const run = randomBytes(5).toString('hex');
const gymId = `gym_it_ctx_${run}`;
const TODAY = istDate('2026-09-23');
const SHARED = `+9190004${run.slice(0, 5)}`;

const suite = integrationSuite('send context');

suite('send context against Postgres', () => {
  let prisma: PrismaClient;
  let context: PrismaSendContext;

  async function member(key: string, mobile = SHARED): Promise<string> {
    const id = `mem_it_ctx_${run}_${key}`;
    await prisma.member.create({
      data: { id, gymId, fullName: `Ctx ${key} Tester`, mobile, gender: 'MALE', status: 'ACTIVE', source: 'WALK_IN', whatsappOptIn: true },
    });
    await prisma.membership.create({
      data: { gymId, memberId: id, durationMonths: 1, startDate: toDbDate(istDate('2026-08-24')), endDate: toDbDate(istDate('2026-09-30')), status: 'CONFIRMED', source: 'WALK_IN', pricePaise: 150_000 },
    });
    return id;
  }

  /** A reminder already sent to the shared number on a given business date. */
  async function reminder(key: string, businessDate: string, status: 'SENT' | 'FAILED' = 'SENT'): Promise<void> {
    await new PrismaMessageLogWriter(prisma).record({
      gymId,
      memberId: null,
      membershipId: null,
      direction: 'OUTBOUND',
      purpose: 'REMINDER',
      ruleCode: 'POST',
      templateName: 'mf_membership_expired',
      language: 'hi',
      toNumber: SHARED as never,
      idempotencyKey: `it_ctx_${run}_${key}`,
      providerMessageId: null,
      status,
      businessDate: istDate(businessDate),
      bodyPreview: null,
      payload: null,
    });
  }

  beforeAll(async () => {
    prisma = createPrismaClient({ connectionString: testDatabaseUrl, poolMax: 4 });
    context = new PrismaSendContext(prisma);
    await prisma.gym.create({
      data: { id: gymId, slug: gymId, name: 'Context test gym', phone: '+919000000010', addressLine: 'Test', city: 'Test', state: 'Test', pincode: '000000', settings: {} },
    });
  });

  afterAll(async () => {
    if (prisma === undefined) return;
    await prisma.messageLog.deleteMany({ where: { gymId } });
    await prisma.membership.deleteMany({ where: { gymId } });
    await prisma.member.deleteMany({ where: { gymId } });
    await prisma.gym.deleteMany({ where: { id: gymId } });
    await prisma.$disconnect();
  });

  it('answers at all — the send path cannot work if this query is wrong', async () => {
    const memberId = await member('01');

    const row = await context.load(memberId, TODAY);

    expect(row).toMatchObject({ memberStatus: 'ACTIVE', whatsappOptIn: true, hasMobile: true, messagesToNumberToday: 0 });
    expect(row?.latestConfirmedMembershipId).toBeTruthy();
  });

  it('counts the day’s reminders to one number, families included (BR-5.6)', async () => {
    const memberId = await member('02');
    await reminder('a', '2026-09-23');
    await reminder('b', '2026-09-23');
    // Yesterday's, and one that never went out: neither spends today's allowance.
    await reminder('c', '2026-09-22');
    await reminder('d', '2026-09-23', 'FAILED');

    expect((await context.load(memberId, TODAY))?.messagesToNumberToday).toBe(2);
  });

  it('says nothing about a member who has been erased', async () => {
    const memberId = await member('03', `+9190005${run.slice(0, 5)}`);
    await prisma.member.update({ where: { id: memberId }, data: { deletedAt: new Date() } });

    expect(await context.load(memberId, TODAY)).toBeNull();
  });
});
