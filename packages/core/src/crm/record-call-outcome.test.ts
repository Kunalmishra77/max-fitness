import { beforeEach, describe, expect, it } from 'vitest';
import { istDate } from '@mfp/shared';
import { fakeClockAt } from '../testing/builders';
import type { CrmActor } from './permissions';
import {
  recordCallOutcome,
  type CallOutcomeStore,
  type CallOutcomeUpdate,
  type CallTaskForOutcome,
  type MemberLeftUpdate,
} from './record-call-outcome';

/**
 * Recording what happened on a call (BR-7; crm-ux-blueprint §8).
 *
 * The rules themselves are `applyOutcome` in call-task.rules; this service is about
 * doing it once, with permission, to a task that is still open.
 */

const owner: CrmActor = { staffUserId: 'staff_1', gymId: 'gym_1', role: 'OWNER', elevatedUntil: null, receptionMayTakePayments: true };
const trainer: CrmActor = { ...owner, role: 'TRAINER' };

const openTask: CallTaskForOutcome = {
  id: 'task_1',
  gymId: 'gym_1',
  memberId: 'mem_1',
  reason: 'EXPIRED_NOT_RENEWED',
  attempts: 0,
  status: 'OPEN',
};

class FakeStore implements CallOutcomeStore {
  task: CallTaskForOutcome | null = openTask;
  readonly recorded: Array<CallOutcomeUpdate & { taskId: string }> = [];
  readonly left: Array<MemberLeftUpdate & { memberId: string }> = [];

  loadTask(gymId: string, taskId: string) {
    return Promise.resolve(this.task?.id === taskId && this.task.gymId === gymId ? this.task : null);
  }
  recordOutcome(taskId: string, update: CallOutcomeUpdate) {
    this.recorded.push({ taskId, ...update });
    return Promise.resolve();
  }
  markMemberLeft(memberId: string, update: MemberLeftUpdate) {
    this.left.push({ memberId, ...update });
    return Promise.resolve();
  }
}

describe('recordCallOutcome', () => {
  let store: FakeStore;
  const clock = fakeClockAt('2026-09-12T11:00');

  beforeEach(() => {
    store = new FakeStore();
  });

  const record = (outcome: Parameters<typeof recordCallOutcome>[0]['outcome'], extra: Record<string, unknown> = {}, actor: CrmActor = owner) =>
    recordCallOutcome({ taskId: 'task_1', outcome, ...extra }, { actor, clock, uow: { transaction: (work) => work(store) } });

  it('keeps a "will renew" task open and checks back in two days', async () => {
    await record('WILL_RENEW');

    expect(store.recorded).toEqual([
      {
        taskId: 'task_1',
        outcome: 'WILL_RENEW',
        attempts: 1,
        status: 'OPEN',
        snoozedUntil: '2026-09-14',
        note: null,
        doneById: null,
        doneAt: null,
      },
    ]);
  });

  it('snoozes a "call later" to the day the staff member picked', async () => {
    await record('CALL_LATER', { snoozeUntil: istDate('2026-09-13'), note: 'बाद में कॉल करें' });
    expect(store.recorded[0]).toMatchObject({ status: 'OPEN', snoozedUntil: '2026-09-13', note: 'बाद में कॉल करें' });
  });

  it('retries a no-answer the next day, and gives up after the third try (BR-7)', async () => {
    await record('NO_ANSWER');
    expect(store.recorded[0]).toMatchObject({ attempts: 1, status: 'OPEN', snoozedUntil: '2026-09-13' });

    store.task = { ...openTask, attempts: 2 };
    await record('NO_ANSWER');
    expect(store.recorded[1]).toMatchObject({ attempts: 3, status: 'DONE', snoozedUntil: null, doneById: 'staff_1', doneAt: clock.now() });
  });

  it('closes the task and marks the member left when they say they have left', async () => {
    await record('LEFT_GYM', { note: 'दूसरे शहर चले गए' });

    expect(store.recorded[0]).toMatchObject({ status: 'DONE', outcome: 'LEFT_GYM' });
    expect(store.left).toEqual([{ memberId: 'mem_1', leftAt: '2026-09-12', leftReason: 'OWNER_MARKED', leftNote: 'दूसरे शहर चले गए' }]);
  });

  it.each(['DONE', 'WRONG_NUMBER'] as const)('closes the task on %s without touching the member', async (outcome) => {
    await record(outcome);
    expect(store.recorded[0]).toMatchObject({ status: 'DONE', doneById: 'staff_1' });
    expect(store.left).toEqual([]);
  });

  it('refuses a trainer, an unknown task and a task someone already closed', async () => {
    await expect(record('DONE', {}, trainer)).rejects.toMatchObject({ code: 'FORBIDDEN' });

    store.task = null;
    await expect(record('DONE')).rejects.toMatchObject({ code: 'NOT_FOUND' });

    store.task = { ...openTask, status: 'DONE' };
    await expect(record('DONE')).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});
