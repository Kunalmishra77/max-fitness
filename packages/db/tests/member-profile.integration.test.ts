/**
 * One member's profile, against a real database (PERF-003).
 *
 * `reader.member()` backs the member detail screen, the renew screen where fees are taken
 * at the desk, and the inbox's member pane — and nothing covered it. It also used to read
 * **every member's** fee state and then pick its one row out of the list, which is now
 * narrowed to the member being looked at. These tests exist so that narrowing cannot
 * quietly return the wrong member's fee state, or none at all, on the screen where money
 * changes hands.
 *
 * Everything is written under a throwaway gym and deleted afterwards.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { addDays, istDate, type ISTDate } from '@mfp/shared';
import { createPrismaClient, type PrismaClient } from '../src/client';
import { toDbDate } from '../src/dates';
import { PrismaCrmReader } from '../src/repositories/crm-read.repository';
import { integrationSuite, testDatabaseUrl } from './support';

const run = randomBytes(5).toString('hex');
const gymId = `gym_it_prof_${run}`;
const TODAY: ISTDate = istDate('2026-09-30');

const suite = integrationSuite('member profile');

suite('member profile against Postgres', () => {
  let prisma: PrismaClient;
  let reader: PrismaCrmReader;
  const ids: Record<string, string> = {};
  let seq = 0;

  async function member(key: string, endsOn: ISTDate | null, pricePaise = 150_000): Promise<string> {
    const id = `mem_it_prof_${run}_${key}`;
    await prisma.member.create({
      data: {
        id,
        gymId,
        fullName: `Profile ${key}`,
        mobile: `+9190${String(910_000 + ++seq).padStart(8, '0')}`,
        gender: 'FEMALE',
        status: 'ACTIVE',
        source: 'WALK_IN',
      },
    });
    if (endsOn !== null) {
      await prisma.membership.create({
        data: {
          gymId,
          memberId: id,
          status: 'CONFIRMED',
          source: 'WALK_IN',
          startDate: toDbDate(addDays(endsOn, -30)),
          endDate: toDbDate(endsOn),
          pricePaise,
          durationMonths: 1,
        },
      });
    }
    ids[key] = id;
    return id;
  }

  beforeAll(async () => {
    prisma = createPrismaClient({ connectionString: testDatabaseUrl, poolMax: 3 });
    reader = new PrismaCrmReader(prisma);
    await prisma.gym.create({
      data: { id: gymId, slug: gymId, name: 'Profile test gym', phone: '+919000000014', addressLine: 'T', city: 'T', state: 'T', pincode: '000000', settings: {} },
    });

    // Four members in four different fee states, so picking the wrong row shows up as a
    // wrong answer rather than as a coincidence.
    await member('paid', addDays(TODAY, 45), 300_000);
    await member('duesoon', addDays(TODAY, 3));
    await member('expired', addDays(TODAY, -12));
    await member('none', null);
  });

  afterAll(async () => {
    if (prisma === undefined) return;
    await prisma.membership.deleteMany({ where: { gymId } });
    await prisma.member.deleteMany({ where: { gymId } });
    await prisma.gym.deleteMany({ where: { id: gymId } });
    await prisma.$disconnect();
  });

  it('reads the fee state of the member asked for, not of whoever came back first', async () => {
    const paid = await reader.member(gymId, ids['paid'] as string, TODAY);
    const dueSoon = await reader.member(gymId, ids['duesoon'] as string, TODAY);
    const expired = await reader.member(gymId, ids['expired'] as string, TODAY);

    expect(paid?.feeState).toBe('PAID');
    expect(paid?.daysLeft).toBe(45);
    expect(dueSoon?.feeState).toBe('DUE_SOON');
    expect(dueSoon?.daysLeft).toBe(3);
    expect(expired?.feeState).toBe('EXPIRED');
    expect(expired?.daysLeft).toBe(-12);
  });

  it('says NONE for somebody with no membership, rather than leaving it unset', async () => {
    const none = await reader.member(gymId, ids['none'] as string, TODAY);

    expect(none).not.toBeNull();
    expect(none?.feeState).toBe('NONE');
    expect(none?.daysLeft).toBeNull();
    expect(none?.memberships).toEqual([]);
  });

  it('returns the member’s own plan, with what they paid for it', async () => {
    const paid = await reader.member(gymId, ids['paid'] as string, TODAY);

    expect(paid?.fullName).toBe('Profile paid');
    expect(paid?.memberships).toHaveLength(1);
    expect(paid?.memberships[0]?.pricePaise).toBe(300_000);
    expect(paid?.memberships[0]?.endDate).toBe(addDays(TODAY, 45));
  });

  it('refuses a member from another gym rather than returning them', async () => {
    const otherGymId = `${gymId}_nope`;
    expect(await reader.member(otherGymId, ids['paid'] as string, TODAY)).toBeNull();
  });

  it('returns null for a member who does not exist', async () => {
    expect(await reader.member(gymId, `${gymId}_missing`, TODAY)).toBeNull();
  });
});
