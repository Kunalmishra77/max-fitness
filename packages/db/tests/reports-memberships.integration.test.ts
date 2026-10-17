/**
 * The membership rows behind the owner's Reports screen (PERF-006).
 *
 * `inputs()` used to read **every confirmed membership the gym had ever sold** — one row
 * per renewal, for ever — each time Reports was opened, to produce four counters. It is
 * now scoped to the members who have something in the month being reported on, which is
 * sound because `membershipFlow` only ever increments a counter for a row whose
 * `confirmedAt` or whose `endDate` falls inside that month: a member with neither
 * contributes exactly zero.
 *
 * These tests are that argument, written so it cannot be broken by accident. The one
 * that matters is the third: a member whose entire history sits outside the month must be
 * left out of the read *and* must not change a single number.
 *
 * Everything is written under a throwaway gym and deleted afterwards.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { istDate, type ISTDate } from '@mfp/shared';
import { membershipFlow, type MonthBounds } from '@mfp/core';
import { createPrismaClient, type PrismaClient } from '../src/client';
import { toDbDate } from '../src/dates';
import { PrismaReportsReader } from '../src/repositories/reports-read.repository';
import { integrationSuite, testDatabaseUrl } from './support';

const run = randomBytes(5).toString('hex');
const gymId = `gym_it_rep_${run}`;

/** September 2026 is the month under report; today is late enough that its grace has run out. */
const TODAY: ISTDate = istDate('2026-10-20');
const MONTH: MonthBounds = {
  start: istDate('2026-09-01'),
  end: istDate('2026-09-30'),
  previousStart: istDate('2026-08-01'),
  previousEnd: istDate('2026-08-31'),
  previousToDate: istDate('2026-08-20'),
};
const WINDOW = { attendanceFrom: istDate('2026-09-01'), attendanceTo: istDate('2026-09-30'), planMixFrom: istDate('2026-01-01') };

const suite = integrationSuite('reports memberships');

suite('reports membership read against Postgres', () => {
  let prisma: PrismaClient;
  let reader: PrismaReportsReader;
  let seq = 0;

  async function member(key: string): Promise<string> {
    const id = `mem_it_rep_${run}_${key}`;
    await prisma.member.create({
      data: { id, gymId, fullName: `Report ${key}`, mobile: `+9190${String(920_000 + ++seq).padStart(8, '0')}`, gender: 'MALE', status: 'ACTIVE', source: 'WALK_IN' },
    });
    return id;
  }

  async function plan(memberId: string, from: ISTDate, to: ISTDate, confirmedAt: string): Promise<void> {
    await prisma.membership.create({
      data: {
        gymId,
        memberId,
        status: 'CONFIRMED',
        source: 'WALK_IN',
        startDate: toDbDate(from),
        endDate: toDbDate(to),
        confirmedAt: new Date(confirmedAt),
        pricePaise: 150_000,
        durationMonths: 1,
      },
    });
  }

  beforeAll(async () => {
    prisma = createPrismaClient({ connectionString: testDatabaseUrl, poolMax: 4 });
    reader = new PrismaReportsReader(prisma);
    await prisma.gym.create({
      data: { id: gymId, slug: gymId, name: 'Reports test gym', phone: '+919000000015', addressLine: 'T', city: 'T', state: 'T', pincode: '000000', settings: {} },
    });

    // Joined in September: their first ever plan, so one new member.
    const joined = await member('joined');
    await plan(joined, istDate('2026-09-05'), istDate('2026-10-04'), '2026-09-05T06:00:00Z');

    // Renewed in September, straight off the back of an August plan.
    const renewed = await member('renewed');
    await plan(renewed, istDate('2026-08-02'), istDate('2026-09-01'), '2026-08-02T06:00:00Z');
    await plan(renewed, istDate('2026-09-02'), istDate('2026-10-01'), '2026-09-02T06:00:00Z');

    // Ended in September and never came back: due for renewal, not renewed.
    const lapsed = await member('lapsed');
    await plan(lapsed, istDate('2026-08-10'), istDate('2026-09-09'), '2026-08-10T06:00:00Z');

    /**
     * The whole point. Years of history, none of it touching September: nothing confirmed
     * in the month and nothing ending in it. The old query dragged every one of these
     * rows across the network to contribute nothing.
     */
    const ancient = await member('ancient');
    await plan(ancient, istDate('2025-01-01'), istDate('2025-01-31'), '2025-01-01T06:00:00Z');
    await plan(ancient, istDate('2025-02-01'), istDate('2025-02-28'), '2025-02-01T06:00:00Z');
    await plan(ancient, istDate('2025-03-01'), istDate('2025-03-31'), '2025-03-01T06:00:00Z');
    await plan(ancient, istDate('2025-04-01'), istDate('2025-04-30'), '2025-04-01T06:00:00Z');
  });

  afterAll(async () => {
    if (prisma === undefined) return;
    await prisma.membership.deleteMany({ where: { gymId } });
    await prisma.member.deleteMany({ where: { gymId } });
    await prisma.gym.deleteMany({ where: { id: gymId } });
    await prisma.$disconnect();
  });

  it('reads only the members who have something in the month being reported on', async () => {
    const { memberships } = await reader.inputs(gymId, MONTH, WINDOW);

    // joined (1) + renewed (2) + lapsed (1) = 4. `ancient`'s four rows are not here.
    expect(memberships).toHaveLength(4);
    expect(memberships.map((m) => m.memberId).filter((id) => id.endsWith('_ancient'))).toEqual([]);
  });

  it('brings a member’s neighbouring history with them, which the counters need', async () => {
    const { memberships } = await reader.inputs(gymId, MONTH, WINDOW);

    // The renewer's August plan has neither a September `confirmedAt` nor a September
    // `endDate`... except it ends 1 September. Their two rows must both be present, or
    // "renewal" could not be told from "new".
    const theirs = memberships.filter((m) => m.memberId.endsWith('_renewed'));
    expect(theirs).toHaveLength(2);
    expect(theirs.map((m) => m.startDate).sort()).toEqual(['2026-08-02', '2026-09-02']);
  });

  it('produces the same four numbers as reading every membership ever would', async () => {
    const { memberships } = await reader.inputs(gymId, MONTH, WINDOW);
    const everything = await prisma.membership.findMany({
      where: { gymId, status: 'CONFIRMED', startDate: { not: null }, confirmedAt: { not: null } },
      select: { memberId: true, startDate: true, endDate: true, confirmedAt: true },
    });

    const win = { monthStart: MONTH.start, monthEnd: MONTH.end, today: TODAY, graceDays: 7 };
    const bounded = membershipFlow(memberships, win);
    const unbounded = membershipFlow(
      everything.map((r) => ({
        memberId: r.memberId,
        startDate: istDate(r.startDate!.toISOString().slice(0, 10)),
        endDate: istDate(r.endDate.toISOString().slice(0, 10)),
        confirmedAt: r.confirmedAt!,
      })),
      win,
    );

    expect(bounded).toEqual(unbounded);
    // And the numbers are the ones the fixtures describe, so a change of meaning fails
    // here rather than passing because both sides broke the same way.
    expect(bounded.newMembers).toBe(1);
    expect(bounded.renewals).toBe(1);
    expect(bounded.renewalRate.due).toBe(2);
    expect(bounded.renewalRate.renewed).toBe(1);
  });
});
