import { todayIST, type CallTaskReason, type Clock, type ISTDate } from '@mfp/shared';
import { applyOutcome, type CallOutcome } from '../calls/call-task.rules';
import { DomainError } from '../errors';
import { assertCan, type CrmActor } from './permissions';

/**
 * Recording what happened on a call (BR-7; crm-ux-blueprint §8).
 *
 * The owner taps one of six answers and the task moves itself: a promise to renew comes
 * back in two days, an unanswered call retries tomorrow and gives up after three tries,
 * and "they left" closes the task and marks the member. The decision is `applyOutcome`
 * in the call rules; this service checks permission, that the task is still open, and
 * writes the result once.
 */

export type CallTaskStatus = 'OPEN' | 'DONE' | 'SKIPPED' | 'AUTO_CLOSED';

export interface CallTaskForOutcome {
  readonly id: string;
  readonly gymId: string;
  readonly memberId: string | null;
  readonly reason: CallTaskReason;
  readonly attempts: number;
  readonly status: CallTaskStatus;
}

export interface CallOutcomeUpdate {
  readonly outcome: CallOutcome;
  readonly attempts: number;
  readonly status: 'OPEN' | 'DONE';
  readonly snoozedUntil: ISTDate | null;
  readonly note: string | null;
  readonly doneById: string | null;
  readonly doneAt: Date | null;
}

export interface MemberLeftUpdate {
  readonly leftAt: ISTDate;
  readonly leftReason: 'OWNER_MARKED';
  readonly leftNote: string | null;
}

export interface CallOutcomeStore {
  loadTask(gymId: string, taskId: string): Promise<CallTaskForOutcome | null>;
  recordOutcome(taskId: string, update: CallOutcomeUpdate): Promise<void>;
  markMemberLeft(memberId: string, update: MemberLeftUpdate): Promise<void>;
}

export interface CallOutcomeUnitOfWork {
  transaction<T>(work: (store: CallOutcomeStore) => Promise<T>): Promise<T>;
}

export interface RecordCallOutcomeInput {
  readonly taskId: string;
  readonly outcome: CallOutcome;
  /** Only for `CALL_LATER`: the day the staff member picked. */
  readonly snoozeUntil?: ISTDate;
  readonly note?: string;
}

export async function recordCallOutcome(
  input: RecordCallOutcomeInput,
  deps: { readonly actor: CrmActor; readonly clock: Clock; readonly uow: CallOutcomeUnitOfWork },
): Promise<void> {
  const now = deps.clock.now();
  assertCan(deps.actor, 'call.outcome', now);
  const today = todayIST(deps.clock);
  const note = (input.note ?? '').trim() === '' ? null : (input.note ?? '').trim();

  await deps.uow.transaction(async (store) => {
    const task = await store.loadTask(deps.actor.gymId, input.taskId);
    if (task === null) throw new DomainError('NOT_FOUND', 'No such call task');
    if (task.status !== 'OPEN') throw new DomainError('CONFLICT', 'This call is already closed', { status: task.status });

    const effect = applyOutcome({
      outcome: input.outcome,
      today,
      attempts: task.attempts,
      ...(input.snoozeUntil === undefined ? {} : { snoozeChoice: input.snoozeUntil }),
    });

    await store.recordOutcome(task.id, {
      outcome: input.outcome,
      attempts: task.attempts + 1,
      status: effect.closeTask ? 'DONE' : 'OPEN',
      snoozedUntil: effect.snoozeUntil,
      note,
      doneById: effect.closeTask ? deps.actor.staffUserId : null,
      doneAt: effect.closeTask ? now : null,
    });

    if (effect.markMemberLeft && task.memberId !== null) {
      await store.markMemberLeft(task.memberId, { leftAt: today, leftReason: 'OWNER_MARKED', leftNote: note });
    }
  });
}
