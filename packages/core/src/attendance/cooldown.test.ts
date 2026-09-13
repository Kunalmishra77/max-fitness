import { describe, expect, it } from 'vitest';
import {
  attendanceDateOf,
  cooldownDecision,
  correctForDeviceOffset,
  isEligibleForKioskGallery,
  kioskGreetingFor,
  shouldRecordAttendance,
} from './cooldown';
import { ist } from '../testing/builders';

const COOLDOWN = 180;

describe('cooldownDecision — BR-9.1, one visit per 180 minutes', () => {
  const capturedAt = ist('2026-09-10T18:00');

  it('records a first-ever visit', () => {
    expect(cooldownDecision({ capturedAt, lastAttendanceAt: null, cooldownMinutes: COOLDOWN })).toBe('RECORD');
  });

  it('rejects a second check-in 179 minutes later', () => {
    expect(
      cooldownDecision({
        capturedAt,
        lastAttendanceAt: new Date(capturedAt.getTime() - 179 * 60_000),
        cooldownMinutes: COOLDOWN,
      }),
    ).toBe('WITHIN_COOLDOWN');
  });

  it('records one 181 minutes later', () => {
    expect(
      cooldownDecision({
        capturedAt,
        lastAttendanceAt: new Date(capturedAt.getTime() - 181 * 60_000),
        cooldownMinutes: COOLDOWN,
      }),
    ).toBe('RECORD');
  });

  it('records at exactly the boundary — the window is "less than N minutes"', () => {
    expect(
      cooldownDecision({
        capturedAt,
        lastAttendanceAt: new Date(capturedAt.getTime() - 180 * 60_000),
        cooldownMinutes: COOLDOWN,
      }),
    ).toBe('RECORD');
  });

  it('rejects the same second twice — the camera catching one person twice', () => {
    expect(cooldownDecision({ capturedAt, lastAttendanceAt: capturedAt, cooldownMinutes: COOLDOWN })).toBe(
      'WITHIN_COOLDOWN',
    );
  });

  it('rejects a clock-skewed event from before the last one', () => {
    expect(
      cooldownDecision({
        capturedAt,
        lastAttendanceAt: new Date(capturedAt.getTime() + 60_000),
        cooldownMinutes: COOLDOWN,
      }),
    ).toBe('WITHIN_COOLDOWN');
  });

  it('reports a replayed upload separately from a cooldown skip', () => {
    expect(
      cooldownDecision({
        capturedAt,
        lastAttendanceAt: null,
        cooldownMinutes: COOLDOWN,
        isDuplicateEventId: true,
      }),
    ).toBe('DUPLICATE_EVENT');
  });

  it('honours a custom cooldown', () => {
    expect(
      cooldownDecision({
        capturedAt,
        lastAttendanceAt: new Date(capturedAt.getTime() - 45 * 60_000),
        cooldownMinutes: 30,
      }),
    ).toBe('RECORD');
  });

  it('shouldRecordAttendance agrees with the decision', () => {
    expect(shouldRecordAttendance({ capturedAt, lastAttendanceAt: null, cooldownMinutes: COOLDOWN })).toBe(true);
    expect(
      shouldRecordAttendance({ capturedAt, lastAttendanceAt: capturedAt, cooldownMinutes: COOLDOWN }),
    ).toBe(false);
  });
});

describe('attendanceDateOf — BR-9.2, the day is the IST date', () => {
  it('uses the IST calendar day, not the UTC one', () => {
    // 19:00 IST on the 10th is 13:30 UTC on the 10th.
    expect(attendanceDateOf(ist('2026-09-10T19:00'))).toBe('2026-09-10');
    // 05:30 IST on the 11th is 00:00 UTC on the 11th.
    expect(attendanceDateOf(ist('2026-09-11T05:30'))).toBe('2026-09-11');
    // An early-morning check-in at 05:45 IST still belongs to that IST day.
    expect(attendanceDateOf(ist('2026-09-11T05:45'))).toBe('2026-09-11');
  });

  it('puts a late-night check-in on the right day', () => {
    expect(attendanceDateOf(ist('2026-09-10T23:30'))).toBe('2026-09-10');
    expect(attendanceDateOf(ist('2026-09-11T00:15'))).toBe('2026-09-11');
  });
});

describe('correctForDeviceOffset — BR-9.2', () => {
  it('subtracts the device drift the server measured at heartbeat', () => {
    const deviceSays = ist('2026-09-10T19:05');
    // The device clock runs 5 minutes fast.
    expect(correctForDeviceOffset(deviceSays, 5 * 60_000).getTime()).toBe(ist('2026-09-10T19:00').getTime());
  });

  it('handles a slow clock too', () => {
    const deviceSays = ist('2026-09-10T18:55');
    expect(correctForDeviceOffset(deviceSays, -5 * 60_000).getTime()).toBe(ist('2026-09-10T19:00').getTime());
  });

  it('can move a check-in onto the correct day', () => {
    // Device says 00:10 on the 11th but is 20 minutes fast: really 23:50 on the 10th.
    expect(attendanceDateOf(correctForDeviceOffset(ist('2026-09-11T00:10'), 20 * 60_000))).toBe('2026-09-10');
  });
});

describe('isEligibleForKioskGallery — BR-9.5 and BR-12.2', () => {
  const eligible = {
    memberStatus: 'ACTIVE' as const,
    faceConsent: true,
    isMinor: false,
    hasParentalConsent: false,
  };

  it('includes an active adult who consented', () => {
    expect(isEligibleForKioskGallery(eligible)).toBe(true);
  });

  it('excludes anyone who did not consent to face attendance', () => {
    expect(isEligibleForKioskGallery({ ...eligible, faceConsent: false })).toBe(false);
  });

  it('excludes a minor until a parent consents', () => {
    expect(isEligibleForKioskGallery({ ...eligible, isMinor: true, hasParentalConsent: false })).toBe(false);
    expect(isEligibleForKioskGallery({ ...eligible, isMinor: true, hasParentalConsent: true })).toBe(true);
  });

  it('excludes every non-ACTIVE status, so a LEFT member stops matching on the next sync', () => {
    for (const status of ['LEFT', 'BLOCKED', 'PENDING_PAYMENT', 'PENDING_VERIFICATION'] as const) {
      expect(isEligibleForKioskGallery({ ...eligible, memberStatus: status }), status).toBe(false);
    }
  });
});

describe('kioskGreetingFor — BR-9.3', () => {
  it('greets a paid member in green', () => {
    expect(kioskGreetingFor('PAID', 30)).toEqual({ kind: 'WELCOME', tone: 'green' });
  });

  it('greets a due-soon member with the days left, in amber', () => {
    expect(kioskGreetingFor('DUE_SOON', 3)).toEqual({ kind: 'WELCOME_DUE_SOON', tone: 'amber', daysLeft: 3 });
    expect(kioskGreetingFor('DUE_SOON', 0)).toMatchObject({ daysLeft: 0 });
    expect(kioskGreetingFor('DUE_SOON', null)).toMatchObject({ daysLeft: 0 });
  });

  it('sends an expired member to reception', () => {
    expect(kioskGreetingFor('EXPIRED', -5)).toEqual({ kind: 'SEE_RECEPTION', tone: 'red' });
    expect(kioskGreetingFor('NONE', null)).toEqual({ kind: 'SEE_RECEPTION', tone: 'red' });
  });
});
