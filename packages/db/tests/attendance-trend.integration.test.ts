/**
 * The week-of-arrivals query, against a real database (ADR-095).
 *
 * This is raw SQL with date arithmetic in it, so it is exactly the kind of thing that
 * typechecks, reads correctly, and returns the wrong week. Three things can only be
 * checked here: that the window really is the last seven days ending today rather than
 * eight or six, that one member scanning twice is one arrival, and that a voided
 * check-in — the desk's undo — leaves no trace in the count.
 *
 * Everything is written under a throwaway gym and deleted afterwards.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { istDate, type ISTDate } from '@mfp/shared';
import { createPrismaClient, type PrismaClient } from '../src/client';
import { toDbDate } from '../src/dates';
import { PrismaCrmReader } from '../src/repositories/crm-read.repository';
import { integrationSuite, testDatabaseUrl } from './support';

const run = randomBytes(5).toString('hex');
const gymId = `gym_it_trend_${run}`;
const TODAY: ISTDate = istDate('2026-09-30');

const suite = integrationSuite('attendance trend');

suite('attendanceByDay against Postgres', () => {
  let prisma: PrismaClient;
  let reader: PrismaCrmReader;
  let seq = 0;

  async function member(key: string): Promise<string> {
    const id = `mem_it_trend_${run}_${key}`;
    await prisma.member.create({
      data: {
        id,
        gymId,
        fullName: `Trend ${key}`,
        mobile: `+9190004${key.padStart(5, '0')}`,
        gender: 'MALE',
        status: 'ACTIVE',
        source: 'WALK_IN',
      },
    });
    return id;
  }

  async function checkIn(memberId: string, day: string, options: { voided?: boolean } = {}): Promise<void> {
    seq += 1;
    await prisma.attendanceEvent.create({
      data: {
        gymId,
        memberId,
        clientEventId: `evt_it_trend_${run}_${seq}`,
        method: 'MANUAL',
        capturedAt: new Date(`${day}T06:00:00+05:30`),
        attendanceDate: toDbDate(istDate(day)),
        ...(options.voided === true ? { voidedAt: new Date(`${day}T07:00:00+05:30`) } : {}),
      },
    });
  }

  const countOn = async (day: ISTDate): Promise<number> => {
    const rows = await reader.attendanceByDay(gymId, TODAY, 7);
    return rows.find((row) => row.date === day)?.count ?? 0;
  };

  beforeAll(async () => {
    prisma = createPrismaClient({ connectionString: testDatabaseUrl, poolMax: 4 });
    reader = new PrismaCrmReader(prisma);
    await prisma.gym.create({
      data: { id: gymId, slug: gymId, name: 'Trend test gym', phone: '+919000000010', addressLine: 'Test', city: 'Test', state: 'Test', pincode: '000000', settings: {} },
    });
  });

  afterAll(async () => {
    if (prisma === undefined) return;
    await prisma.attendanceEvent.deleteMany({ where: { gymId } });
    await prisma.membership.deleteMany({ where: { gymId } });
    await prisma.member.deleteMany({ where: { gymId } });
    await prisma.gym.deleteMany({ where: { id: gymId } });
    await prisma.$disconnect();
  });

  it('counts the arrivals on each day of the window, today included', async () => {
    const anita = await member('01');
    const rohit = await member('02');
    await checkIn(anita, '2026-09-28');
    await checkIn(rohit, '2026-09-28');
    await checkIn(anita, '2026-09-30');

    expect(await countOn(istDate('2026-09-28'))).toBe(2);
    expect(await countOn(istDate('2026-09-30'))).toBe(1);
  });

  it('counts a member once however many times they scanned that day', async () => {
    // Somebody scans, the kiosk looks unsure, they scan again. That is one arrival.
    const twice = await member('03');
    await checkIn(twice, '2026-09-29');
    await checkIn(twice, '2026-09-29');

    expect(await countOn(istDate('2026-09-29'))).toBe(1);
  });

  it('leaves no trace of a check-in the desk undid', async () => {
    const undone = await member('04');
    await checkIn(undone, '2026-09-27', { voided: true });

    expect(await countOn(istDate('2026-09-27'))).toBe(0);
  });

  it('takes the seventh day back and not the eighth', async () => {
    const oldest = await member('05');
    const tooOld = await member('06');
    await checkIn(oldest, '2026-09-24');
    await checkIn(tooOld, '2026-09-23');

    const dates = (await reader.attendanceByDay(gymId, TODAY, 7)).map((row) => row.date);
    expect(dates).toContain(istDate('2026-09-24'));
    expect(dates).not.toContain(istDate('2026-09-23'));
  });

  it('does not count another gym’s arrivals', async () => {
    const otherGym = `${gymId}_other`;
    await prisma.gym.create({
      data: { id: otherGym, slug: otherGym, name: 'Other', phone: '+919000000011', addressLine: 'T', city: 'T', state: 'T', pincode: '000000', settings: {} },
    });
    const stranger = await prisma.member.create({
      data: { id: `mem_it_trend_${run}_other`, gymId: otherGym, fullName: 'Stranger', mobile: '+919000499999', gender: 'MALE', status: 'ACTIVE', source: 'WALK_IN' },
    });
    seq += 1;
    await prisma.attendanceEvent.create({
      data: {
        gymId: otherGym,
        memberId: stranger.id,
        clientEventId: `evt_it_trend_${run}_${seq}`,
        method: 'MANUAL',
        capturedAt: new Date('2026-09-26T06:00:00+05:30'),
        attendanceDate: toDbDate(istDate('2026-09-26')),
      },
    });

    expect(await countOn(istDate('2026-09-26'))).toBe(0);

    await prisma.attendanceEvent.deleteMany({ where: { gymId: otherGym } });
    await prisma.member.deleteMany({ where: { gymId: otherGym } });
    await prisma.gym.deleteMany({ where: { id: otherGym } });
  });

  it('says what each arrival owes, so the desk can ask while they are standing there', async () => {
    // A member whose fee has lapsed walking through the door is the easiest collection the
    // gym will get all day, and the list used to show only a name and a time (ADR-097).
    const owing = await member('07');
    await prisma.membership.create({
      data: {
        gymId,
        memberId: owing,
        status: 'CONFIRMED',
        source: 'WALK_IN',
        startDate: toDbDate(istDate('2026-07-01')),
        endDate: toDbDate(istDate('2026-09-20')),
        pricePaise: 150000,
        durationMonths: 1,
      },
    });
    await checkIn(owing, '2026-09-30');

    const arrivals = await reader.attendanceToday(gymId, TODAY);
    const row = arrivals.find((a) => a.memberId === owing);

    expect(row?.feeState).toBe('EXPIRED');
    expect(row?.daysLeft).toBe(-10);
  });

  it('calls a member with no membership at all NONE rather than guessing', async () => {
    const never = await member('08');
    await checkIn(never, '2026-09-30');

    const row = (await reader.attendanceToday(gymId, TODAY)).find((a) => a.memberId === never);
    expect(row?.feeState).toBe('NONE');
    expect(row?.daysLeft).toBeNull();
  });
});
