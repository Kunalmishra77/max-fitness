import {
  addDays,
  addMonthsClamped,
  compareISTDates,
  dayOfWeek,
  diffDays,
  istDateOf,
  minISTDate,
  toISTDate,
  toISTTime,
  type ISTDate,
} from '@mfp/shared';

/**
 * The owner's reports (crm-module-spec §6; crm-ux-blueprint §13).
 *
 * The database adds things up; these decide what the sums mean. Everything here is
 * pure: the reader hands over rows, and these turn them into the numbers on the cards.
 */

// ── Months ──────────────────────────────────────────────────────────────────

export interface MonthBounds {
  readonly start: ISTDate;
  readonly end: ISTDate;
  readonly previousStart: ISTDate;
  readonly previousEnd: ISTDate;
  /**
   * Last month up to today's day of the month (or its last day, if shorter).
   *
   * A month so far must be compared like with like: on the 14th, fourteen days of this
   * month against all of last month would read "less" almost every time.
   */
  readonly previousToDate: ISTDate;
}

/** This month and last month, as IST calendar dates (BR-1.2). */
export function monthBounds(today: ISTDate): MonthBounds {
  const start = istDateOf(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 1);
  const previousStart = addMonthsClamped(start, -1);
  const previousEnd = addDays(start, -1);
  return {
    start,
    end: addDays(addMonthsClamped(start, 1), -1),
    previousStart,
    previousEnd,
    previousToDate: minISTDate(addDays(previousStart, Number(today.slice(8, 10)) - 1), previousEnd),
  };
}

// ── Shares ──────────────────────────────────────────────────────────────────

/**
 * Whole percentages that always add up to 100 (largest remainder).
 *
 * Rounding each share on its own gives a plan mix of 33 + 33 + 33 = 99, and the owner
 * rightly asks where the other one went.
 */
export function largestRemainderShares(counts: readonly number[]): number[] {
  const total = counts.reduce((sum, count) => sum + count, 0);
  if (total === 0) return counts.map(() => 0);

  const exact = counts.map((count) => (count * 100) / total);
  const shares = exact.map(Math.floor);
  let remaining = 100 - shares.reduce((sum, share) => sum + share, 0);

  const byRemainder = exact.map((value, index) => ({ index, remainder: value - Math.floor(value) })).sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (const { index } of byRemainder) {
    if (remaining <= 0) break;
    shares[index] = (shares[index] ?? 0) + 1;
    remaining -= 1;
  }
  return shares;
}

// ── Money ───────────────────────────────────────────────────────────────────

export interface PaidRow {
  readonly method: string;
  readonly amountPaise: number;
}

export interface MoneyReport {
  readonly totalPaise: number;
  readonly lastMonthPaise: number;
  readonly deltaPaise: number;
  readonly byMethod: ReadonlyArray<{ readonly method: string; readonly amountPaise: number; readonly share: number }>;
  /** Demo-gateway payments: shown apart and never added to income (ADR-037). */
  readonly demoPaise: number;
}

const DEMO_METHOD = 'SIMULATED';

const sumPaise = (rows: readonly PaidRow[]) => rows.reduce((sum, row) => sum + row.amountPaise, 0);

export function moneyByMethod(input: { readonly thisMonth: readonly PaidRow[]; readonly lastMonth: readonly PaidRow[] }): MoneyReport {
  const real = input.thisMonth.filter((row) => row.method !== DEMO_METHOD);

  const totals = new Map<string, number>();
  for (const row of real) totals.set(row.method, (totals.get(row.method) ?? 0) + row.amountPaise);
  const sorted = [...totals.entries()].sort((a, b) => b[1] - a[1]);
  const shares = largestRemainderShares(sorted.map(([, amount]) => amount));

  const totalPaise = sumPaise(real);
  const lastMonthPaise = sumPaise(input.lastMonth.filter((row) => row.method !== DEMO_METHOD));

  return {
    totalPaise,
    lastMonthPaise,
    deltaPaise: totalPaise - lastMonthPaise,
    byMethod: sorted.map(([method, amountPaise], index) => ({ method, amountPaise, share: shares[index] ?? 0 })),
    demoPaise: sumPaise(input.thisMonth.filter((row) => row.method === DEMO_METHOD)),
  };
}

// ── Busy hours ──────────────────────────────────────────────────────────────

export interface BusyHour {
  readonly hour: number;
  /** Average visits in this IST hour per weekday in the window. */
  readonly weekday: number;
  /** Average visits in this IST hour per Saturday or Sunday in the window. */
  readonly weekend: number;
}

const isWeekend = (date: ISTDate) => {
  const day = dayOfWeek(date);
  return day === 0 || day === 6;
};

const oneDecimal = (value: number) => Math.round(value * 10) / 10;

/**
 * Visits per IST hour, as a per-day average, weekdays and weekends apart.
 *
 * Averages rather than totals, because a window has five weekdays for every two weekend
 * days: raw counts would make every weekday hour look busier than it is. Only hours with
 * at least one visit are returned, so a chart never draws an empty 3 am.
 */
export function busyHours(input: { readonly capturedAt: readonly Date[]; readonly from: ISTDate; readonly to: ISTDate }): BusyHour[] {
  let weekdays = 0;
  let weekendDays = 0;
  for (let date = input.from; compareISTDates(date, input.to) <= 0; date = addDays(date, 1)) {
    if (isWeekend(date)) weekendDays += 1;
    else weekdays += 1;
  }

  const buckets = new Map<number, { weekday: number; weekend: number }>();
  for (const instant of input.capturedAt) {
    const date = toISTDate(instant);
    if (compareISTDates(date, input.from) < 0 || compareISTDates(date, input.to) > 0) continue;
    const hour = Number(toISTTime(instant).slice(0, 2));
    const bucket = buckets.get(hour) ?? { weekday: 0, weekend: 0 };
    if (isWeekend(date)) bucket.weekend += 1;
    else bucket.weekday += 1;
    buckets.set(hour, bucket);
  }

  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([hour, bucket]) => ({
      hour,
      weekday: weekdays === 0 ? 0 : oneDecimal(bucket.weekday / weekdays),
      weekend: weekendDays === 0 ? 0 : oneDecimal(bucket.weekend / weekendDays),
    }));
}

// ── Kiosk ───────────────────────────────────────────────────────────────────

/** The share of check-ins the kiosk recognised by face on its own, or `null` with no check-ins. */
export function kioskShare(methods: readonly string[]): number | null {
  if (methods.length === 0) return null;
  const recognised = methods.filter((method) => method === 'FACE' || method === 'FACE_CONFIRMED').length;
  return Math.round((recognised * 100) / methods.length);
}

// ── New members, renewals, renewal rate ─────────────────────────────────────

export interface MembershipForReport {
  readonly memberId: string;
  readonly startDate: ISTDate;
  readonly endDate: ISTDate;
  readonly confirmedAt: Date;
}

export interface MembershipFlow {
  readonly newMembers: number;
  readonly renewals: number;
  readonly renewalRate: { readonly due: number; readonly renewed: number; readonly percent: number | null };
}

/**
 * New members, renewals and the renewal rate for one month (crm-module-spec §6).
 *
 * - **New**: the member's first confirmed membership was confirmed this month.
 * - **Renewal**: confirmed this month, and it starts within the grace period of the
 *   member's previous membership (BR-3.4). Someone who comes back after the grace
 *   period is neither — they returned, they did not renew.
 * - **Renewal rate**: of the memberships that ended this month *and whose grace has
 *   already run out*, how many were followed by a renewal. Counting a membership that
 *   ended yesterday would make the rate drop every morning and recover by the weekend;
 *   waiting for its grace makes the number final the day it appears.
 */
export function membershipFlow(
  memberships: readonly MembershipForReport[],
  window: { readonly monthStart: ISTDate; readonly monthEnd: ISTDate; readonly today: ISTDate; readonly graceDays: number },
): MembershipFlow {
  const inMonth = (date: ISTDate) => compareISTDates(date, window.monthStart) >= 0 && compareISTDates(date, window.monthEnd) <= 0;
  const followsWithinGrace = (next: MembershipForReport, previous: MembershipForReport) =>
    diffDays(next.startDate, previous.endDate) <= window.graceDays + 1;

  const byMember = new Map<string, MembershipForReport[]>();
  for (const membership of memberships) {
    const list = byMember.get(membership.memberId) ?? [];
    list.push(membership);
    byMember.set(membership.memberId, list);
  }

  let newMembers = 0;
  let renewals = 0;
  let due = 0;
  let renewed = 0;

  for (const list of byMember.values()) {
    list.sort((a, b) => compareISTDates(a.startDate, b.startDate));

    list.forEach((membership, index) => {
      const previous = index === 0 ? undefined : list[index - 1];
      const next = list[index + 1];

      if (inMonth(toISTDate(membership.confirmedAt))) {
        if (previous === undefined) newMembers += 1;
        else if (followsWithinGrace(membership, previous)) renewals += 1;
      }

      if (inMonth(membership.endDate) && diffDays(window.today, membership.endDate) > window.graceDays) {
        due += 1;
        if (next !== undefined && followsWithinGrace(next, membership)) renewed += 1;
      }
    });
  }

  return { newMembers, renewals, renewalRate: { due, renewed, percent: due === 0 ? null : Math.round((renewed * 100) / due) } };
}
