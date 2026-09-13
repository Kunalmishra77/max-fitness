import {
  compareISTDates,
  minutesOfDay,
  type ISTDate,
  type ISTTime,
  type MemberStatus,
} from '@mfp/shared';

/**
 * Send-time eligibility (BR-5.3).
 *
 * CLAUDE.md §2.6 is the whole point of this file: eligibility is checked **at send
 * time**, not when the send was planned. A member may have renewed, unsubscribed or
 * been paused in the minutes between the slot firing and the message going out
 * (cases R10 and R11), and the last check before the API call is the only one that
 * counts.
 *
 * Every reason is returned rather than thrown, because a skip is a normal outcome
 * that gets logged as `SKIPPED` — not an error.
 */

export const INELIGIBLE_REASONS = [
  'MEMBER_NOT_ACTIVE',
  'NOT_OPTED_IN',
  'UNSUBSCRIBED',
  'REMINDERS_PAUSED',
  'SUPERSEDED_BY_NEWER_MEMBERSHIP',
  'OUTSIDE_QUIET_HOURS',
  'ALREADY_SENT',
  'NUMBER_DAILY_CAP_REACHED',
  'NO_MOBILE',
] as const;
export type IneligibleReason = (typeof INELIGIBLE_REASONS)[number];

export interface EligibilityInput {
  readonly memberStatus: MemberStatus;
  readonly whatsappOptIn: boolean;
  readonly remindersUnsubscribedAt: Date | null;
  /** IST date; reminders resume the day after this (BR-5.3 rule 3). */
  readonly remindersPausedUntil: ISTDate | null;
  readonly hasMobile: boolean;
  /** The membership this reminder is about. */
  readonly targetMembershipId: string;
  /** The member's latest confirmed membership right now. */
  readonly latestConfirmedMembershipId: string | null;
  readonly today: ISTDate;
  readonly nowTime: ISTTime;
  readonly quietHours: { readonly start: ISTTime; readonly end: ISTTime };
  /** True when a MessageLog row with this idempotency key already exists (rule 6). */
  readonly alreadySent: boolean;
  /** Messages already sent to this WhatsApp number today, against the per-number cap. */
  readonly messagesToNumberToday?: number;
  readonly maxMessagesPerNumberPerDay?: number;
}

export type EligibilityResult =
  | { readonly eligible: true }
  | { readonly eligible: false; readonly reason: IneligibleReason };

const ELIGIBLE: EligibilityResult = { eligible: true };

function no(reason: IneligibleReason): EligibilityResult {
  return { eligible: false, reason };
}

/**
 * BR-5.3, in the order the rule lists them.
 *
 * Order matters for the logs, not for correctness: a member who is both LEFT and
 * unsubscribed should be recorded as LEFT, which is the more informative reason.
 */
export function checkReminderEligibility(input: EligibilityInput): EligibilityResult {
  // 1. Only ACTIVE members get reminders. LEFT, BLOCKED, PENDING_* never do (BR-4.1).
  if (input.memberStatus !== 'ACTIVE') {
    return no('MEMBER_NOT_ACTIVE');
  }

  if (!input.hasMobile) {
    return no('NO_MOBILE');
  }

  // 2. Consent. Both flags must hold — opt-in can be false for imported members
  //    who never consented (ADR-009), and unsubscribing sets the timestamp (BR-6.2).
  if (!input.whatsappOptIn) {
    return no('NOT_OPTED_IN');
  }
  if (input.remindersUnsubscribedAt !== null) {
    return no('UNSUBSCRIBED');
  }

  // 3. A pause runs through the given date; reminders resume the day after.
  if (input.remindersPausedUntil !== null && compareISTDates(input.remindersPausedUntil, input.today) >= 0) {
    return no('REMINDERS_PAUSED');
  }

  // 4. The renewal stop. If a newer membership exists, this reminder is about a
  //    superseded one — the member has already paid, and messaging them now would
  //    be the single most embarrassing bug in the product (cases R9, R10).
  if (
    input.latestConfirmedMembershipId !== null &&
    input.latestConfirmedMembershipId !== input.targetMembershipId
  ) {
    return no('SUPERSEDED_BY_NEWER_MEMBERSHIP');
  }

  // 5. Quiet hours (⚙ 08:00-21:00). A slot outside them is a misconfiguration that
  //    settings validation should have caught (case R18); refusing here is the
  //    backstop that keeps us from waking someone at 22:00.
  const at = minutesOfDay(input.nowTime);
  if (at < minutesOfDay(input.quietHours.start) || at > minutesOfDay(input.quietHours.end)) {
    return no('OUTSIDE_QUIET_HOURS');
  }

  // 6. Idempotency (BR-5.3 rule 6, case R15).
  if (input.alreadySent) {
    return no('ALREADY_SENT');
  }

  // Per-number cap. BR-5.6 gives each member on a shared number their own reminder,
  // but a family of four should not receive four messages in one slot forever.
  const cap = input.maxMessagesPerNumberPerDay;
  const sent = input.messagesToNumberToday;
  if (cap !== undefined && sent !== undefined && sent >= cap) {
    return no('NUMBER_DAILY_CAP_REACHED');
  }

  return ELIGIBLE;
}

/** BR-5.3 rule 5, on its own — the worker checks this before running a slot at all. */
export function isWithinQuietHours(
  now: ISTTime,
  quietHours: { readonly start: ISTTime; readonly end: ISTTime },
): boolean {
  const at = minutesOfDay(now);
  return at >= minutesOfDay(quietHours.start) && at <= minutesOfDay(quietHours.end);
}
