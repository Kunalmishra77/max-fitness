import type { FeeState, Gender, ISTDate, MemberStatus } from '@mfp/shared';
import type { PrismaClient } from '../client';
import { fromDbDate, toDbDate } from '../dates';

/**
 * What the CRM screens read (crm-ux-blueprint §3–§5).
 *
 * Fee state comes from the `member_fee_at(date)` read model rather than being computed
 * per member in the app: a list of 200 members is then one indexed query (ADR-013).
 * Nothing here writes, and nothing here decides a rule.
 */

export interface DashboardCounts {
  readonly activeMembers: number;
  readonly attendedToday: number;
  readonly dueThisWeek: number;
  readonly dueThisWeekPaise: number;
  readonly expired: number;
  readonly callsToday: number;
  readonly birthdaysToday: number;
  readonly verificationsPending: number;
  readonly unreadAlerts: number;
  readonly collectedThisMonthPaise: number;
  readonly collectedLastMonthPaise: number;
  /** The trial (ADR-088): on one today, finished and not joined, and converted this month. */
  readonly trialsRunning: number;
  readonly trialsFinishedNotJoined: number;
  readonly trialsConvertedThisMonth: number;
}

export interface MemberListItem {
  readonly id: string;
  readonly fullName: string;
  readonly memberCode: string | null;
  readonly mobile: string;
  readonly status: MemberStatus;
  readonly gender: Gender;
  readonly feeState: FeeState;
  readonly daysLeft: number | null;
  readonly effectiveEndDate: ISTDate | null;
  readonly photoKey: string | null;
  /** When they first joined the gym, which may be long before this system existed. */
  readonly joinedOn: ISTDate | null;
  /** Morning, evening or both — the gym shuts between noon and five (ADR-082). */
  readonly trainingSlot: string | null;
  /** Length of the newest plan, for the list's "Plan" column (ADR-086). */
  readonly planMonths: number | null;
  /** The newest membership is a paid trial, which the list says instead of a plan (ADR-088). */
  readonly onTrial: boolean;
  readonly trialDays: number | null;
  /** Last check-in, so the list can say who has stopped coming without a second query. */
  readonly lastAttendanceAt: Date | null;
}

export interface MemberProfile extends MemberListItem {
  readonly dob: ISTDate | null;
  readonly email: string | null;
  readonly whatsappOptIn: boolean;
  readonly isMinor: boolean;
  readonly notes: string | null;
  readonly memberships: ReadonlyArray<{
    readonly id: string;
    readonly durationMonths: number | null;
    readonly startDate: ISTDate | null;
    readonly endDate: ISTDate;
    readonly status: string;
    /** What was paid, or what the member declared at the QR (ADR-086). */
    readonly pricePaise: number;
    /** True when it came from the QR or the register rather than a payment. */
    readonly isDeclared: boolean;
    /** A paid trial rather than a plan (ADR-088). */
    readonly isTrial: boolean;
    readonly trialDays: number | null;
  }>;
  /** Personal training this member has bought, newest first (ADR-087). */
  readonly ptEnrolments: ReadonlyArray<{
    readonly id: string;
    readonly durationMonths: number;
    readonly startDate: ISTDate;
    readonly endDate: ISTDate;
    readonly status: string;
    readonly pricePaise: number;
  }>;
  /** Which card the member showed at the QR, and a photograph of each side (ADR-074). */
  readonly govIdType: string | null;
  /**
   * What the member said about themselves at the QR, while it is still waiting to be checked.
   *
   * A QR existing-member is `PENDING_VERIFICATION` with no membership until staff approve
   * them (ADR-075), so the profile has nothing to show under "Plan" — and said "not given",
   * which reads as the form having thrown the answer away. It did not: it is here, and it
   * becomes a membership the moment somebody approves it.
   */
  readonly declared: {
    readonly referenceCode: string;
    readonly planMonths: number | null;
    readonly endDate: ISTDate | null;
    readonly amountPaise: number | null;
  } | null;
  readonly govIdPhotos: readonly { readonly side: string; readonly storageKey: string }[];
  readonly payments: ReadonlyArray<{
    readonly id: string;
    readonly amountPaise: number;
    readonly method: string;
    readonly status: string;
    readonly receiptNo: string | null;
    readonly paidAt: Date | null;
  }>;
  /**
   * The member's standing instruction, newest first, whatever its state (ADR-105).
   *
   * Deliberately not filtered to the live statuses: a halted mandate is precisely what the
   * desk needs to see, because it is the one state where nothing else about the member looks
   * wrong while the fee is no longer arriving.
   */
  readonly mandate: {
    readonly id: string;
    readonly status: string;
    readonly amountPaise: number;
    readonly intervalMonths: number;
    /** The link to authorise on, while Razorpay still considers it usable. */
    readonly shortUrl: string | null;
    readonly nextChargeOn: ISTDate | null;
    readonly authorisedAt: Date | null;
    readonly lastChargedAt: Date | null;
    readonly chargeCount: number;
    readonly failureReason: string | null;
  } | null;
  /** Days this month the member came in, for the calendar dots. */
  readonly attendanceDays: readonly number[];
  /**
   * Every month the member has ever come in, newest first (owner, 2026-10-07).
   *
   * The profile used to show the current month and nothing else, so a member's whole history
   * was in the database and invisible — and "has this member been coming?" is the question
   * the screen exists to answer. Days rather than visits, because one visit a day is the
   * rule (ADR-108), and a count of visits would be the same number with a misleading name.
   */
  readonly attendanceByMonth: ReadonlyArray<{ readonly month: ISTDate; readonly days: number }>;
  /** How many days in all, so the heading can say it without adding the months up. */
  readonly attendanceTotalDays: number;
}

export interface AttendanceTodayItem {
  readonly id: string;
  readonly memberId: string;
  readonly fullName: string;
  readonly memberCode: string | null;
  readonly capturedAt: Date;
  readonly method: string;
  /** What they owe, so the desk can ask while they are standing there (ADR-097). */
  readonly feeState: FeeState;
  readonly daysLeft: number | null;
}

export interface AbsentMemberItem {
  readonly id: string;
  readonly fullName: string;
  readonly memberCode: string | null;
  readonly mobile: string;
  readonly feeState: FeeState;
  /** `null` when they have never checked in at all. */
  readonly daysAway: number | null;
}

export interface LeadItem {
  readonly id: string;
  readonly name: string;
  readonly mobile: string;
  readonly goal: string | null;
  readonly source: string;
  readonly status: string;
  readonly notes: string | null;
  readonly followUpAt: Date | null;
  readonly createdAt: Date;
  readonly convertedMemberId: string | null;
}

export interface CallTaskItem {
  readonly id: string;
  readonly reason: string;
  readonly priority: number;
  readonly dueDate: ISTDate;
  readonly member: { readonly id: string; readonly fullName: string; readonly mobile: string; readonly feeState: FeeState } | null;
}

interface FeeRow {
  memberId: string;
  feeState: string;
  daysLeft: number | null;
  effectiveEndDate: Date | null;
}

export class PrismaCrmReader {
  readonly #prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.#prisma = prisma;
  }

  #feeStates(gymId: string, today: ISTDate): Promise<FeeRow[]> {
    return this.#prisma.$queryRaw<FeeRow[]>`
      SELECT "memberId", "feeState", "daysLeft", "effectiveEndDate"
      FROM "member_fee_at"(${today}::date)
      WHERE "gymId" = ${gymId}
    `;
  }

  async dashboard(gymId: string, today: ISTDate, monthStart: ISTDate, lastMonthStart: ISTDate): Promise<DashboardCounts> {
    const [day, month] = [Number(today.slice(8, 10)), Number(today.slice(5, 7))];

    const [fees, activeMembers, attendance, callsToday, birthdaysToday, verificationsPending, unreadAlerts, thisMonth, lastMonth, dueSoonPlans, trials] =
      await Promise.all([
        this.#feeStates(gymId, today),
        this.#prisma.member.count({ where: { gymId, status: 'ACTIVE', deletedAt: null } }),
        this.#prisma.attendanceEvent.findMany({
          // `attendanceDate` is the IST business date the check-in counts for (BR-9).
          where: { gymId, attendanceDate: toDbDate(today), voidedAt: null },
          select: { memberId: true },
          distinct: ['memberId'],
        }),
        this.#prisma.callTask.count({ where: { gymId, status: 'OPEN', dueDate: { lte: toDbDate(today) } } }),
        this.#prisma.$queryRaw<Array<{ count: bigint }>>`
          SELECT COUNT(*)::bigint AS count FROM "Member"
          WHERE "gymId" = ${gymId} AND "deletedAt" IS NULL AND "status" = 'ACTIVE'
            AND EXTRACT(MONTH FROM "dob") = ${month} AND EXTRACT(DAY FROM "dob") = ${day}
        `,
        this.#prisma.verificationRequest.count({ where: { gymId, status: 'PENDING' } }),
        this.#prisma.alert.count({ where: { gymId, readAt: null } }),
        this.#prisma.payment.aggregate({ where: { gymId, status: 'PAID', paidAt: { gte: new Date(`${monthStart}T00:00:00+05:30`) } }, _sum: { amountPaise: true } }),
        this.#prisma.payment.aggregate({
          where: {
            gymId,
            status: 'PAID',
            paidAt: { gte: new Date(`${lastMonthStart}T00:00:00+05:30`), lt: new Date(`${monthStart}T00:00:00+05:30`) },
          },
          _sum: { amountPaise: true },
        }),
        this.#prisma.membership.findMany({
          where: { gymId, status: 'CONFIRMED' },
          select: { memberId: true, pricePaise: true, endDate: true },
          orderBy: { endDate: 'desc' },
        }),
        // Every confirmed trial, with whether that member has ever bought a plan. Three
        // numbers come out of it: on a trial today, finished without joining, and joined
        // this month after one (ADR-088).
        this.#prisma.membership.findMany({
          where: { gymId, isTrial: true, status: 'CONFIRMED' },
          select: {
            memberId: true,
            startDate: true,
            endDate: true,
            member: {
              select: {
                memberships: {
                  where: { isTrial: false, status: 'CONFIRMED' },
                  select: { confirmedAt: true },
                  orderBy: { confirmedAt: 'asc' },
                  take: 1,
                },
              },
            },
          },
        }),
      ]);

    const dueSoon = fees.filter((f) => f.feeState === 'DUE_SOON');
    const dueSoonIds = new Set(dueSoon.map((f) => f.memberId));
    // What each due-soon member last paid is the best estimate of what they will pay again.
    const expected = new Map<string, number>();
    for (const membership of dueSoonPlans) {
      if (dueSoonIds.has(membership.memberId) && !expected.has(membership.memberId)) expected.set(membership.memberId, membership.pricePaise);
    }

    // "Running" is by date, not status: a trial whose last day has passed is finished,
    // whatever the row still says. "Converted" counts the plan they bought after it.
    const monthStartDate = toDbDate(monthStart);
    const todayDate = toDbDate(today);
    const joinedAt = (trial: (typeof trials)[number]) => trial.member.memberships[0]?.confirmedAt ?? null;
    const trialsRunning = trials.filter((trial) => trial.startDate !== null && trial.startDate <= todayDate && trial.endDate >= todayDate).length;
    const trialsFinishedNotJoined = trials.filter((trial) => trial.endDate < todayDate && joinedAt(trial) === null).length;
    const trialsConvertedThisMonth = trials.filter((trial) => {
      const joined = joinedAt(trial);
      return joined !== null && joined >= monthStartDate;
    }).length;

    return {
      activeMembers,
      attendedToday: attendance.length,
      dueThisWeek: dueSoon.length,
      dueThisWeekPaise: [...expected.values()].reduce((sum, paise) => sum + paise, 0),
      expired: fees.filter((f) => f.feeState === 'EXPIRED').length,
      callsToday,
      birthdaysToday: Number(birthdaysToday[0]?.count ?? 0),
      verificationsPending,
      unreadAlerts,
      collectedThisMonthPaise: thisMonth._sum.amountPaise ?? 0,
      collectedLastMonthPaise: lastMonth._sum.amountPaise ?? 0,
      trialsRunning,
      trialsFinishedNotJoined,
      trialsConvertedThisMonth,
    };
  }

  /** Members with their fee state, newest first, filtered by a search box and fee state. */
  /**
   * How many members are in each fee state (ADR-097).
   *
   * One pass over the same function the list uses, so the filter chips can carry numbers
   * without a query each. "Expired" with a 12 beside it saves reception a tap and, more
   * to the point, tells them there is something to do before they go looking.
   */
  async memberCounts(gymId: string, today: ISTDate): Promise<{ total: number } & Record<FeeState, number>> {
    const rows = await this.#feeStates(gymId, today);
    const counts = { total: rows.length, PAID: 0, DUE_SOON: 0, EXPIRED: 0, NONE: 0 };
    for (const row of rows) {
      const state = row.feeState as FeeState;
      if (state in counts) counts[state] += 1;
    }
    return counts;
  }

  async members(
    gymId: string,
    today: ISTDate,
    options: { search?: string; feeState?: FeeState; status?: MemberStatus; limit?: number } = {},
  ): Promise<MemberListItem[]> {
    const search = (options.search ?? '').trim();
    const digits = search.replace(/\D/g, '');

    // The fee states come first so the filter can go **into** the query (ADR-097). It used
    // to run in JavaScript after `take`, which meant asking for expired members returned
    // only the expired ones among the alphabetically-first page — at a hundred and fifty
    // members that silently hides people who owe money, which is what this screen is for.
    const fees = new Map((await this.#feeStates(gymId, today)).map((f) => [f.memberId, f]));
    const matching = options.feeState === undefined ? null : [...fees.entries()].filter(([, f]) => f.feeState === options.feeState).map(([id]) => id);

    const rows = matching !== null && matching.length === 0 ? [] : await this.#prisma.member.findMany({
      where: {
        gymId,
        deletedAt: null,
        ...(matching === null ? {} : { id: { in: matching } }),
        ...(options.status === undefined ? {} : { status: options.status }),
        ...(search === ''
          ? {}
          : {
              OR: [
                { fullName: { contains: search, mode: 'insensitive' } },
                { memberCode: { contains: search, mode: 'insensitive' } },
                ...(digits.length >= 3 ? [{ mobile: { contains: digits } }] : []),
              ],
            }),
      },
      select: {
        id: true,
        fullName: true,
        memberCode: true,
        mobile: true,
        status: true,
        gender: true,
        joinedOn: true,
        trainingSlot: true,
        lastAttendanceAt: true,
        photo: { select: { storageKey: true, deletedAt: true } },
        // Newest plan only: the list shows what they are on now, not their history.
        memberships: { select: { durationMonths: true, isTrial: true, trialDays: true }, orderBy: { endDate: 'desc' }, take: 1 },
      },
      orderBy: { fullName: 'asc' },
      take: options.limit ?? 50,
    });

    return rows
      .map((row) => {
        const fee = fees.get(row.id);
        return {
          id: row.id,
          fullName: row.fullName,
          memberCode: row.memberCode,
          mobile: row.mobile,
          status: row.status,
          gender: row.gender,
          feeState: (fee?.feeState ?? 'NONE') as FeeState,
          daysLeft: fee?.daysLeft ?? null,
          effectiveEndDate: fee?.effectiveEndDate == null ? null : fromDbDate(fee.effectiveEndDate),
          photoKey: row.photo === null || row.photo.deletedAt !== null ? null : row.photo.storageKey,
          joinedOn: row.joinedOn === null ? null : fromDbDate(row.joinedOn),
          trainingSlot: row.trainingSlot,
          planMonths: row.memberships[0]?.durationMonths ?? null,
          onTrial: row.memberships[0]?.isTrial ?? false,
          trialDays: row.memberships[0]?.trialDays ?? null,
          lastAttendanceAt: row.lastAttendanceAt,
        };
      });
  }

  async member(gymId: string, memberId: string, today: ISTDate): Promise<MemberProfile | null> {
    const member = await this.#prisma.member.findFirst({
      where: { id: memberId, gymId, deletedAt: null },
      select: {
        id: true,
        fullName: true,
        memberCode: true,
        mobile: true,
        status: true,
        gender: true,
        dob: true,
        email: true,
        joinedOn: true,
        trainingSlot: true,
        lastAttendanceAt: true,
        whatsappOptIn: true,
        isMinor: true,
        notes: true,
        photo: { select: { storageKey: true, deletedAt: true } },
        media: {
          where: { kind: 'GOV_ID', deletedAt: null },
          orderBy: { createdAt: 'asc' },
          select: { label: true, storageKey: true },
        },
        verifications: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          // What the member declared at the QR, not only which card they showed. A member
          // who filled the form in is PENDING_VERIFICATION with no membership until staff
          // approve them, and the profile used to say "Plan: not given" — which reads as
          // the form having lost it (owner, 2026-10-07).
          select: {
            govIdType: true,
            status: true,
            referenceCode: true,
            declaredPlanMonths: true,
            declaredEndDate: true,
            declaredAmountPaise: true,
          },
        },
        memberships: {
          select: { id: true, durationMonths: true, startDate: true, endDate: true, status: true, pricePaise: true, isDeclared: true, isTrial: true, trialDays: true },
          orderBy: { endDate: 'desc' },
          take: 10,
        },
        ptEnrolments: {
          select: { id: true, durationMonths: true, startDate: true, endDate: true, status: true, pricePaise: true },
          orderBy: { endDate: 'desc' },
          take: 10,
        },
        payments: {
          select: { id: true, amountPaise: true, method: true, status: true, receiptNo: true, paidAt: true },
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
        // Autopay (ADR-105). The newest one, whatever its state — a halted or cancelled
        // mandate is exactly what the desk needs to see, so this is not filtered to the
        // live statuses the reminder engine cares about.
        mandates: {
          select: {
            id: true,
            status: true,
            amountPaise: true,
            intervalMonths: true,
            shortUrl: true,
            nextChargeOn: true,
            authorisedAt: true,
            lastChargedAt: true,
            chargeCount: true,
            failureReason: true,
          },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });
    if (member === null) return null;

    const monthStart = toDbDate(`${today.slice(0, 8)}01` as ISTDate);
    const [fees, attendance, allVisits] = await Promise.all([
      this.#feeStates(gymId, today),
      this.#prisma.attendanceEvent.findMany({
        where: { memberId, attendanceDate: { gte: monthStart }, voidedAt: null },
        select: { attendanceDate: true },
      }),
      // The whole history. A gym member visiting every day for five years is under two
      // thousand rows of one date each, so this is a small read — and the alternative, a
      // grouped query, would have to be raw SQL for a shape the page then has to re-sort.
      this.#prisma.attendanceEvent.findMany({
        where: { memberId, voidedAt: null },
        select: { attendanceDate: true },
        orderBy: { attendanceDate: 'desc' },
      }),
    ]);

    // Distinct days first, then grouped: two check-ins on one day are one day, and a visit
    // recorded before the one-a-day rule existed must not count twice now.
    const everyDay = new Set(allVisits.map((visit) => fromDbDate(visit.attendanceDate)));
    const byMonth = new Map<string, number>();
    for (const day of everyDay) byMonth.set(day.slice(0, 7), (byMonth.get(day.slice(0, 7)) ?? 0) + 1);
    const fee = fees.find((f) => f.memberId === memberId);

    return {
      id: member.id,
      fullName: member.fullName,
      memberCode: member.memberCode,
      mobile: member.mobile,
      status: member.status,
      gender: member.gender,
      feeState: (fee?.feeState ?? 'NONE') as FeeState,
      daysLeft: fee?.daysLeft ?? null,
      effectiveEndDate: fee?.effectiveEndDate == null ? null : fromDbDate(fee.effectiveEndDate),
      photoKey: member.photo === null || member.photo.deletedAt !== null ? null : member.photo.storageKey,
      dob: member.dob === null ? null : fromDbDate(member.dob),
      email: member.email,
      joinedOn: member.joinedOn === null ? null : fromDbDate(member.joinedOn),
      trainingSlot: member.trainingSlot,
      planMonths: member.memberships[0]?.durationMonths ?? null,
      onTrial: member.memberships[0]?.isTrial ?? false,
      trialDays: member.memberships[0]?.trialDays ?? null,
      lastAttendanceAt: member.lastAttendanceAt,
      whatsappOptIn: member.whatsappOptIn,
      isMinor: member.isMinor,
      notes: member.notes,
      govIdType: member.verifications[0]?.govIdType ?? null,
      // Only while it is still waiting. Once approved it becomes a real membership, and
      // showing the declaration beside it would be the same fact twice.
      declared:
        member.verifications[0] === undefined || member.verifications[0].status !== 'PENDING'
          ? null
          : {
              referenceCode: member.verifications[0].referenceCode,
              planMonths: member.verifications[0].declaredPlanMonths,
              endDate: member.verifications[0].declaredEndDate === null ? null : fromDbDate(member.verifications[0].declaredEndDate),
              amountPaise: member.verifications[0].declaredAmountPaise,
            },
      // The label is written as "<card>-<side>"; only the side is needed here, because
      // the card is named once above the photographs.
      govIdPhotos: member.media.map((file) => ({
        side: (file.label ?? '').split('-').pop()?.toUpperCase() ?? '',
        storageKey: file.storageKey,
      })),
      memberships: member.memberships.map((m) => ({
        id: m.id,
        durationMonths: m.durationMonths,
        startDate: m.startDate === null ? null : fromDbDate(m.startDate),
        endDate: fromDbDate(m.endDate),
        status: m.status,
        pricePaise: m.pricePaise,
        isDeclared: m.isDeclared,
        isTrial: m.isTrial,
        trialDays: m.trialDays,
      })),
      ptEnrolments: member.ptEnrolments.map((pt) => ({
        id: pt.id,
        durationMonths: pt.durationMonths,
        startDate: fromDbDate(pt.startDate),
        endDate: fromDbDate(pt.endDate),
        status: pt.status,
        pricePaise: pt.pricePaise,
      })),
      payments: member.payments,
      mandate:
        member.mandates[0] === undefined
          ? null
          : {
              ...member.mandates[0],
              nextChargeOn: member.mandates[0].nextChargeOn === null ? null : fromDbDate(member.mandates[0].nextChargeOn),
            },
      attendanceDays: [...new Set(attendance.map((a) => Number(fromDbDate(a.attendanceDate).slice(8, 10))))],
      attendanceByMonth: [...byMonth.entries()]
        .sort((a, b) => b[0].localeCompare(a[0]))
        .map(([month, days]) => ({ month: `${month}-01` as ISTDate, days })),
      attendanceTotalDays: everyDay.size,
    };
  }

  /** Who came in today, most recent first (crm-ux-blueprint §11). Voided check-ins are gone. */
  /**
   * Today's arrivals, each with what they owe (ADR-097).
   *
   * The fee state rides along because a member whose membership has lapsed walking through
   * the door is the easiest collection the gym will get all day — and the list used to show
   * a name and a time, which told reception nothing they could act on.
   */
  async attendanceToday(gymId: string, today: ISTDate, limit = 200): Promise<AttendanceTodayItem[]> {
    const [rows, fees] = await Promise.all([
      this.#prisma.attendanceEvent.findMany({
        where: { gymId, attendanceDate: toDbDate(today), voidedAt: null },
        select: { id: true, memberId: true, capturedAt: true, method: true, member: { select: { fullName: true, memberCode: true } } },
        orderBy: { capturedAt: 'desc' },
        take: limit,
      }),
      this.#feeStates(gymId, today),
    ]);
    const feeByMember = new Map(fees.map((f) => [f.memberId, f]));

    return rows.map((row) => {
      const fee = feeByMember.get(row.memberId);
      return {
        id: row.id,
        memberId: row.memberId,
        fullName: row.member.fullName,
        memberCode: row.member.memberCode,
        capturedAt: row.capturedAt,
        method: row.method,
        feeState: (fee?.feeState ?? 'NONE') as FeeState,
        daysLeft: fee?.daysLeft ?? null,
      };
    });
  }

  /**
   * "नहीं आ रहे" — members who are paid up but have stopped coming (crm-ux-blueprint §11).
   *
   * These are the ones worth a call before their membership lapses, which is why the
   * tab exists at all; an expired member is already on the fees list.
   */
  async absentMembers(gymId: string, today: ISTDate, days: number, limit = 50): Promise<AbsentMemberItem[]> {
    const startOfToday = new Date(`${today}T00:00:00+05:30`);
    const cutoff = new Date(startOfToday.getTime() - days * 86_400_000);

    const [rows, fees] = await Promise.all([
      this.#prisma.member.findMany({
        where: {
          gymId,
          deletedAt: null,
          status: 'ACTIVE',
          OR: [{ lastAttendanceAt: null }, { lastAttendanceAt: { lt: cutoff } }],
        },
        select: { id: true, fullName: true, memberCode: true, mobile: true, lastAttendanceAt: true },
        orderBy: [{ lastAttendanceAt: 'asc' }, { fullName: 'asc' }],
        take: limit * 3,
      }),
      this.#feeStates(gymId, today),
    ]);

    const feeByMember = new Map(fees.map((fee) => [fee.memberId, fee.feeState as FeeState]));
    return rows
      .map((row) => ({
        id: row.id,
        fullName: row.fullName,
        memberCode: row.memberCode,
        mobile: row.mobile,
        feeState: feeByMember.get(row.id) ?? 'NONE',
        daysAway: row.lastAttendanceAt === null ? null : Math.floor((startOfToday.getTime() - row.lastAttendanceAt.getTime()) / 86_400_000),
      }))
      .filter((member) => member.feeState === 'PAID' || member.feeState === 'DUE_SOON')
      .slice(0, limit);
  }

  /**
   * Enquiries, newest first (BR-10.1).
   *
   * "Open" is everything that has not converted or been lost — the ones still worth a
   * call. The owner sees the whole list on the other tab.
   */
  async leads(gymId: string, options: { open?: boolean; limit?: number } = {}): Promise<LeadItem[]> {
    const rows = await this.#prisma.lead.findMany({
      where: { gymId, ...(options.open === true ? { status: { notIn: ['CONVERTED', 'LOST'] } } : {}) },
      select: {
        id: true,
        name: true,
        mobile: true,
        goal: true,
        source: true,
        status: true,
        notes: true,
        followUpAt: true,
        createdAt: true,
        convertedMemberId: true,
      },
      orderBy: { createdAt: 'desc' },
      take: options.limit ?? 100,
    });
    return rows;
  }

  /**
   * How many distinct members came in on each of the last `days` business days (ADR-095).
   *
   * Distinct per day, because one member scanning twice is one arrival, and keyed on
   * `attendanceDate` — the IST business date the check-in counts for — so a 1 am visit
   * lands on the night it belongs to rather than the morning after.
   */
  async attendanceByDay(gymId: string, today: ISTDate, days: number): Promise<Array<{ date: ISTDate; count: number }>> {
    const rows = await this.#prisma.$queryRaw<Array<{ date: Date; count: bigint }>>`
      SELECT "attendanceDate" AS date, COUNT(DISTINCT "memberId")::bigint AS count
      FROM "AttendanceEvent"
      WHERE "gymId" = ${gymId}
        AND "voidedAt" IS NULL
        AND "attendanceDate" > ${toDbDate(today)}::date - ${days}::int
        AND "attendanceDate" <= ${toDbDate(today)}::date
      GROUP BY "attendanceDate"
    `;
    return rows.map((row) => ({ date: row.date.toISOString().slice(0, 10) as ISTDate, count: Number(row.count) }));
  }

  /** Today's call list, most urgent first (BR-7 priority, then oldest). */
  async callTasks(gymId: string, today: ISTDate, limit = 25): Promise<CallTaskItem[]> {
    const [tasks, fees] = await Promise.all([
      this.#prisma.callTask.findMany({
        where: {
          gymId,
          status: 'OPEN',
          dueDate: { lte: toDbDate(today) },
          // "Call later" has to mean later: a snoozed task comes back on its own day (BR-7).
          OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: toDbDate(today) } }],
        },
        select: {
          id: true,
          reason: true,
          priority: true,
          dueDate: true,
          member: { select: { id: true, fullName: true, mobile: true } },
        },
        orderBy: [{ priority: 'asc' }, { dueDate: 'asc' }],
        take: limit,
      }),
      this.#feeStates(gymId, today),
    ]);
    const feeByMember = new Map(fees.map((f) => [f.memberId, f.feeState as FeeState]));

    return tasks.map((task) => ({
      id: task.id,
      reason: task.reason,
      priority: task.priority,
      dueDate: fromDbDate(task.dueDate),
      member:
        task.member === null
          ? null
          : { id: task.member.id, fullName: task.member.fullName, mobile: task.member.mobile, feeState: feeByMember.get(task.member.id) ?? 'NONE' },
    }));
  }
}
