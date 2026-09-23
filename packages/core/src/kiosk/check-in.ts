import { CALL_TASK_PRIORITY, type Clock, type FeeState, type ISTDate, type MemberStatus } from '@mfp/shared';
import { attendanceDateOf, cooldownDecision, kioskGreetingFor, type CooldownDecision, type KioskGreeting } from '../attendance/cooldown';
import { shouldCreateExpiredButVisiting } from '../calls/call-task.rules';

/**
 * A member marking themselves in at the reception tablet (BR-9; attendance spec §6).
 *
 * Nobody is standing over this screen, so it has to be strict about the two things a
 * member of staff would simply know. The same person tapping twice is one visit — the
 * cooldown is the same BR-9.1 rule the desk uses, because a visit is a visit however
 * it was recorded. And the screen must never show one member's name to somebody who
 * typed a number that is not theirs, which is why a lookup needs a whole number or a
 * whole member code and never a prefix.
 *
 * What it deliberately does **not** say is how much anybody owes. An expired member is
 * sent to the desk; the amount is discussed there, not on a screen the next person in
 * the queue is reading over their shoulder (BR-9.3).
 */

export interface LookupMember {
  readonly memberId: string;
  readonly fullName: string;
  readonly memberCode: string | null;
  readonly mobile: string;
  readonly status: MemberStatus;
  readonly photoKey: string | null;
  readonly feeState: FeeState;
  readonly daysLeft: number | null;
}

export interface CheckInCandidate {
  readonly memberId: string;
  readonly fullName: string;
  readonly photoKey: string | null;
}

/** A whole Indian mobile, in the form the database stores. */
const FULL_MOBILE = /^\+91\d{10}$/;

/**
 * Who the tablet may show for what was typed.
 *
 * A partial number is not a lookup, it is somebody fishing for names, so nothing
 * short of a whole number or a whole member code answers. A family shares one number
 * (BR-1.3), so more than one name is a normal answer, not an error.
 */
export function checkInCandidates(members: readonly LookupMember[], query: { mobile?: string; memberCode?: string }): CheckInCandidate[] {
  const mobile = query.mobile?.trim() ?? '';
  const memberCode = query.memberCode?.trim().toUpperCase() ?? '';
  if (!FULL_MOBILE.test(mobile) && memberCode === '') return [];

  return members
    .filter((member) => member.status === 'ACTIVE')
    .filter((member) => (FULL_MOBILE.test(mobile) ? member.mobile === mobile : member.memberCode?.toUpperCase() === memberCode))
    .map((member) => ({ memberId: member.memberId, fullName: member.fullName, photoKey: member.photoKey }));
}

export type CheckInMethod = 'KEYPAD' | 'FACE' | 'FACE_CONFIRMED';

export interface CheckInEventRecord {
  readonly gymId: string;
  readonly memberId: string;
  readonly clientEventId: string;
  readonly method: CheckInMethod;
  readonly capturedAt: Date;
  readonly attendanceDate: ISTDate;
  readonly feeStateAtCheckIn: FeeState;
}

export interface CheckInStore {
  memberForCheckIn(gymId: string, memberId: string): Promise<(LookupMember & { lastAttendanceAt: Date | null }) | null>;
  hasEventId(clientEventId: string): Promise<boolean>;
  createEvent(record: CheckInEventRecord): Promise<string>;
  raiseCallTask(task: { gymId: string; memberId: string; reason: 'EXPIRED_BUT_VISITING'; priority: number; dueDate: ISTDate }): Promise<boolean>;
}

export interface CheckInResult {
  readonly decision: CooldownDecision | 'NOT_FOUND';
  readonly eventId: string | null;
  /** Null in shadow mode, and for a member the tablet does not know. */
  readonly greeting: KioskGreeting | null;
  readonly memberName: string | null;
  readonly callTaskRaised: boolean;
}

const NOTHING = { eventId: null, greeting: null, memberName: null, callTaskRaised: false } as const;

export async function selfCheckIn(
  input: { gymId: string; memberId: string; clientEventId: string; method: CheckInMethod },
  deps: {
    clock: Clock;
    cooldownMinutes: number;
    /** The tablet marks attendance but greets nobody, until the owner trusts it. */
    shadowMode: boolean;
    uow: { transaction<T>(work: (store: CheckInStore) => Promise<T>): Promise<T> };
  },
): Promise<CheckInResult> {
  const now = deps.clock.now();

  return deps.uow.transaction(async (store) => {
    const member = await store.memberForCheckIn(input.gymId, input.memberId);
    if (member === null) return { decision: 'NOT_FOUND', ...NOTHING };

    const decision = cooldownDecision({
      capturedAt: now,
      lastAttendanceAt: member.lastAttendanceAt,
      cooldownMinutes: deps.cooldownMinutes,
      isDuplicateEventId: await store.hasEventId(input.clientEventId),
    });
    // "Already marked" is not a failure, and the member is told so rather than being
    // left tapping. The greeting is withheld because nothing was recorded.
    if (decision !== 'RECORD') return { decision, ...NOTHING, memberName: member.fullName };

    const eventId = await store.createEvent({
      gymId: input.gymId,
      memberId: member.memberId,
      clientEventId: input.clientEventId,
      method: input.method,
      capturedAt: now,
      attendanceDate: attendanceDateOf(now),
      feeStateAtCheckIn: member.feeState,
    });

    // BR-7 / BR-9.3: somebody still turning up after their fees ran out is the warmest
    // lead the gym has, and the call is what recovers the membership — not the screen.
    const callTaskRaised = shouldCreateExpiredButVisiting({ feeStateAtCheckIn: member.feeState, memberStatus: member.status })
      ? await store.raiseCallTask({
          gymId: input.gymId,
          memberId: member.memberId,
          reason: 'EXPIRED_BUT_VISITING',
          priority: CALL_TASK_PRIORITY.EXPIRED_BUT_VISITING,
          dueDate: attendanceDateOf(now),
        })
      : false;

    return {
      decision,
      eventId,
      greeting: deps.shadowMode ? null : kioskGreetingFor(member.feeState, member.daysLeft),
      memberName: member.fullName,
      callTaskRaised,
    };
  });
}
