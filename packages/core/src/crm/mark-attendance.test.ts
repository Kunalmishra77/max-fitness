import { beforeEach, describe, expect, it } from 'vitest';
import { fakeClockAt } from '../testing/builders';
import type { CrmActor } from './permissions';
import {
  markAttendance,
  undoAttendance,
  type AttendanceEventRecord,
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
    await expect(mark()).resolves.toEqual({ decision: 'RECORD', eventId: 'evt_1' });

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
    await expect(mark()).resolves.toEqual({ decision: 'WITHIN_COOLDOWN', eventId: null });
    expect(store.created).toEqual([]);

    store.member = { ...member, lastAttendanceAt: new Date(clock.now().getTime() - 181 * 60_000) };
    await expect(mark()).resolves.toMatchObject({ decision: 'RECORD' });
  });

  it('treats the same tap arriving twice as the same visit', async () => {
    store.knownEventIds.add('tap_1');
    await expect(mark()).resolves.toEqual({ decision: 'DUPLICATE_EVENT', eventId: null });
    expect(store.created).toEqual([]);
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
