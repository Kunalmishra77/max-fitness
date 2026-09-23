import { describe, expect, it } from 'vitest';
import { FakeClock } from '@mfp/shared';
import { checkInCandidates, selfCheckIn, type CheckInStore, type LookupMember } from './check-in';

/**
 * A member marking themselves in at the reception tablet (BR-9; attendance spec §6).
 *
 * Nobody is standing over this screen, so it has to be strict about two things that a
 * member of staff would just know: the same person tapping twice is one visit, and the
 * screen must never show one member's name to somebody who typed a number that is not
 * theirs.
 */

const NOW = new Date('2026-09-24T12:00:00Z');
const clock = new FakeClock(NOW);

const member = (over: Partial<LookupMember> = {}): LookupMember => ({
  memberId: 'mem_1',
  fullName: 'Sanjay Tomar',
  memberCode: 'MF-0231',
  mobile: '+919876543210',
  status: 'ACTIVE',
  photoKey: 'selfies/mem_1.jpg',
  feeState: 'PAID',
  daysLeft: 12,
  ...over,
});

describe('checkInCandidates', () => {
  it('finds the member whose number was typed', () => {
    expect(checkInCandidates([member()], { mobile: '+919876543210' }).map((c) => c.memberId)).toEqual(['mem_1']);
  });

  it('offers every member on a shared family number', () => {
    const family = [member(), member({ memberId: 'mem_2', fullName: 'Kavita Tomar' })];

    expect(checkInCandidates(family, { mobile: '+919876543210' })).toHaveLength(2);
  });

  it('finds a member by their member code too, for someone who forgot the number', () => {
    expect(checkInCandidates([member()], { memberCode: 'mf-0231' }).map((c) => c.memberId)).toEqual(['mem_1']);
  });

  it('leaves out members who are not active, so the tablet shows nobody who left', () => {
    const gone = [member({ memberId: 'mem_3', status: 'LEFT' })];

    expect(checkInCandidates(gone, { mobile: '+919876543210' })).toEqual([]);
  });

  it('shows nobody at all when the number belongs to nobody', () => {
    expect(checkInCandidates([member()], { mobile: '+919000000000' })).toEqual([]);
  });

  it('refuses to answer a query with neither a number nor a code', () => {
    expect(checkInCandidates([member()], {})).toEqual([]);
  });

  it('will not turn into a member list for a short prefix', () => {
    // A partial number is not a lookup; it is someone fishing for names.
    expect(checkInCandidates([member()], { mobile: '+9198' })).toEqual([]);
  });
});

function store(over: { member?: LookupMember | null; lastAttendanceAt?: Date | null; duplicate?: boolean } = {}) {
  const events: Array<{ memberId: string; method: string; clientEventId: string }> = [];
  const tasks: string[] = [];
  const impl: CheckInStore = {
    memberForCheckIn: () =>
      Promise.resolve(
        over.member === null
          ? null
          : { ...(over.member ?? member()), lastAttendanceAt: over.lastAttendanceAt ?? null },
      ),
    hasEventId: () => Promise.resolve(over.duplicate ?? false),
    createEvent: (record) => {
      events.push({ memberId: record.memberId, method: record.method, clientEventId: record.clientEventId });
      return Promise.resolve(`evt_${events.length}`);
    },
    raiseCallTask: (task) => {
      tasks.push(task.memberId);
      return Promise.resolve(true);
    },
  };
  return { events, tasks, impl };
}

const run = (s: ReturnType<typeof store>, over: { method?: 'KEYPAD' | 'FACE' | 'FACE_CONFIRMED'; shadowMode?: boolean } = {}) =>
  selfCheckIn(
    { gymId: 'gym_1', memberId: 'mem_1', clientEventId: 'evt-abc', method: over.method ?? 'KEYPAD' },
    { clock, cooldownMinutes: 180, shadowMode: over.shadowMode ?? false, uow: { transaction: (work) => work(s.impl) } },
  );

describe('selfCheckIn', () => {
  it('records the visit and greets a paid-up member', async () => {
    const s = store();

    const result = await run(s);

    expect(result).toMatchObject({ decision: 'RECORD', greeting: { kind: 'WELCOME', tone: 'green' } });
    expect(result.memberName).toBe('Sanjay Tomar');
    expect(s.events).toEqual([{ memberId: 'mem_1', method: 'KEYPAD', clientEventId: 'evt-abc' }]);
  });

  it('tells a member whose fees are nearly up, and still lets them in', async () => {
    const s = store({ member: member({ feeState: 'DUE_SOON', daysLeft: 3 }) });

    expect(await run(s)).toMatchObject({ decision: 'RECORD', greeting: { kind: 'WELCOME_DUE_SOON', tone: 'amber', daysLeft: 3 } });
  });

  it('sends an expired member to reception, and puts them on the call list (BR-9.3)', async () => {
    const s = store({ member: member({ feeState: 'EXPIRED', daysLeft: -6 }) });

    const result = await run(s);

    expect(result.greeting).toEqual({ kind: 'SEE_RECEPTION', tone: 'red' });
    // The visit is still recorded: they came, and that is the fact.
    expect(s.events).toHaveLength(1);
    expect(s.tasks).toEqual(['mem_1']);
  });

  it('never tells the member what they owe', async () => {
    const s = store({ member: member({ feeState: 'EXPIRED', daysLeft: -6 }) });

    // BR-9.3: money is discussed at the desk, not on a screen other members can see.
    expect(JSON.stringify(await run(s))).not.toMatch(/amount|paise|₹/i);
  });

  it('counts a second tap inside the cooldown as the same visit', async () => {
    const s = store({ lastAttendanceAt: new Date(NOW.getTime() - 60 * 60_000) });

    expect(await run(s)).toMatchObject({ decision: 'WITHIN_COOLDOWN', eventId: null });
    expect(s.events).toEqual([]);
  });

  it('lets them in again once the cooldown has passed', async () => {
    const s = store({ lastAttendanceAt: new Date(NOW.getTime() - 181 * 60_000) });

    expect(await run(s)).toMatchObject({ decision: 'RECORD' });
  });

  it('writes nothing when the same tap arrives twice', async () => {
    const s = store({ duplicate: true });

    expect(await run(s)).toMatchObject({ decision: 'DUPLICATE_EVENT', eventId: null });
    expect(s.events).toEqual([]);
  });

  it('records how the member was recognised, so accuracy can be reviewed later', async () => {
    const s = store();

    await run(s, { method: 'FACE' });

    expect(s.events[0]?.method).toBe('FACE');
  });

  it('in shadow mode it records the visit but greets nobody', async () => {
    // The first fortnight: the tablet watches and marks, so the owner can see whether
    // it gets people right, without a wrong greeting in front of the gym.
    const s = store();

    const result = await run(s, { shadowMode: true });

    expect(result.decision).toBe('RECORD');
    expect(result.greeting).toBeNull();
    expect(s.events).toHaveLength(1);
  });

  it('says nothing about a member who does not exist', async () => {
    const s = store({ member: null });

    expect(await run(s)).toMatchObject({ decision: 'NOT_FOUND', eventId: null, greeting: null, memberName: null });
    expect(s.events).toEqual([]);
  });
});
