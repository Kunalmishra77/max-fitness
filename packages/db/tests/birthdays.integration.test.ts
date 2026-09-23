/**
 * Today's birthday list, against a real database (BR-8).
 *
 * Two things can only be checked here: that the SQL narrowing agrees with the
 * leap-day rule, and that a wish already on its way is shown as on its way. The second is
 * what stops the button coming back after a reload — a wish lives in the outbox for
 * a few seconds before the worker turns it into a message log row, and in that gap
 * the desk must not be invited to send it again.
 *
 * Everything is written under a throwaway gym and deleted afterwards.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { istDate, type ISTDate } from '@mfp/shared';
import { createPrismaClient, type PrismaClient } from '../src/client';
import { toDbDate } from '../src/dates';
import { PrismaBirthdays } from '../src/repositories/birthday.repository';
import { integrationSuite, testDatabaseUrl } from './support';

const run = randomBytes(5).toString('hex');
const gymId = `gym_it_bday_${run}`;
const TODAY = istDate('2026-09-23');

const suite = integrationSuite('birthday list');

suite('birthday list against Postgres', () => {
  let prisma: PrismaClient;
  let birthdays: PrismaBirthdays;

  async function member(key: string, dob: string | null, over: { status?: 'ACTIVE' | 'LEFT'; whatsappOptIn?: boolean; unsubscribed?: boolean } = {}): Promise<string> {
    const id = `mem_it_bday_${run}_${key}`;
    await prisma.member.create({
      data: {
        id,
        gymId,
        fullName: `Bday ${key} Tester`,
        mobile: `+9190003${key.padStart(5, '0')}`,
        ...(dob === null ? {} : { dob: toDbDate(istDate(dob)) }),
        gender: 'MALE',
        status: over.status ?? 'ACTIVE',
        source: 'WALK_IN',
        whatsappOptIn: over.whatsappOptIn ?? true,
        ...(over.unsubscribed === true ? { remindersUnsubscribedAt: new Date('2026-09-01T00:00:00Z') } : {}),
      },
    });
    return id;
  }

  const namesOn = async (day: ISTDate) => (await birthdays.today(gymId, day)).map((row) => row.memberId);

  beforeAll(async () => {
    prisma = createPrismaClient({ connectionString: testDatabaseUrl, poolMax: 4 });
    birthdays = new PrismaBirthdays(prisma);
    await prisma.gym.create({
      data: { id: gymId, slug: gymId, name: 'Birthday test gym', phone: '+919000000009', addressLine: 'Test', city: 'Test', state: 'Test', pincode: '000000', settings: {} },
    });
  });

  afterAll(async () => {
    if (prisma === undefined) return;
    await prisma.outboxEvent.deleteMany({ where: { gymId } });
    await prisma.messageLog.deleteMany({ where: { gymId } });
    await prisma.member.deleteMany({ where: { gymId } });
    await prisma.gym.deleteMany({ where: { id: gymId } });
    await prisma.$disconnect();
  });

  it('lists exactly today’s birthdays, and nobody else', async () => {
    const today = await member('01', '1994-09-23');
    await member('02', '1994-09-24');
    await member('03', null);
    // Same day, but they have left.
    await member('04', '1990-09-23', { status: 'LEFT' });

    expect(await namesOn(TODAY)).toEqual([today]);
  });

  it('says who cannot be messaged instead of leaving them out', async () => {
    await member('05', '1991-09-23', { whatsappOptIn: false });
    await member('06', '1992-09-23', { unsubscribed: true });

    const rows = await birthdays.today(gymId, TODAY);

    expect(rows.filter((row) => row.memberId.endsWith('_05') || row.memberId.endsWith('_06'))).toHaveLength(2);
    expect(rows.filter((row) => row.canWish).map((row) => row.memberId)).toEqual([`mem_it_bday_${run}_01`]);
  });

  it('greets a leap-day member on 28 February only in a year without a 29th (BR-8.1)', async () => {
    const leapling = await member('07', '2000-02-29');

    expect(await namesOn(istDate('2028-02-29'))).toEqual([leapling]);
    expect(await namesOn(istDate('2027-02-28'))).toEqual([leapling]);
    // 2028 has a 29th, so the 28th is not their day.
    expect(await namesOn(istDate('2028-02-28'))).toEqual([]);
  });

  it('shows a wish still in the outbox as on its way, so the button does not come back', async () => {
    const memberId = `mem_it_bday_${run}_01`;
    await prisma.outboxEvent.create({
      data: { gymId, type: 'whatsapp.birthday', payload: { memberId, year: '2026' }, dedupeKey: `birthday:${memberId}:2026` },
    });

    const row = (await birthdays.today(gymId, TODAY)).find((item) => item.memberId === memberId);
    expect(row?.wish).toBe('queued');
  });

  it('counts a wish the worker has already sent', async () => {
    const memberId = await member('08', '1993-09-23');
    await prisma.messageLog.create({
      data: { gymId, memberId, direction: 'OUTBOUND', purpose: 'BIRTHDAY', status: 'SENT', idempotencyKey: `birthday:${memberId}:2026` },
    });

    const row = (await birthdays.today(gymId, TODAY)).find((item) => item.memberId === memberId);
    expect(row?.wish).toBe('sent');
  });

  it('does not carry last year’s wish over to this year', async () => {
    const memberId = await member('09', '1989-09-23');
    await prisma.messageLog.create({
      data: { gymId, memberId, direction: 'OUTBOUND', purpose: 'BIRTHDAY', status: 'SENT', idempotencyKey: `birthday:${memberId}:2025` },
    });

    const row = (await birthdays.today(gymId, TODAY)).find((item) => item.memberId === memberId);
    expect(row?.wish).toBe('none');
  });
});
