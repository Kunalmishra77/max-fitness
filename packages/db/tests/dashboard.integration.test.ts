/**
 * The CRM home screen's numbers, against a real database (PERF-002).
 *
 * `dashboard()` is the heaviest read in the application and the first one every staff
 * member triggers, and nothing covered it. That mattered because two of its eleven
 * queries were unbounded: one fetched **every confirmed membership the gym had ever
 * sold** to work out what the due-soon members were likely to pay, and another fetched
 * **every trial ever run**, each with a correlated sub-select, to count three numbers.
 * Both were then reduced in JavaScript. At a hundred members that is invisible; after a
 * few years of renewals it is tens of thousands of rows crossing the network, twice a
 * minute, because the screen refreshes itself on a timer.
 *
 * This file pins what the screen says so the read can be rewritten as aggregates without
 * anybody having to trust that the numbers still come out the same. Every assertion here
 * was written against the original implementation and passed before it was touched.
 *
 * Everything is written under a throwaway gym and deleted afterwards.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { istDate, type ISTDate } from '@mfp/shared';
import { createPrismaClient, type PrismaClient } from '../src/client';
import { toDbDate } from '../src/dates';
import { PrismaCrmReader, type DashboardCounts } from '../src/repositories/crm-read.repository';
import { integrationSuite, testDatabaseUrl } from './support';

const run = randomBytes(5).toString('hex');
const gymId = `gym_it_dash_${run}`;
/** A second gym holding a copy of every row, so a missing `gymId` filter fails loudly. */
const otherGymId = `${gymId}_other`;

/** Fixed business dates, so nothing here depends on the wall clock (testing-strategy §2). */
const TODAY: ISTDate = istDate('2026-09-30');
const MONTH_START: ISTDate = istDate('2026-09-01');
const LAST_MONTH_START: ISTDate = istDate('2026-08-01');

const suite = integrationSuite('crm dashboard');

suite('crm dashboard counts against Postgres', () => {
  let prisma: PrismaClient;
  let reader: PrismaCrmReader;
  let counts: DashboardCounts;

  let seq = 0;
  /** A distinct E.164 number per member; `mobile` is not unique but duplicates confuse a failure. */
  const nextMobile = (): string => `+9190${String(900_000 + ++seq).padStart(8, '0')}`;

  async function member(
    key: string,
    options: { gym?: string; status?: 'ACTIVE' | 'LEFT'; dob?: ISTDate; deleted?: boolean } = {},
  ): Promise<string> {
    const gym = options.gym ?? gymId;
    const id = `mem_it_dash_${run}_${key}`;
    await prisma.member.create({
      data: {
        id,
        gymId: gym,
        fullName: `Dash ${key}`,
        mobile: nextMobile(),
        gender: 'MALE',
        status: options.status ?? 'ACTIVE',
        source: 'WALK_IN',
        ...(options.dob === undefined ? {} : { dob: toDbDate(options.dob) }),
        ...(options.deleted === true ? { deletedAt: new Date('2026-09-20T00:00:00Z') } : {}),
      },
    });
    return id;
  }

  async function membership(
    memberId: string,
    period: { from: ISTDate; to: ISTDate; pricePaise?: number; isTrial?: boolean; confirmedAt?: string; gym?: string },
  ): Promise<void> {
    await prisma.membership.create({
      data: {
        gymId: period.gym ?? gymId,
        memberId,
        status: 'CONFIRMED',
        source: 'WALK_IN',
        startDate: toDbDate(period.from),
        endDate: toDbDate(period.to),
        pricePaise: period.pricePaise ?? 0,
        isTrial: period.isTrial ?? false,
        ...(period.confirmedAt === undefined ? {} : { confirmedAt: new Date(period.confirmedAt) }),
      },
    });
  }

  beforeAll(async () => {
    prisma = createPrismaClient({ connectionString: testDatabaseUrl, poolMax: 4 });
    reader = new PrismaCrmReader(prisma);

    for (const id of [gymId, otherGymId]) {
      await prisma.gym.create({
        data: { id, slug: id, name: 'Dashboard test gym', phone: '+919000000013', addressLine: 'T', city: 'T', state: 'T', pincode: '000000', settings: {} },
      });
    }

    // ── Fee states ───────────────────────────────────────────────────────────────
    const paid = await member('paid');
    await membership(paid, { from: istDate('2026-01-01'), to: istDate('2026-12-31'), pricePaise: 300_000 });

    const dueA = await member('due_a');
    await membership(dueA, { from: MONTH_START, to: istDate('2026-10-03'), pricePaise: 150_000 });

    /**
     * A renewed member, and the reason this fixture exists: the expected-fee sum must use
     * the price of the **latest** membership, not the first or the dearest one found.
     */
    const dueB = await member('due_b');
    await membership(dueB, { from: istDate('2026-01-01'), to: istDate('2026-05-31'), pricePaise: 999_999 });
    await membership(dueB, { from: istDate('2026-09-05'), to: istDate('2026-10-05'), pricePaise: 200_000 });

    const expired = await member('expired');
    await membership(expired, { from: istDate('2026-07-01'), to: istDate('2026-08-31'), pricePaise: 120_000 });

    // No membership at all, and somebody who has left: neither owes a fee this week.
    await member('none');
    await member('left', { status: 'LEFT' });
    // Erased (BR privacy): must count nowhere, including the birthday query.
    await member('deleted', { dob: TODAY, deleted: true });

    const birthday = await member('birthday', { dob: istDate('1995-09-30') });
    await membership(birthday, { from: istDate('2026-01-01'), to: istDate('2026-12-31'), pricePaise: 300_000 });
    // Same day, different month — the birthday query must compare both parts.
    await member('birthday_other_month', { dob: istDate('1995-08-30') });

    // ── Trials (ADR-088) ─────────────────────────────────────────────────────────
    const trialRunning = await member('trial_running');
    await membership(trialRunning, { from: istDate('2026-09-28'), to: istDate('2026-10-02'), pricePaise: 50_000, isTrial: true });

    const trialFinished = await member('trial_finished');
    await membership(trialFinished, { from: MONTH_START, to: istDate('2026-09-10'), pricePaise: 50_000, isTrial: true });

    const trialConverted = await member('trial_converted');
    await membership(trialConverted, { from: MONTH_START, to: istDate('2026-09-05'), pricePaise: 50_000, isTrial: true });
    await membership(trialConverted, {
      from: istDate('2026-09-20'),
      to: istDate('2026-10-20'),
      pricePaise: 250_000,
      confirmedAt: '2026-09-20T10:00:00Z',
    });

    // A trial converted *last* month, which must not be counted in this month's number.
    const trialOld = await member('trial_old');
    await membership(trialOld, { from: istDate('2026-07-01'), to: istDate('2026-07-05'), pricePaise: 50_000, isTrial: true });
    await membership(trialOld, {
      from: istDate('2026-08-10'),
      to: istDate('2026-11-10'),
      pricePaise: 400_000,
      confirmedAt: '2026-08-10T10:00:00Z',
    });

    // ── Arrivals ─────────────────────────────────────────────────────────────────
    await prisma.attendanceEvent.createMany({
      data: [
        // Two check-ins by the same member count as one person on the floor.
        { gymId, memberId: paid, clientEventId: `${run}_a1`, method: 'FACE', capturedAt: new Date('2026-09-30T04:00:00Z'), attendanceDate: toDbDate(TODAY) },
        { gymId, memberId: paid, clientEventId: `${run}_a2`, method: 'FACE', capturedAt: new Date('2026-09-30T13:00:00Z'), attendanceDate: toDbDate(TODAY) },
        { gymId, memberId: dueA, clientEventId: `${run}_a3`, method: 'KEYPAD', capturedAt: new Date('2026-09-30T05:00:00Z'), attendanceDate: toDbDate(TODAY) },
        // Voided, and yesterday's: neither is somebody in the gym now.
        {
          gymId,
          memberId: expired,
          clientEventId: `${run}_a4`,
          method: 'MANUAL',
          capturedAt: new Date('2026-09-30T06:00:00Z'),
          attendanceDate: toDbDate(TODAY),
          voidedAt: new Date('2026-09-30T06:05:00Z'),
        },
        { gymId, memberId: expired, clientEventId: `${run}_a5`, method: 'FACE', capturedAt: new Date('2026-09-29T06:00:00Z'), attendanceDate: toDbDate(istDate('2026-09-29')) },
      ],
    });

    // ── Calls, approvals and alerts ──────────────────────────────────────────────
    await prisma.callTask.createMany({
      data: [
        { gymId, memberId: expired, reason: 'EXPIRED_NOT_RENEWED', priority: 1, status: 'OPEN', dueDate: toDbDate(TODAY) },
        // Overdue counts too: the list is everything due by today, not only today's.
        { gymId, memberId: dueA, reason: 'DUE_SOON_NO_RESPONSE', priority: 2, status: 'OPEN', dueDate: toDbDate(istDate('2026-09-25')) },
        { gymId, memberId: dueB, reason: 'DUE_SOON_NO_RESPONSE', priority: 2, status: 'OPEN', dueDate: toDbDate(istDate('2026-10-05')) },
        { gymId, memberId: paid, reason: 'OTHER', priority: 3, status: 'DONE', dueDate: toDbDate(TODAY) },
      ],
    });

    await prisma.verificationRequest.createMany({
      data: [
        { gymId, memberId: dueA, referenceCode: `Q-${run}-1`, declaredEndDate: toDbDate(istDate('2026-10-31')), status: 'PENDING' },
        { gymId, memberId: dueB, referenceCode: `Q-${run}-2`, declaredEndDate: toDbDate(istDate('2026-10-31')), status: 'PENDING' },
        { gymId, memberId: paid, referenceCode: `Q-${run}-3`, declaredEndDate: toDbDate(istDate('2026-10-31')), status: 'APPROVED' },
      ],
    });

    await prisma.alert.createMany({
      data: [
        { gymId, type: 'ONLINE_PAYMENT', title: 'alerts.onlinePayment' },
        { gymId, type: 'NEW_LEAD', title: 'alerts.newLead', readAt: new Date('2026-09-29T10:00:00Z') },
      ],
    });

    // ── Money ────────────────────────────────────────────────────────────────────
    await prisma.payment.createMany({
      data: [
        { gymId, memberId: paid, amountPaise: 300_000, method: 'CASH', status: 'PAID', paidAt: new Date('2026-09-15T10:00:00Z') },
        { gymId, memberId: dueB, amountPaise: 200_000, method: 'UPI_DIRECT', status: 'PAID', paidAt: new Date('2026-09-05T10:00:00Z') },
        { gymId, memberId: expired, amountPaise: 120_000, method: 'CASH', status: 'PAID', paidAt: new Date('2026-08-12T10:00:00Z') },
        // Not collected: a void and a never-completed order must not appear in either total.
        { gymId, memberId: paid, amountPaise: 999_999, method: 'CASH', status: 'VOIDED', paidAt: new Date('2026-09-16T10:00:00Z') },
        { gymId, memberId: paid, amountPaise: 888_888, method: 'RAZORPAY', status: 'CREATED' },
      ],
    });

    /**
     * The same shape again under another gym. Every count below is scoped to one gym, so
     * a query that forgets to say which fails here rather than on the owner's screen.
     */
    const otherPaid = await member('other_paid', { gym: otherGymId, dob: istDate('1990-09-30') });
    await membership(otherPaid, { from: MONTH_START, to: istDate('2026-10-02'), pricePaise: 777_777, gym: otherGymId });
    await prisma.alert.create({ data: { gymId: otherGymId, type: 'SYSTEM', title: 'alerts.system' } });
    await prisma.callTask.create({ data: { gymId: otherGymId, memberId: otherPaid, reason: 'OTHER', priority: 1, status: 'OPEN', dueDate: toDbDate(TODAY) } });
    await prisma.payment.create({ data: { gymId: otherGymId, memberId: otherPaid, amountPaise: 555_555, method: 'CASH', status: 'PAID', paidAt: new Date('2026-09-10T10:00:00Z') } });

    counts = await reader.dashboard(gymId, TODAY, MONTH_START, LAST_MONTH_START);
  });

  afterAll(async () => {
    if (prisma === undefined) return;
    const gyms = { in: [gymId, otherGymId] };
    await prisma.attendanceEvent.deleteMany({ where: { gymId: gyms } });
    await prisma.callTask.deleteMany({ where: { gymId: gyms } });
    await prisma.verificationRequest.deleteMany({ where: { gymId: gyms } });
    await prisma.alert.deleteMany({ where: { gymId: gyms } });
    await prisma.payment.deleteMany({ where: { gymId: gyms } });
    await prisma.membership.deleteMany({ where: { gymId: gyms } });
    await prisma.member.deleteMany({ where: { gymId: gyms } });
    await prisma.gym.deleteMany({ where: { id: gyms } });
    await prisma.$disconnect();
  });

  it('counts the members on the books, and nobody who has left or been erased', () => {
    // paid, due_a, due_b, expired, none, birthday, birthday_other_month,
    // trial_running, trial_finished, trial_converted, trial_old = 11.
    // Excluded: left (status) and deleted (deletedAt).
    expect(counts.activeMembers).toBe(11);
  });

  it('counts people in the gym today, not check-ins', () => {
    // Two taps by `paid` plus one by `due_a`; the voided one and yesterday's do not count.
    expect(counts.attendedToday).toBe(2);
  });

  it('counts the week’s fees due, and the expired', () => {
    // due_a (3 Oct), due_b (5 Oct) and trial_running (2 Oct) all end within seven days.
    expect(counts.dueThisWeek).toBe(3);
    // expired (31 Aug) and trial_finished (10 Sep). trial_old runs to 10 Nov, so it is paid.
    expect(counts.expired).toBe(2);
  });

  it('values the week’s fees from each member’s latest plan, not their dearest', () => {
    // 150000 (due_a) + 200000 (due_b's September plan, not its ₹9,999.99 January one)
    // + 50000 (trial_running).
    expect(counts.dueThisWeekPaise).toBe(400_000);
  });

  it('counts calls due by today, including overdue ones, and not the closed ones', () => {
    expect(counts.callsToday).toBe(2);
  });

  it('counts today’s birthdays by day and month, ignoring the year', () => {
    // `birthday` was born 30 September. The 30 August member and the erased member do not count.
    expect(counts.birthdaysToday).toBe(1);
  });

  it('counts what is waiting for somebody: approvals and unread alerts', () => {
    expect(counts.verificationsPending).toBe(2);
    expect(counts.unreadAlerts).toBe(1);
  });

  it('totals only money actually taken, by the month it was taken in', () => {
    expect(counts.collectedThisMonthPaise).toBe(500_000);
    expect(counts.collectedLastMonthPaise).toBe(120_000);
  });

  it('counts the trial by date and by what the member bought afterwards', () => {
    // Running today: 28 Sep – 2 Oct.
    expect(counts.trialsRunning).toBe(1);
    // Finished 10 Sep and never bought a plan.
    expect(counts.trialsFinishedNotJoined).toBe(1);
    // Converted on 20 September. `trial_old` converted in August and is not counted.
    expect(counts.trialsConvertedThisMonth).toBe(1);
  });

  it('answers for one gym only', async () => {
    const other = await reader.dashboard(otherGymId, TODAY, MONTH_START, LAST_MONTH_START);
    expect(other.activeMembers).toBe(1);
    expect(other.dueThisWeek).toBe(1);
    expect(other.dueThisWeekPaise).toBe(777_777);
    expect(other.callsToday).toBe(1);
    expect(other.unreadAlerts).toBe(1);
    expect(other.birthdaysToday).toBe(1);
    expect(other.collectedThisMonthPaise).toBe(555_555);
    expect(other.attendedToday).toBe(0);
  });
});
