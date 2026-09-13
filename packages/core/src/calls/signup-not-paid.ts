import { CALL_TASK_PRIORITY, todayIST, type Clock, type ISTDate, type MemberStatus } from '@mfp/shared';
import { shouldCreateSignupNotPaid } from './call-task.rules';

/**
 * `SIGNUP_NOT_PAID` call tasks (BR-7; signup-and-payment-flow.md §6) — the part of the
 * 06:00 nightly job that Phase 3 needs.
 *
 * Someone who registered online and did not pay within a day is worth one phone call.
 * One: a member who already had this task is never offered again, even after staff
 * closed it, and sign-ups older than the lookback window are left alone (their
 * reservation lapses; the CRM's lifecycle job handles that).
 */

export const SIGNUP_NOT_PAID_LOOKBACK_DAYS = 7;

export interface UnpaidSignup {
  readonly gymId: string;
  readonly memberId: string;
  readonly memberStatus: MemberStatus;
  readonly registeredAt: Date;
}

export interface SignupNotPaidStore {
  /** Online sign-ups registered inside the window that have never had a SIGNUP_NOT_PAID task. */
  findUnpaidSignupsWithoutTask(window: { registeredAfter: Date; registeredBefore: Date }): Promise<UnpaidSignup[]>;
  /** `false` when an open task for the member already exists (the unique index won a race). */
  createCallTask(task: {
    gymId: string;
    memberId: string;
    reason: 'SIGNUP_NOT_PAID';
    priority: number;
    dueDate: ISTDate;
  }): Promise<boolean>;
}

export async function raiseSignupNotPaidTasks(deps: { readonly store: SignupNotPaidStore; readonly clock: Clock }): Promise<number> {
  const now = deps.clock.now();
  const today = todayIST(deps.clock);
  const candidates = await deps.store.findUnpaidSignupsWithoutTask({
    registeredBefore: new Date(now.getTime() - 24 * 3_600_000),
    registeredAfter: new Date(now.getTime() - SIGNUP_NOT_PAID_LOOKBACK_DAYS * 86_400_000),
  });

  let created = 0;
  for (const signup of candidates) {
    if (!shouldCreateSignupNotPaid({ memberStatus: signup.memberStatus, registeredAt: signup.registeredAt, now })) continue;
    const raised = await deps.store.createCallTask({
      gymId: signup.gymId,
      memberId: signup.memberId,
      reason: 'SIGNUP_NOT_PAID',
      priority: CALL_TASK_PRIORITY.SIGNUP_NOT_PAID,
      dueDate: today,
    });
    if (raised) created += 1;
  }
  return created;
}
