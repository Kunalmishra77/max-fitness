import {
  addDays,
  addMonthsClamped,
  compareISTDates,
  diffDays,
  type ISTDate,
  type PlanDurationMonths,
} from '@mfp/shared';
import { DomainError } from '../errors';

/**
 * Membership dates (BR-3).
 *
 * Every date here is an IST calendar date. A membership is valid *through* its
 * `endDate` inclusive (BR-3.2) — the single most common off-by-one in gym software,
 * and the reason `daysLeft` of 0 means "ends today" rather than "expired".
 */

export interface MembershipPeriod {
  readonly startDate: ISTDate;
  readonly endDate: ISTDate;
}

/**
 * BR-3.1: `endDate = addMonths(startDate, durationMonths) − 1 day`, clamping to the
 * end of the target month.
 *
 * The worked examples from the rule:
 * - 10 Sep 2026 + 1M → 9 Oct 2026
 * - 31 Jan 2027 + 1M → 28 Feb 2027 − 1 day → 27 Feb 2027
 * - 29 Feb 2028 + 12M → 28 Feb 2029 − 1 day → 27 Feb 2029
 *
 * Note what the clamp costs in the second and third cases: a member starting on the
 * 31st gets a slightly short month. That is the rule as written, and it is
 * deliberate — the alternative (spilling into 3 March) puts the renewal date in a
 * different month every year.
 */
export function membershipEndDate(startDate: ISTDate, durationMonths: number): ISTDate {
  if (!Number.isInteger(durationMonths) || durationMonths < 1) {
    throw new DomainError('INVALID_PLAN_DURATION', 'Duration must be a whole number of months ≥ 1', {
      durationMonths,
    });
  }
  return addDays(addMonthsClamped(startDate, durationMonths), -1);
}

/** The full period for a purchase starting on `startDate`. */
export function membershipPeriod(startDate: ISTDate, durationMonths: number): MembershipPeriod {
  return { startDate, endDate: membershipEndDate(startDate, durationMonths) };
}

/**
 * BR-3.6: an imported or QR-declared membership known only by its end date.
 *
 * With the plan length known we can work the start date backwards; without it the
 * start date is genuinely unknown and stays `null` rather than being invented.
 */
export function declaredMembershipPeriod(
  endDate: ISTDate,
  durationMonths: PlanDurationMonths | null,
): { startDate: ISTDate | null; endDate: ISTDate } {
  if (durationMonths === null) {
    return { startDate: null, endDate };
  }
  // Inverse of BR-3.1: start = (end + 1 day) − months.
  return { startDate: addMonthsClamped(addDays(endDate, 1), -durationMonths), endDate };
}

export interface RenewalStartInput {
  /** End date of the membership being renewed, or `null` for a member with no history. */
  readonly currentEndDate: ISTDate | null;
  /** The date money changed hands (BR-3.4). */
  readonly paymentDate: ISTDate;
  /** ⚙ `renewalGraceDays`, default 5 (BR-3.4). */
  readonly renewalGraceDays: number;
}

/**
 * BR-3.4: where a renewal's term begins.
 *
 * Renew while still active, or within the grace window after expiry, and the new
 * term chains on from the old one — the member loses nothing by paying early, and
 * their renewal date stays stable year after year. Leave it longer than the grace
 * period and the clock restarts from the payment date, because they were not a
 * paying member in between.
 */
export function renewalStartDate(input: RenewalStartInput): ISTDate {
  const { currentEndDate, paymentDate, renewalGraceDays } = input;
  if (currentEndDate === null) {
    return paymentDate;
  }
  if (!Number.isInteger(renewalGraceDays) || renewalGraceDays < 0) {
    throw new DomainError('VALIDATION_FAILED', 'renewalGraceDays must be a non-negative integer', {
      renewalGraceDays,
    });
  }

  // Days since expiry: ≤ 0 while still active, positive once expired.
  const daysSinceExpiry = diffDays(paymentDate, currentEndDate);
  const withinGrace = daysSinceExpiry <= renewalGraceDays;
  return withinGrace ? addDays(currentEndDate, 1) : paymentDate;
}

/** True when the renewal chains on rather than restarting (used for the desk message). */
export function renewalChainsOn(input: RenewalStartInput): boolean {
  if (input.currentEndDate === null) return false;
  return diffDays(input.paymentDate, input.currentEndDate) <= input.renewalGraceDays;
}

export interface DateRange {
  readonly startDate: ISTDate | null;
  readonly endDate: ISTDate;
}

/**
 * BR-3.5: only one membership may cover any given date.
 *
 * A membership with no start date (BR-3.6, an import we know little about) is
 * treated as covering only its end date — we cannot claim a span we do not know,
 * and assuming a long one would block legitimate renewals.
 */
export function periodsOverlap(a: DateRange, b: DateRange): boolean {
  const aStart = a.startDate ?? a.endDate;
  const bStart = b.startDate ?? b.endDate;
  return compareISTDates(aStart, b.endDate) <= 0 && compareISTDates(bStart, a.endDate) <= 0;
}

/** Throws when a proposed period collides with an existing confirmed one (BR-3.5). */
export function assertNoOverlap(proposed: DateRange, existing: readonly DateRange[]): void {
  const clash = existing.find((e) => periodsOverlap(proposed, e));
  if (clash !== undefined) {
    throw new DomainError(
      'MEMBERSHIP_OVERLAP',
      'This member already has a membership covering those dates (BR-3.5)',
      { proposedStart: proposed.startDate, proposedEnd: proposed.endDate, clashEnd: clash.endDate },
    );
  }
}

/**
 * BR-3.3: an online sign-up may start today or up to ⚙ 15 days ahead.
 *
 * Backdating is a desk action with an audit trail, never something the public form
 * can do.
 */
export function assertValidStartDate(
  startDate: ISTDate,
  today: ISTDate,
  maxDaysAhead: number,
): void {
  const offset = diffDays(startDate, today);
  if (offset < 0) {
    throw new DomainError('INVALID_START_DATE', 'A membership cannot start in the past', {
      startDate,
      today,
    });
  }
  if (offset > maxDaysAhead) {
    throw new DomainError(
      'START_DATE_TOO_FAR_AHEAD',
      `A membership may start at most ${maxDaysAhead} days ahead`,
      { startDate, today, maxDaysAhead },
    );
  }
}

/** BR-3.2: valid through `endDate` inclusive. */
export function coversDate(period: DateRange, date: ISTDate): boolean {
  const start = period.startDate ?? period.endDate;
  return compareISTDates(date, start) >= 0 && compareISTDates(date, period.endDate) <= 0;
}

/** Age in full years on `today` (BR-12.1). */
export function ageOn(dob: ISTDate, today: ISTDate): number {
  const [dobYear, dobMonth, dobDay] = dob.split('-').map(Number) as [number, number, number];
  const [year, month, day] = today.split('-').map(Number) as [number, number, number];
  let age = year - dobYear;
  if (month < dobMonth || (month === dobMonth && day < dobDay)) {
    age -= 1;
  }
  return age;
}

/** BR-12.2: under 18 means `isMinor`, which gates face attendance behind parental consent. */
export function isMinorOn(dob: ISTDate, today: ISTDate): boolean {
  return ageOn(dob, today) < 18;
}
