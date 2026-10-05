import { addDays, compareISTDates, todayIST, type Clock, type ISTDate } from '@mfp/shared';
import type { SubscriptionStatus } from '../ports/payments';
import { DomainError } from '../errors';

/**
 * The rules of a standing instruction, as pure functions (ADR-105).
 *
 * Everything here is decided from a date and a status, with the clock injected, so the
 * awkward cases — a trial that ends tomorrow, cover that lapsed in August, a member who
 * was sent a link and never opened it — are decided once and tested rather than
 * re-derived at each call site.
 */

/** Mirrors Razorpay's own subscription states; the database enum is the same list. */
export type MandateStatus =
  | 'CREATED'
  | 'AUTHENTICATED'
  | 'ACTIVE'
  | 'PENDING'
  | 'HALTED'
  | 'PAUSED'
  | 'CANCELLED'
  | 'COMPLETED'
  | 'EXPIRED';

const STATUS_BY_PROVIDER: Readonly<Record<SubscriptionStatus, MandateStatus>> = {
  created: 'CREATED',
  authenticated: 'AUTHENTICATED',
  active: 'ACTIVE',
  pending: 'PENDING',
  halted: 'HALTED',
  paused: 'PAUSED',
  cancelled: 'CANCELLED',
  completed: 'COMPLETED',
  expired: 'EXPIRED',
};

export function mandateStatusFrom(status: SubscriptionStatus): MandateStatus {
  return STATUS_BY_PROVIDER[status];
}

/**
 * Whether money can still arrive on this mandate without anyone asking for it.
 *
 * This is the question the reminder engine asks (ADR-105 §5), so the two ends of it matter:
 *
 * `CREATED` is **not** live. The member was sent a link and has not opened it. Treating that
 * as signed would stop the gym chasing a fee that is never coming — the worst failure this
 * feature could have.
 *
 * `PENDING` is live. Razorpay uses it for a debit that failed and is being retried; the
 * member has authorised, and the money may yet arrive. Chasing them mid-retry would be
 * asking twice. If the retries run out Razorpay says `halted`, and that is when the gym is
 * told.
 */
export function isLiveMandate(status: MandateStatus): boolean {
  return status === 'ACTIVE' || status === 'AUTHENTICATED' || status === 'PENDING';
}

export interface FirstChargeInput {
  /** The last date the member's cover runs to, or `null` when they hold none. */
  readonly coveredUntil: ISTDate | null;
  readonly clock: Clock;
}

/**
 * When the first debit should land: **the day after the cover the member already holds**
 * (ADR-105 §2a).
 *
 * One rule covering what look like three cases. A trial member is covered until the trial
 * ends. A member who just paid for three months is covered until those end. A member with
 * nothing, or whose cover lapsed weeks ago, is covered until tomorrow — the desk takes this
 * fee at the counter, and the mandate picks up from there.
 *
 * Never today, in any case. A mandate authorised this afternoon cannot debit this afternoon,
 * and charging for cover already held would be taking the same money twice.
 */
export function firstChargeDate(input: FirstChargeInput): ISTDate {
  const today = todayIST(input.clock);
  const tomorrow = addDays(today, 1);
  if (input.coveredUntil === null) return tomorrow;

  const dayAfterCover = addDays(input.coveredUntil, 1);
  // Cover that ends today or earlier would put the first debit in the past or on today.
  return compareISTDates(dayAfterCover, tomorrow) <= 0 ? tomorrow : dayAfterCover;
}

/** As many cycles as Razorpay will accept on one authorisation. */
const MAX_CYCLES = 100;
/** The span a mandate is meant to cover before anyone has to think about it again. */
const TARGET_MONTHS = 120;

/**
 * How many debits the mandate authorises.
 *
 * Razorpay requires a finite count, so "until they leave" has to be written as a number.
 * About ten years, capped at the hundred cycles Razorpay accepts — long past the point
 * where a gym membership is still the same arrangement, and the member can cancel from
 * their own UPI app at any time regardless.
 */
export function mandateCycleCount(intervalMonths: number): number {
  if (!Number.isInteger(intervalMonths) || intervalMonths < 1) {
    throw new DomainError('VALIDATION_FAILED', 'A mandate interval must be a whole number of months, at least one', {
      intervalMonths,
    });
  }
  return Math.min(MAX_CYCLES, Math.ceil(TARGET_MONTHS / intervalMonths));
}
