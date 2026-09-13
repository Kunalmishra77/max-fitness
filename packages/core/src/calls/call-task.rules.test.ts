import { describe, expect, it } from 'vitest';
import { addDays, istDate } from '@mfp/shared';
import {
  MAX_NO_ANSWER_ATTEMPTS,
  applyOutcome,
  compareCallTasks,
  nightlyCallTasksFor,
  shouldAutoClose,
  shouldCreateAbsent7Days,
  shouldCreateDueSoonNoResponse,
  shouldCreateExpiredButVisiting,
  shouldCreateExpiredNotRenewed,
  shouldCreateNewLead,
  shouldCreateSignupNotPaid,
  shouldCreateVerificationPending,
  type MemberSnapshotForCallTasks,
} from './call-task.rules';
import { ist } from '../testing/builders';

const T = istDate('2026-09-10');

describe('EXPIRED_BUT_VISITING — priority 1', () => {
  it('fires when an expired member checks in', () => {
    expect(shouldCreateExpiredButVisiting({ feeStateAtCheckIn: 'EXPIRED', memberStatus: 'ACTIVE' })).toBe(true);
  });

  it('does not fire for a paid-up or due-soon member', () => {
    expect(shouldCreateExpiredButVisiting({ feeStateAtCheckIn: 'PAID', memberStatus: 'ACTIVE' })).toBe(false);
    expect(shouldCreateExpiredButVisiting({ feeStateAtCheckIn: 'DUE_SOON', memberStatus: 'ACTIVE' })).toBe(false);
  });

  it('does not fire for someone who has already left', () => {
    expect(shouldCreateExpiredButVisiting({ feeStateAtCheckIn: 'EXPIRED', memberStatus: 'LEFT' })).toBe(false);
  });
});

describe('SIGNUP_NOT_PAID — after 24 hours', () => {
  const registeredAt = ist('2026-09-09T10:00');

  it('fires just past 24 hours', () => {
    expect(
      shouldCreateSignupNotPaid({
        memberStatus: 'PENDING_PAYMENT',
        registeredAt,
        now: ist('2026-09-10T10:01'),
      }),
    ).toBe(true);
  });

  it('does not fire at 23 hours', () => {
    expect(
      shouldCreateSignupNotPaid({
        memberStatus: 'PENDING_PAYMENT',
        registeredAt,
        now: ist('2026-09-10T09:00'),
      }),
    ).toBe(false);
  });

  it('does not fire once they have paid', () => {
    expect(
      shouldCreateSignupNotPaid({ memberStatus: 'ACTIVE', registeredAt, now: ist('2026-09-11T10:00') }),
    ).toBe(false);
  });
});

describe('NEW_LEAD — 2 gym hours, not 2 wall-clock hours', () => {
  it('fires at two gym hours', () => {
    expect(shouldCreateNewLead({ leadStatus: 'NEW', gymHoursSinceCreated: 2 })).toBe(true);
  });

  it('does not fire before that', () => {
    expect(shouldCreateNewLead({ leadStatus: 'NEW', gymHoursSinceCreated: 1.9 })).toBe(false);
  });

  it('does not fire once the lead has been contacted', () => {
    expect(shouldCreateNewLead({ leadStatus: 'CONTACTED', gymHoursSinceCreated: 10 })).toBe(false);
  });
});

describe('VERIFICATION_PENDING — after 2 hours', () => {
  it('fires at two hours on a pending request', () => {
    expect(
      shouldCreateVerificationPending({
        submittedAt: ist('2026-09-10T08:00'),
        now: ist('2026-09-10T10:00'),
        status: 'PENDING',
      }),
    ).toBe(true);
  });

  it('does not fire once decided', () => {
    expect(
      shouldCreateVerificationPending({
        submittedAt: ist('2026-09-10T08:00'),
        now: ist('2026-09-10T10:00'),
        status: 'APPROVED',
      }),
    ).toBe(false);
  });
});

describe('EXPIRED_NOT_RENEWED — day +3, and again at the reminder cap', () => {
  const base = { today: T, memberStatus: 'ACTIVE' as const, postExpiryMaxDays: 7 };

  it('fires on day +3', () => {
    expect(shouldCreateExpiredNotRenewed({ ...base, effectiveEndDate: addDays(T, -3) })).toBe(true);
  });

  it('does not fire on days +1, +2 or +4', () => {
    for (const day of [1, 2, 4]) {
      expect(
        shouldCreateExpiredNotRenewed({ ...base, effectiveEndDate: addDays(T, -day) }),
        `day +${day}`,
      ).toBe(false);
    }
  });

  it('BR-5.7 — fires again the day after automatic reminders stop', () => {
    expect(shouldCreateExpiredNotRenewed({ ...base, effectiveEndDate: addDays(T, -8) })).toBe(true);
  });

  it('never fires the cap rule when reminders are uncapped', () => {
    expect(
      shouldCreateExpiredNotRenewed({ ...base, postExpiryMaxDays: null, effectiveEndDate: addDays(T, -8) }),
    ).toBe(false);
  });

  it('ignores members who are not ACTIVE or have no membership', () => {
    expect(
      shouldCreateExpiredNotRenewed({ ...base, memberStatus: 'LEFT', effectiveEndDate: addDays(T, -3) }),
    ).toBe(false);
    expect(shouldCreateExpiredNotRenewed({ ...base, effectiveEndDate: null })).toBe(false);
  });
});

describe('DUE_SOON_NO_RESPONSE — the day before expiry', () => {
  const base = {
    today: T,
    memberStatus: 'ACTIVE' as const,
    remindersDelivered: true,
    hasUpcomingMembership: false,
    effectiveEndDate: addDays(T, 1),
  };

  it('fires the day before expiry when reminders were delivered', () => {
    expect(shouldCreateDueSoonNoResponse(base)).toBe(true);
  });

  it('does not fire two days before, or on the day itself', () => {
    expect(shouldCreateDueSoonNoResponse({ ...base, effectiveEndDate: addDays(T, 2) })).toBe(false);
    expect(shouldCreateDueSoonNoResponse({ ...base, effectiveEndDate: T })).toBe(false);
  });

  it('does not fire if reminders never reached them — call the delivery problem instead', () => {
    expect(shouldCreateDueSoonNoResponse({ ...base, remindersDelivered: false })).toBe(false);
  });

  it('does not fire when they have already renewed', () => {
    expect(shouldCreateDueSoonNoResponse({ ...base, hasUpcomingMembership: true })).toBe(false);
  });
});

describe('ABSENT_7_DAYS — once per absence streak', () => {
  const base = {
    today: T,
    memberStatus: 'ACTIVE' as const,
    feeState: 'PAID' as const,
    lastAttendanceDate: addDays(T, -7),
    absentDaysThreshold: 7,
    alreadyRaisedThisStreak: false,
  };

  it('fires at the threshold', () => {
    expect(shouldCreateAbsent7Days(base)).toBe(true);
  });

  it('does not fire a day early', () => {
    expect(shouldCreateAbsent7Days({ ...base, lastAttendanceDate: addDays(T, -6) })).toBe(false);
  });

  it('fires only once per streak — a month absent is one call, not thirty', () => {
    expect(
      shouldCreateAbsent7Days({ ...base, lastAttendanceDate: addDays(T, -30), alreadyRaisedThisStreak: true }),
    ).toBe(false);
  });

  it('applies to DUE_SOON members too, but not to expired ones', () => {
    expect(shouldCreateAbsent7Days({ ...base, feeState: 'DUE_SOON' })).toBe(true);
    // An expired member is already on the list for a better reason.
    expect(shouldCreateAbsent7Days({ ...base, feeState: 'EXPIRED' })).toBe(false);
    expect(shouldCreateAbsent7Days({ ...base, feeState: 'NONE' })).toBe(false);
  });

  it('does not fire for a member who has never attended', () => {
    expect(shouldCreateAbsent7Days({ ...base, lastAttendanceDate: null })).toBe(false);
  });

  it('ignores non-ACTIVE members', () => {
    expect(shouldCreateAbsent7Days({ ...base, memberStatus: 'LEFT' })).toBe(false);
  });
});

describe('nightlyCallTasksFor', () => {
  const settings = { postExpiryMaxDays: 7, absentDaysThreshold: 7 };

  function snapshot(overrides: Partial<MemberSnapshotForCallTasks> = {}): MemberSnapshotForCallTasks {
    return {
      memberStatus: 'ACTIVE',
      feeState: 'PAID',
      effectiveEndDate: addDays(T, 30),
      lastAttendanceDate: T,
      remindersDelivered: false,
      hasUpcomingMembership: false,
      absentTaskAlreadyRaisedThisStreak: false,
      openReasons: [],
      ...overrides,
    };
  }

  it('produces nothing for a healthy, attending member', () => {
    expect(nightlyCallTasksFor(T, snapshot(), settings)).toEqual([]);
  });

  it('produces the expired task with its priority and due date', () => {
    const tasks = nightlyCallTasksFor(
      T,
      snapshot({ feeState: 'EXPIRED', effectiveEndDate: addDays(T, -3) }),
      settings,
    );
    expect(tasks).toEqual([{ reason: 'EXPIRED_NOT_RENEWED', priority: 3, dueDate: T }]);
  });

  it('can produce several tasks at once', () => {
    const tasks = nightlyCallTasksFor(
      T,
      snapshot({
        feeState: 'DUE_SOON',
        effectiveEndDate: addDays(T, 1),
        remindersDelivered: true,
        lastAttendanceDate: addDays(T, -10),
      }),
      settings,
    );
    expect(tasks.map((t) => t.reason).sort()).toEqual(['ABSENT_7_DAYS', 'DUE_SOON_NO_RESPONSE']);
  });

  it('never duplicates a reason that is already open', () => {
    const tasks = nightlyCallTasksFor(
      T,
      snapshot({
        feeState: 'EXPIRED',
        effectiveEndDate: addDays(T, -3),
        openReasons: ['EXPIRED_NOT_RENEWED'],
      }),
      settings,
    );
    expect(tasks).toEqual([]);
  });
});

describe('applyOutcome — BR-7', () => {
  it('WILL_RENEW snoozes two days rather than closing', () => {
    expect(applyOutcome({ outcome: 'WILL_RENEW', today: T, attempts: 0 })).toEqual({
      closeTask: false,
      snoozeUntil: '2026-09-12',
      markMemberLeft: false,
      retry: false,
    });
  });

  it('CALL_LATER honours the chosen date, defaulting to tomorrow', () => {
    expect(applyOutcome({ outcome: 'CALL_LATER', today: T, attempts: 0 }).snoozeUntil).toBe('2026-09-11');
    expect(
      applyOutcome({ outcome: 'CALL_LATER', today: T, attempts: 0, snoozeChoice: istDate('2026-09-15') })
        .snoozeUntil,
    ).toBe('2026-09-15');
  });

  it('NO_ANSWER retries the next day, up to three attempts', () => {
    expect(applyOutcome({ outcome: 'NO_ANSWER', today: T, attempts: 0 })).toMatchObject({
      closeTask: false,
      retry: true,
      snoozeUntil: '2026-09-11',
    });
    expect(applyOutcome({ outcome: 'NO_ANSWER', today: T, attempts: 1 }).retry).toBe(true);
    // The third attempt exhausts it.
    expect(applyOutcome({ outcome: 'NO_ANSWER', today: T, attempts: MAX_NO_ANSWER_ATTEMPTS - 1 })).toEqual({
      closeTask: true,
      snoozeUntil: null,
      markMemberLeft: false,
      retry: false,
    });
  });

  it('LEFT_GYM closes the task and marks the member LEFT', () => {
    expect(applyOutcome({ outcome: 'LEFT_GYM', today: T, attempts: 0 })).toMatchObject({
      closeTask: true,
      markMemberLeft: true,
    });
  });

  it('WRONG_NUMBER and DONE simply close', () => {
    for (const outcome of ['WRONG_NUMBER', 'DONE'] as const) {
      expect(applyOutcome({ outcome, today: T, attempts: 0 }), outcome).toMatchObject({
        closeTask: true,
        markMemberLeft: false,
      });
    }
  });
});

describe('shouldAutoClose — tasks clear themselves', () => {
  const renewed = { feeState: 'PAID' as const, memberStatus: 'ACTIVE' as const, hasUpcomingMembership: false };
  const stillExpired = {
    feeState: 'EXPIRED' as const,
    memberStatus: 'ACTIVE' as const,
    hasUpcomingMembership: false,
  };

  it('closes the expiry-related tasks once the member renews', () => {
    for (const reason of ['EXPIRED_BUT_VISITING', 'EXPIRED_NOT_RENEWED', 'DUE_SOON_NO_RESPONSE'] as const) {
      expect(shouldAutoClose(reason, renewed), reason).toBe(true);
      expect(shouldAutoClose(reason, stillExpired), reason).toBe(false);
    }
  });

  it('treats an early renewal as renewed', () => {
    expect(shouldAutoClose('EXPIRED_NOT_RENEWED', { ...stillExpired, hasUpcomingMembership: true })).toBe(true);
  });

  it('closes SIGNUP_NOT_PAID once the member goes ACTIVE', () => {
    expect(shouldAutoClose('SIGNUP_NOT_PAID', { ...stillExpired, memberStatus: 'ACTIVE' })).toBe(true);
    expect(shouldAutoClose('SIGNUP_NOT_PAID', { ...stillExpired, memberStatus: 'PENDING_PAYMENT' })).toBe(false);
  });

  it('closes VERIFICATION_PENDING once the request is decided', () => {
    expect(shouldAutoClose('VERIFICATION_PENDING', { ...renewed, memberStatus: 'ACTIVE' })).toBe(true);
    expect(
      shouldAutoClose('VERIFICATION_PENDING', { ...renewed, memberStatus: 'PENDING_VERIFICATION' }),
    ).toBe(false);
  });

  it('never auto-closes the reasons that need a human — someone must actually ring', () => {
    for (const reason of ['ABSENT_7_DAYS', 'NEW_LEAD', 'UNSUBSCRIBED', 'OTHER'] as const) {
      expect(shouldAutoClose(reason, renewed), reason).toBe(false);
    }
  });
});

describe('compareCallTasks — list order', () => {
  it('sorts by priority, then by oldest due date', () => {
    const tasks = [
      { priority: 3, dueDate: istDate('2026-09-01') },
      { priority: 1, dueDate: istDate('2026-09-10') },
      { priority: 3, dueDate: istDate('2026-08-01') },
    ];
    expect([...tasks].sort(compareCallTasks)).toEqual([
      { priority: 1, dueDate: '2026-09-10' },
      { priority: 3, dueDate: '2026-08-01' },
      { priority: 3, dueDate: '2026-09-01' },
    ]);
  });
});
