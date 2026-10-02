/**
 * The members list, its fee filter and its counts, against a real database (ADR-097).
 *
 * The filter used to run in JavaScript **after** `take`, so asking for expired members
 * returned only the expired ones among the alphabetically-first page. At fourteen members
 * that is invisible; at a hundred and fifty it quietly hides people who owe money, which
 * is the one thing the screen exists to stop. The first test here is that bug, written so
 * it cannot come back.
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
const gymId = `gym_it_mlist_${run}`;
const TODAY: ISTDate = istDate('2026-09-30');

const suite = integrationSuite('members list');

suite('members list against Postgres', () => {
  let prisma: PrismaClient;
  let reader: PrismaCrmReader;

  /**
   * `name` drives the alphabetical order the limit cuts on, which is the whole point of
   * the first test: the expired member is deliberately last in the alphabet.
   */
  async function member(key: string, name: string, endsOn: string | null): Promise<string> {
    const id = `mem_it_mlist_${run}_${key}`;
    await prisma.member.create({
      data: { id, gymId, fullName: name, mobile: `+9190005${key.padStart(5, '0')}`, gender: 'MALE', status: 'ACTIVE', source: 'WALK_IN' },
    });
    if (endsOn !== null) {
      await prisma.membership.create({
        data: {
          gymId,
          memberId: id,
          status: 'CONFIRMED',
          source: 'WALK_IN',
          startDate: toDbDate(istDate('2026-01-01')),
          endDate: toDbDate(istDate(endsOn)),
          pricePaise: 150000,
          durationMonths: 1,
        },
      });
    }
    return id;
  }

  beforeAll(async () => {
    prisma = createPrismaClient({ connectionString: testDatabaseUrl, poolMax: 4 });
    reader = new PrismaCrmReader(prisma);
    await prisma.gym.create({
      data: { id: gymId, slug: gymId, name: 'Members list test gym', phone: '+919000000012', addressLine: 'T', city: 'T', state: 'T', pincode: '000000', settings: {} },
    });

    // Three paid members early in the alphabet, one expired member last.
    await member('01', 'Aarav Paid', '2026-12-31');
    await member('02', 'Bhavna Paid', '2026-12-31');
    await member('03', 'Chetan Paid', '2026-12-31');
    await member('04', 'Zoya Expired', '2026-08-31');
    // And one with no membership at all, so NONE is represented.
    await member('05', 'Yash Nothing', null);
  });

  afterAll(async () => {
    if (prisma === undefined) return;
    await prisma.membership.deleteMany({ where: { gymId } });
    await prisma.member.deleteMany({ where: { gymId } });
    await prisma.gym.deleteMany({ where: { id: gymId } });
    await prisma.$disconnect();
  });

  it('finds an expired member who falls outside the first page of names', async () => {
    // The bug: `take: 3` kept Aarav, Bhavna and Chetan — all paid — and the filter then
    // returned nothing, reporting a gym with no unpaid fees while Zoya owed a month.
    const expired = await reader.members(gymId, TODAY, { feeState: 'EXPIRED', limit: 3 });

    expect(expired.map((m) => m.fullName)).toEqual(['Zoya Expired']);
  });

  it('still honours the limit, counting only the members it was asked for', async () => {
    const paid = await reader.members(gymId, TODAY, { feeState: 'PAID', limit: 2 });

    expect(paid.map((m) => m.fullName)).toEqual(['Aarav Paid', 'Bhavna Paid']);
  });

  it('lists everybody when no fee filter is asked for', async () => {
    const all = await reader.members(gymId, TODAY, { limit: 50 });
    expect(all).toHaveLength(5);
  });

  it('combines the fee filter with a search rather than ignoring one of them', async () => {
    const found = await reader.members(gymId, TODAY, { feeState: 'PAID', search: 'Chetan', limit: 50 });
    expect(found.map((m) => m.fullName)).toEqual(['Chetan Paid']);

    const none = await reader.members(gymId, TODAY, { feeState: 'EXPIRED', search: 'Chetan', limit: 50 });
    expect(none).toEqual([]);
  });

  it('counts every fee state in one pass, so the filter chips can carry numbers', async () => {
    const counts = await reader.memberCounts(gymId, TODAY);

    expect(counts).toEqual({ total: 5, PAID: 3, DUE_SOON: 0, EXPIRED: 1, NONE: 1 });
  });

  it('does not count or list another gym’s members', async () => {
    const otherGym = `${gymId}_other`;
    await prisma.gym.create({
      data: { id: otherGym, slug: otherGym, name: 'Other', phone: '+919000000013', addressLine: 'T', city: 'T', state: 'T', pincode: '000000', settings: {} },
    });
    await prisma.member.create({
      data: { id: `mem_it_mlist_${run}_other`, gymId: otherGym, fullName: 'Aaaa Stranger', mobile: '+919000599999', gender: 'MALE', status: 'ACTIVE', source: 'WALK_IN' },
    });

    expect((await reader.memberCounts(gymId, TODAY)).total).toBe(5);
    expect((await reader.members(gymId, TODAY, { limit: 50 })).map((m) => m.fullName)).not.toContain('Aaaa Stranger');

    await prisma.member.deleteMany({ where: { gymId: otherGym } });
    await prisma.gym.deleteMany({ where: { id: otherGym } });
  });
});
