import { describe, expect, it } from 'vitest';
import { fakeClockAt } from '../testing/builders';
import { SIGNUP_NOT_PAID_LOOKBACK_DAYS, raiseSignupNotPaidTasks, type SignupNotPaidStore, type UnpaidSignup } from './signup-not-paid';

class FakeStore implements SignupNotPaidStore {
  signups: UnpaidSignup[] = [];
  readonly windows: Array<{ registeredAfter: Date; registeredBefore: Date }> = [];
  readonly created: Array<Parameters<SignupNotPaidStore['createCallTask']>[0]> = [];
  duplicateFor = new Set<string>();

  findUnpaidSignupsWithoutTask(window: { registeredAfter: Date; registeredBefore: Date }): Promise<UnpaidSignup[]> {
    this.windows.push(window);
    return Promise.resolve(this.signups);
  }
  createCallTask(task: Parameters<SignupNotPaidStore['createCallTask']>[0]): Promise<boolean> {
    if (this.duplicateFor.has(task.memberId)) return Promise.resolve(false);
    this.created.push(task);
    return Promise.resolve(true);
  }
}

describe('raiseSignupNotPaidTasks', () => {
  const clock = fakeClockAt('2026-09-12T06:00');

  it('asks the store for sign-ups older than a day but inside the lookback window', async () => {
    const store = new FakeStore();
    await raiseSignupNotPaidTasks({ store, clock });

    expect(store.windows).toEqual([
      {
        registeredBefore: new Date(clock.now().getTime() - 24 * 3_600_000),
        registeredAfter: new Date(clock.now().getTime() - SIGNUP_NOT_PAID_LOOKBACK_DAYS * 86_400_000),
      },
    ]);
  });

  it('opens a priority-2 call task, due today, for each unpaid sign-up', async () => {
    const store = new FakeStore();
    store.signups = [
      { gymId: 'gym_1', memberId: 'mem_1', memberStatus: 'PENDING_PAYMENT', registeredAt: new Date('2026-09-10T09:00:00Z') },
      { gymId: 'gym_1', memberId: 'mem_2', memberStatus: 'PENDING_PAYMENT', registeredAt: new Date('2026-09-11T00:00:00Z') },
    ];

    const created = await raiseSignupNotPaidTasks({ store, clock });

    expect(created).toBe(2);
    expect(store.created).toEqual([
      { gymId: 'gym_1', memberId: 'mem_1', reason: 'SIGNUP_NOT_PAID', priority: 2, dueDate: '2026-09-12' },
      { gymId: 'gym_1', memberId: 'mem_2', reason: 'SIGNUP_NOT_PAID', priority: 2, dueDate: '2026-09-12' },
    ]);
  });

  it('skips anyone who has paid since, or registered less than a day ago, and counts only new tasks', async () => {
    const store = new FakeStore();
    store.signups = [
      { gymId: 'gym_1', memberId: 'mem_paid', memberStatus: 'ACTIVE', registeredAt: new Date('2026-09-10T09:00:00Z') },
      { gymId: 'gym_1', memberId: 'mem_recent', memberStatus: 'PENDING_PAYMENT', registeredAt: new Date('2026-09-11T20:00:00Z') },
      { gymId: 'gym_1', memberId: 'mem_race', memberStatus: 'PENDING_PAYMENT', registeredAt: new Date('2026-09-10T09:00:00Z') },
    ];
    store.duplicateFor.add('mem_race');

    expect(await raiseSignupNotPaidTasks({ store, clock })).toBe(0);
    expect(store.created).toEqual([]);
  });
});
