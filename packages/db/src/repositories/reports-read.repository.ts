import type { MembershipForReport, MonthBounds, PaidRow } from '@mfp/core';
import { addDays, type ISTDate } from '@mfp/shared';
import type { PrismaClient } from '../client';
import { fromDbDate, toDbDate } from '../dates';

/**
 * The rows behind the owner's reports (crm-module-spec §6).
 *
 * This only fetches; `packages/core/src/reports` decides what the rows mean. Money is
 * bounded by the IST day a payment was made, attendance by its IST business date, and
 * leaving by the `leftAt` date — the same days the owner thinks in.
 */

export interface ReportInputs {
  readonly paidThisMonth: readonly PaidRow[];
  readonly paidLastMonth: readonly PaidRow[];
  /** Every confirmed membership: "first" and "within grace of the previous one" need history. */
  readonly memberships: readonly MembershipForReport[];
  readonly attendance: ReadonlyArray<{ readonly capturedAt: Date; readonly method: string }>;
  readonly leftByReason: ReadonlyArray<{ readonly reason: string; readonly count: number }>;
  readonly activeByGender: ReadonlyArray<{ readonly gender: string; readonly count: number }>;
  readonly planMix: ReadonlyArray<{ readonly durationMonths: number; readonly count: number }>;
  /** Personal training (ADR-087): running now, and what was sold this month. */
  readonly pt: {
    readonly running: number;
    readonly mix: ReadonlyArray<{ readonly durationMonths: number; readonly count: number }>;
    readonly soldThisMonth: number;
    readonly revenueThisMonthPaise: number;
  };
}

/** The first instant of an IST calendar day. */
const istStart = (date: ISTDate) => new Date(`${date}T00:00:00+05:30`);

export class PrismaReportsReader {
  readonly #prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.#prisma = prisma;
  }

  async inputs(
    gymId: string,
    month: MonthBounds,
    window: { readonly attendanceFrom: ISTDate; readonly attendanceTo: ISTDate; readonly planMixFrom: ISTDate },
  ): Promise<ReportInputs> {
    const paidBetween = (from: ISTDate, to: ISTDate) =>
      this.#prisma.payment.findMany({
        where: { gymId, status: 'PAID', paidAt: { gte: istStart(from), lt: istStart(addDays(to, 1)) } },
        select: { method: true, amountPaise: true },
      });

    const [paidThisMonth, paidLastMonth, memberships, attendance, left, genders, plans, ptRunning, ptSoldThisMonth] = await Promise.all([
      paidBetween(month.start, month.end),
      // Last month only up to the same day: a month so far is compared like with like.
      paidBetween(month.previousStart, month.previousToDate),
      this.#prisma.membership.findMany({
        where: { gymId, status: 'CONFIRMED', startDate: { not: null }, confirmedAt: { not: null } },
        select: { memberId: true, startDate: true, endDate: true, confirmedAt: true },
      }),
      this.#prisma.attendanceEvent.findMany({
        where: { gymId, voidedAt: null, attendanceDate: { gte: toDbDate(window.attendanceFrom), lte: toDbDate(window.attendanceTo) } },
        select: { capturedAt: true, method: true },
      }),
      this.#prisma.member.groupBy({
        by: ['leftReason'],
        where: { gymId, deletedAt: null, status: 'LEFT', leftAt: { gte: toDbDate(month.start), lte: toDbDate(month.end) } },
        _count: { _all: true },
      }),
      this.#prisma.member.groupBy({
        by: ['gender'],
        where: { gymId, deletedAt: null, status: 'ACTIVE' },
        _count: { _all: true },
      }),
      this.#prisma.membership.groupBy({
        by: ['durationMonths'],
        where: { gymId, status: 'CONFIRMED', durationMonths: { not: null }, confirmedAt: { gte: istStart(window.planMixFrom) } },
        _count: { _all: true },
      }),
      // Personal training (ADR-087): who is on one now, and what it was sold for in the
      // month. "Now" is by date rather than status, so a term that has run out is not
      // counted as a trainer the gym is providing.
      this.#prisma.ptEnrolment.groupBy({
        by: ['durationMonths'],
        where: { gymId, status: 'CONFIRMED', startDate: { lte: toDbDate(month.end) }, endDate: { gte: toDbDate(month.end) } },
        _count: { _all: true },
        _sum: { pricePaise: true },
      }),
      this.#prisma.ptEnrolment.aggregate({
        where: { gymId, status: 'CONFIRMED', confirmedAt: { gte: istStart(month.start), lt: istStart(addDays(month.end, 1)) } },
        _count: { _all: true },
        _sum: { pricePaise: true },
      }),
    ]);

    return {
      paidThisMonth,
      paidLastMonth,
      memberships: memberships.flatMap((row) =>
        row.startDate === null || row.confirmedAt === null
          ? []
          : [{ memberId: row.memberId, startDate: fromDbDate(row.startDate), endDate: fromDbDate(row.endDate), confirmedAt: row.confirmedAt }],
      ),
      attendance,
      leftByReason: left.map((row) => ({ reason: row.leftReason ?? 'OTHER', count: row._count._all })).sort((a, b) => b.count - a.count),
      activeByGender: genders.map((row) => ({ gender: row.gender, count: row._count._all })),
      planMix: plans
        .flatMap((row) => (row.durationMonths === null ? [] : [{ durationMonths: row.durationMonths, count: row._count._all }]))
        .sort((a, b) => a.durationMonths - b.durationMonths),
      pt: {
        running: ptRunning.reduce((total, row) => total + row._count._all, 0),
        mix: ptRunning.map((row) => ({ durationMonths: row.durationMonths, count: row._count._all })).sort((a, b) => a.durationMonths - b.durationMonths),
        soldThisMonth: ptSoldThisMonth._count._all,
        revenueThisMonthPaise: ptSoldThisMonth._sum.pricePaise ?? 0,
      },
    };
  }
}
