import { addDays, type ISTDate } from '@mfp/shared';
import { DomainError } from '../errors';

/**
 * The paid trial (ADR-088; client's second requirements list).
 *
 * The gym calls it a free trial and charges ₹100 a day for it. A newcomer buys a few days
 * to see the place before committing to a month, so it is **priced by the day** rather
 * than from the plan catalogue: the lengths are days, the member picks how many, and there
 * is no catalogue row to point at or to retire.
 *
 * What it becomes is an ordinary membership with `isTrial` set and no plan — which is why
 * fee state, attendance, reminders and the fees list all work on a trial member without a
 * line of new code, and why converting one into a real member is just taking fees.
 *
 * Two rules carry the weight. A trial is **for somebody who is not a member**: offering it
 * to someone who already pays monthly is a discount nobody asked for. And **the dates are
 * inclusive** — a one-day trial is today, not today and tomorrow.
 */

export interface TrialSettings {
  readonly trialEnabled: boolean;
  readonly trialPerDayPaise: number;
  readonly trialDayOptions: readonly number[];
}

export interface TrialQuote {
  readonly days: number;
  readonly perDayPaise: number;
  readonly totalPaise: number;
}

export interface TrialOption {
  readonly days: number;
  readonly totalPaise: number;
}

/** Every length on sale, priced, shortest first. Empty when the gym offers no trial. */
export function trialOptions(settings: TrialSettings): TrialOption[] {
  if (!settings.trialEnabled) return [];
  return [...settings.trialDayOptions]
    .sort((a, b) => a - b)
    .map((days) => ({ days, totalPaise: days * settings.trialPerDayPaise }));
}

export function trialQuote(input: { readonly days: number; readonly settings: TrialSettings }): TrialQuote {
  const { days, settings } = input;
  if (!settings.trialEnabled) throw new DomainError('TRIAL_NOT_OFFERED', 'This gym is not offering a trial');
  if (!settings.trialDayOptions.includes(days)) {
    throw new DomainError('VALIDATION_FAILED', 'That trial length is not on sale', { field: 'days', days });
  }
  return { days, perDayPaise: settings.trialPerDayPaise, totalPaise: days * settings.trialPerDayPaise };
}

/** Inclusive of the first day: one day is today (BR-3.1 counts the same way). */
export function trialPeriod(startDate: ISTDate, days: number): { readonly startDate: ISTDate; readonly endDate: ISTDate } {
  return { startDate, endDate: addDays(startDate, days - 1) };
}

/**
 * Who may buy one (client's list: "only available to new prospective members").
 *
 * Checked against the mobile number, which is the gym's own way of recognising somebody.
 * Numbers are deliberately **not** unique here because families share one (SU-08) — so a
 * family whose first member already trained here cannot take a second trial on the same
 * number. That is the client's rule, and the desk can still enrol them normally; it is
 * only the trial that is refused.
 */
export function assertTrialAllowed(history: { readonly membersOnThatMobile: number; readonly trialsOnThatMobile: number }): void {
  if (history.membersOnThatMobile > 0) {
    throw new DomainError('TRIAL_NOT_FOR_MEMBERS', 'This number already belongs to a member, so the trial does not apply');
  }
  if (history.trialsOnThatMobile > 0) {
    throw new DomainError('TRIAL_ALREADY_TAKEN', 'A trial has already been taken on this number');
  }
}
