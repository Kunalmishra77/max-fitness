import {
  CALL_TASK_PRIORITY,
  addDays,
  diffDays,
  type CallTaskReason,
  type FeeState,
  type ISTDate,
  type MemberStatus,
} from '@mfp/shared';

/**
 * The "calls to make" list (BR-7).
 *
 * This is the module that turns the database into money. A gym loses members
 * quietly — they drift past their end date, nobody notices, and by the time anyone
 * does they have joined somewhere else. These predicates decide who the owner rings
 * today, in what order.
 *
 * Two invariants hold throughout:
 * - **At most one OPEN task per (member, reason)** — enforced in the service and by
 *   a partial unique index (database-design.md §3). Nagging the owner with three
 *   copies of the same call is how a call list gets ignored.
 * - **Tasks auto-close when the condition clears.** If a member renews, the task
 *   disappears rather than waiting for someone to tick it off.
 */

export interface CallTaskCandidate {
  readonly reason: CallTaskReason;
  readonly priority: number;
  readonly dueDate: ISTDate;
}

function candidate(reason: CallTaskReason, dueDate: ISTDate): CallTaskCandidate {
  return { reason, priority: CALL_TASK_PRIORITY[reason], dueDate };
}

// ── Individual rules ─────────────────────────────────────────────────────────

/**
 * `EXPIRED_BUT_VISITING`, priority 1.
 *
 * Someone still turning up after their membership lapsed is the warmest lead the
 * gym will ever have: they want to be there and simply have not paid. This outranks
 * everything else on the list.
 */
export function shouldCreateExpiredButVisiting(input: {
  readonly feeStateAtCheckIn: FeeState;
  readonly memberStatus: MemberStatus;
}): boolean {
  return input.memberStatus === 'ACTIVE' && input.feeStateAtCheckIn === 'EXPIRED';
}

/** `SIGNUP_NOT_PAID`, priority 2 — registered but never paid, after 24 hours. */
export function shouldCreateSignupNotPaid(input: {
  readonly memberStatus: MemberStatus;
  readonly registeredAt: Date;
  readonly now: Date;
}): boolean {
  if (input.memberStatus !== 'PENDING_PAYMENT') return false;
  const hours = (input.now.getTime() - input.registeredAt.getTime()) / 3_600_000;
  return hours > 24;
}

/**
 * `NEW_LEAD`, priority 2 — an enquiry not contacted within 2 gym hours.
 *
 * The clock counts only hours the gym is open: an 11 pm enquiry is not "ignored"
 * at 1 am, and raising a task then would only bury the morning's real calls.
 */
export function shouldCreateNewLead(input: {
  readonly leadStatus: string;
  readonly gymHoursSinceCreated: number;
}): boolean {
  return input.leadStatus === 'NEW' && input.gymHoursSinceCreated >= 2;
}

/** `VERIFICATION_PENDING`, priority 2 — a QR existing-customer claim waiting over 2 hours. */
export function shouldCreateVerificationPending(input: {
  readonly submittedAt: Date;
  readonly now: Date;
  readonly status: string;
}): boolean {
  if (input.status !== 'PENDING') return false;
  return (input.now.getTime() - input.submittedAt.getTime()) / 3_600_000 >= 2;
}

/**
 * `EXPIRED_NOT_RENEWED`, priority 3.
 *
 * BR-7: raised on day +3 after expiry, and again when the reminder cap is reached
 * (BR-5.7) — the moment automated messages stop is exactly when a human should take
 * over.
 */
export function shouldCreateExpiredNotRenewed(input: {
  readonly today: ISTDate;
  readonly effectiveEndDate: ISTDate | null;
  readonly memberStatus: MemberStatus;
  readonly postExpiryMaxDays: number | null;
}): boolean {
  if (input.memberStatus !== 'ACTIVE' || input.effectiveEndDate === null) return false;
  const daysPast = diffDays(input.today, input.effectiveEndDate);
  if (daysPast === 3) return true;
  return input.postExpiryMaxDays !== null && daysPast === input.postExpiryMaxDays + 1;
}

/** `DUE_SOON_NO_RESPONSE`, priority 4 — the day before expiry with reminders delivered and no renewal. */
export function shouldCreateDueSoonNoResponse(input: {
  readonly today: ISTDate;
  readonly effectiveEndDate: ISTDate | null;
  readonly memberStatus: MemberStatus;
  readonly remindersDelivered: boolean;
  readonly hasUpcomingMembership: boolean;
}): boolean {
  if (input.memberStatus !== 'ACTIVE' || input.effectiveEndDate === null) return false;
  if (input.hasUpcomingMembership || !input.remindersDelivered) return false;
  return diffDays(input.today, input.effectiveEndDate) === -1;
}

/**
 * `ABSENT_7_DAYS`, priority 5.
 *
 * A paid-up member who stops coming is about to stop paying. BR-7 says once per
 * absence streak — the caller passes `alreadyRaisedThisStreak` from the last task's
 * date, so a member absent for a month generates one call, not thirty.
 */
export function shouldCreateAbsent7Days(input: {
  readonly today: ISTDate;
  readonly memberStatus: MemberStatus;
  readonly feeState: FeeState;
  readonly lastAttendanceDate: ISTDate | null;
  readonly absentDaysThreshold: number;
  readonly alreadyRaisedThisStreak: boolean;
}): boolean {
  if (input.memberStatus !== 'ACTIVE') return false;
  if (input.feeState !== 'PAID' && input.feeState !== 'DUE_SOON') return false;
  if (input.alreadyRaisedThisStreak) return false;
  if (input.lastAttendanceDate === null) return false;
  return diffDays(input.today, input.lastAttendanceDate) >= input.absentDaysThreshold;
}

// ── Nightly generation ───────────────────────────────────────────────────────

export interface MemberSnapshotForCallTasks {
  readonly memberStatus: MemberStatus;
  readonly feeState: FeeState;
  readonly effectiveEndDate: ISTDate | null;
  readonly lastAttendanceDate: ISTDate | null;
  readonly remindersDelivered: boolean;
  readonly hasUpcomingMembership: boolean;
  readonly absentTaskAlreadyRaisedThisStreak: boolean;
  readonly openReasons: readonly CallTaskReason[];
}

export interface CallTaskSettings {
  readonly postExpiryMaxDays: number | null;
  readonly absentDaysThreshold: number;
}

/**
 * The tasks the 06:00 nightly job should open for one member (crm-module-spec §4).
 *
 * Reasons already open are filtered out here as well as in the database, so the
 * job does not spend a round trip discovering a conflict it could have predicted.
 */
export function nightlyCallTasksFor(
  today: ISTDate,
  member: MemberSnapshotForCallTasks,
  settings: CallTaskSettings,
): CallTaskCandidate[] {
  const out: CallTaskCandidate[] = [];

  if (
    shouldCreateExpiredNotRenewed({
      today,
      effectiveEndDate: member.effectiveEndDate,
      memberStatus: member.memberStatus,
      postExpiryMaxDays: settings.postExpiryMaxDays,
    })
  ) {
    out.push(candidate('EXPIRED_NOT_RENEWED', today));
  }

  if (
    shouldCreateDueSoonNoResponse({
      today,
      effectiveEndDate: member.effectiveEndDate,
      memberStatus: member.memberStatus,
      remindersDelivered: member.remindersDelivered,
      hasUpcomingMembership: member.hasUpcomingMembership,
    })
  ) {
    out.push(candidate('DUE_SOON_NO_RESPONSE', today));
  }

  if (
    shouldCreateAbsent7Days({
      today,
      memberStatus: member.memberStatus,
      feeState: member.feeState,
      lastAttendanceDate: member.lastAttendanceDate,
      absentDaysThreshold: settings.absentDaysThreshold,
      alreadyRaisedThisStreak: member.absentTaskAlreadyRaisedThisStreak,
    })
  ) {
    out.push(candidate('ABSENT_7_DAYS', today));
  }

  return out.filter((c) => !member.openReasons.includes(c.reason));
}

// ── Outcomes ─────────────────────────────────────────────────────────────────

export type CallOutcome = 'WILL_RENEW' | 'CALL_LATER' | 'NO_ANSWER' | 'LEFT_GYM' | 'WRONG_NUMBER' | 'DONE';

export interface OutcomeEffect {
  readonly closeTask: boolean;
  readonly snoozeUntil: ISTDate | null;
  readonly markMemberLeft: boolean;
  /** BR-7: NO_ANSWER retries the next day, at most three times. */
  readonly retry: boolean;
}

export const MAX_NO_ANSWER_ATTEMPTS = 3;

/**
 * What recording an outcome does (BR-7).
 *
 * `CALL_LATER` takes an explicit date from the UI ("later today" / "tomorrow");
 * anything else falls back to tomorrow rather than silently closing the task.
 */
export function applyOutcome(input: {
  readonly outcome: CallOutcome;
  readonly today: ISTDate;
  readonly attempts: number;
  readonly snoozeChoice?: ISTDate;
}): OutcomeEffect {
  switch (input.outcome) {
    case 'WILL_RENEW':
      // Believe them, but check back in two days.
      return { closeTask: false, snoozeUntil: addDays(input.today, 2), markMemberLeft: false, retry: false };

    case 'CALL_LATER':
      return {
        closeTask: false,
        snoozeUntil: input.snoozeChoice ?? addDays(input.today, 1),
        markMemberLeft: false,
        retry: false,
      };

    case 'NO_ANSWER': {
      const exhausted = input.attempts + 1 >= MAX_NO_ANSWER_ATTEMPTS;
      return {
        closeTask: exhausted,
        snoozeUntil: exhausted ? null : addDays(input.today, 1),
        markMemberLeft: false,
        retry: !exhausted,
      };
    }

    case 'LEFT_GYM':
      return { closeTask: true, snoozeUntil: null, markMemberLeft: true, retry: false };

    case 'WRONG_NUMBER':
    case 'DONE':
      return { closeTask: true, snoozeUntil: null, markMemberLeft: false, retry: false };
  }
}

/**
 * Should an open task close itself because the situation resolved?
 *
 * BR-7: "tasks auto-close when the underlying condition clears". A member who
 * renewed overnight should not still be on the morning call list.
 */
export function shouldAutoClose(
  reason: CallTaskReason,
  member: { readonly feeState: FeeState; readonly memberStatus: MemberStatus; readonly hasUpcomingMembership: boolean },
): boolean {
  const renewed = member.feeState === 'PAID' || member.hasUpcomingMembership;

  switch (reason) {
    case 'EXPIRED_BUT_VISITING':
    case 'EXPIRED_NOT_RENEWED':
    case 'DUE_SOON_NO_RESPONSE':
      return renewed;
    case 'SIGNUP_NOT_PAID':
      return member.memberStatus === 'ACTIVE';
    case 'VERIFICATION_PENDING':
      return member.memberStatus !== 'PENDING_VERIFICATION';
    case 'ABSENT_7_DAYS':
    case 'NEW_LEAD':
    case 'UNSUBSCRIBED':
    case 'OTHER':
      return false;
  }
}

/** List ordering: priority first, then the oldest due date (database-design.md §5). */
export function compareCallTasks(
  a: { priority: number; dueDate: ISTDate },
  b: { priority: number; dueDate: ISTDate },
): number {
  return a.priority - b.priority || (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0);
}
