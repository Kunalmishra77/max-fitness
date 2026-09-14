import { beforeEach, describe, expect, it } from 'vitest';
import { fakeClockAt } from '../testing/builders';
import type { CrmActor } from './permissions';
import {
  markAttendance,
  undoAttendance,
  type AttendanceEventRecord,
  type CallTaskToRaise,
  type AttendanceStore,
  type MemberForAttendance,
  type StoredAttendanceEvent,
} from './mark-attendance';

/**
 * Marking attendance by hand at the desk (crm-ux-blueprint §11; BR-9).
 *
 * Until the kiosk exists this is how every visit is recorded, so it has to survive a
 * busy counter: the same member walking past twice must not count twice (BR-9.1), and
 * a staff member tapping the button twice must not write two rows. Undo is part of the
 * feature, not a repair — the wrong name gets tapped, and the bar is right there.
 */

const reception: CrmActor = { staffUserId: 'staff_2', gymId: 'gym_1', role: 'RECEPTION', elevatedUntil: null, receptionMayTakePayments: true };

const member: MemberForAttendance = { id: 'mem_1', status: 'ACTIVE', lastAttendanceAt: null };

class FakeStore implements AttendanceStore {
  member: MemberForAttendance | null = member;
  knownEventIds = new Set<string>();
  event: StoredAttendanceEvent | null = null;
  readonly created: AttendanceEventRecord[] = [];
  readonly voided: Array<{ eventId: string; at: Date }> = [];
  readonly tasks: CallTaskToRaise[] = [];
  /** The partial unique index already holds an open task of this reason for the member. */
  openTaskExists = false;

  raiseCallTask(task: CallTaskToRaise) {
    if (this.openTaskExists) return Promise.resolve(false);
    this.tasks.push(task);
    return Promise.resolve(true);
  }

  memberForAttendance(gymId: string, memberId: string) {
    return Promise.resolve(this.member?.id === memberId && gymId === 'gym_1' ? this.member : null);
  }
  hasEventId(clientEventId: string) {
    return Promise.resolve(this.knownEventIds.has(clientEventId));
  }
  createEvent(record: AttendanceEventRecord) {
    this.created.push(record);
    return Promise.resolve('evt_1');
  }
  loadEvent(gymId: string, eventId: string) {
    return Promise.resolve(this.event?.id === eventId && gymId === 'gym_1' ? this.event : null);
  }
  voidEvent(eventId: string, at: Date) {
    this.voided.push({ eventId, at });
    return Promise.resolve();
  }
}

describe('markAttendance', () => {
  let store: FakeStore;
  const clock = fakeClockAt('2026-09-12T11:30');

  beforeEach(() => {
    store = new FakeStore();
  });

  const mark = (input: Partial<Parameters<typeof markAttendance>[0]> = {}, actor: CrmActor = reception) =>
    markAttendance(
      { memberId: 'mem_1', clientEventId: 'tap_1', ...input },
      { actor, clock, uow: { transaction: (work) => work(store) }, cooldownMinutes: 180 },
    );

  it('records a manual check-in against today, with the staff member who marked it', async () => {
    await expect(mark()).resolves.toEqual({ decision: 'RECORD', eventId: 'evt_1', callTaskRaised: false });

    expect(store.created).toEqual([
      {
        gymId: 'gym_1',
        memberId: 'mem_1',
        clientEventId: 'tap_1',
        method: 'MANUAL',
        capturedAt: clock.now(),
        attendanceDate: '2026-09-12',
        recordedById: 'staff_2',
        feeStateAtCheckIn: null,
      },
    ]);
  });

  it('keeps the fee state the desk could see, for the follow-up that comes later (BR-9.3)', async () => {
    await mark({ feeStateAtCheckIn: 'EXPIRED' });
    expect(store.created[0]).toMatchObject({ feeStateAtCheckIn: 'EXPIRED' });
  });

  it('counts one visit per cooldown, however many times someone walks past (BR-9.1)', async () => {
    store.member = { ...member, lastAttendanceAt: new Date(clock.now().getTime() - 179 * 60_000) };
    await expect(mark()).resolves.toEqual({ decision: 'WITHIN_COOLDOWN', eventId: null, callTaskRaised: false });
    expect(store.created).toEqual([]);

    store.member = { ...member, lastAttendanceAt: new Date(clock.now().getTime() - 181 * 60_000) };
    await expect(mark()).resolves.toMatchObject({ decision: 'RECORD' });
  });

  it('treats the same tap arriving twice as the same visit', async () => {
    store.knownEventIds.add('tap_1');
    await expect(mark()).resolves.toEqual({ decision: 'DUPLICATE_EVENT', eventId: null, callTaskRaised: false });
    expect(store.created).toEqual([]);
  });

  it('puts a member whose fees have run out at the top of the call list when they walk in (BR-7, BR-9.3)', async () => {
    await expect(mark({ feeStateAtCheckIn: 'EXPIRED' })).resolves.toEqual({ decision: 'RECORD', eventId: 'evt_1', callTaskRaised: true });

    expect(store.tasks).toEqual([{ gymId: 'gym_1', memberId: 'mem_1', reason: 'EXPIRED_BUT_VISITING', priority: 1, dueDate: '2026-09-12' }]);
  });

  it('raises no task for a paid member, for someone who has left, or for a visit that was not recorded', async () => {
    await mark({ feeStateAtCheckIn: 'PAID' });
    await mark({ clientEventId: 'tap_2', feeStateAtCheckIn: 'DUE_SOON' });

    store.member = { ...member, status: 'LEFT' };
    await mark({ clientEventId: 'tap_3', feeStateAtCheckIn: 'EXPIRED' });

    store.member = { ...member, lastAttendanceAt: new Date(clock.now().getTime() - 60_000) };
    await expect(mark({ clientEventId: 'tap_4', feeStateAtCheckIn: 'EXPIRED' })).resolves.toMatchObject({
      decision: 'WITHIN_COOLDOWN',
      callTaskRaised: false,
    });

    expect(store.tasks).toEqual([]);
  });

  it('does not raise a second task while one is still open', async () => {
    store.openTaskExists = true;
    await expect(mark({ feeStateAtCheckIn: 'EXPIRED' })).resolves.toMatchObject({ decision: 'RECORD', callTaskRaised: false });
  });

  it('refuses a member who is not in this gym', async () => {
    store.member = null;
    await expect(mark()).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('marks a member who has left, because staff decide who is standing there (BR-9.4)', async () => {
    store.member = { ...member, status: 'LEFT' };
    await expect(mark()).resolves.toMatchObject({ decision: 'RECORD' });
  });
});

describe('undoAttendance', () => {
  let store: FakeStore;
  const clock = fakeClockAt('2026-09-12T11:30');

  beforeEach(() => {
    store = new FakeStore();
    store.event = { id: 'evt_1', gymId: 'gym_1', memberId: 'mem_1', voidedAt: null };
  });

  const undo = (eventId = 'evt_1', actor: CrmActor = reception) =>
    undoAttendance({ eventId }, { actor, clock, uow: { transaction: (work) => work(store) } });

  it('takes the check-in back, keeping the row so the correction is visible', async () => {
    await expect(undo()).resolves.toEqual({ memberId: 'mem_1' });
    expect(store.voided).toEqual([{ eventId: 'evt_1', at: clock.now() }]);
  });

  it('refuses an unknown check-in and one that was already taken back', async () => {
    await expect(undo('evt_other')).rejects.toMatchObject({ code: 'NOT_FOUND' });

    store.event = { id: 'evt_1', gymId: 'gym_1', memberId: 'mem_1', voidedAt: clock.now() };
    await expect(undo()).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(store.voided).toEqual([]);
  });
});
