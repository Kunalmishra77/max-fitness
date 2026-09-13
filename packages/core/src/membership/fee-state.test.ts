import { describe, expect, it } from 'vitest';
import { addDays, istDate } from '@mfp/shared';
import { buildMembership } from '../testing/builders';
import { classify, daysExpired, feeState, feeStateLabelKey, shouldAutoMarkLeft } from './fee-state';

const TODAY = istDate('2026-09-10');

/** A confirmed membership ending `daysFromToday` days from TODAY. */
function ending(daysFromToday: number, overrides: Record<string, unknown> = {}) {
  const end = addDays(TODAY, daysFromToday);
  // Start early enough that the membership covers today; a start after today would be
  // a future membership, whose correct fee state is NONE.
  return buildMembership({ startDate: addDays(end, -Math.max(29, daysFromToday)), endDate: end, ...overrides });
}

describe('classify — BR-4.2 thresholds', () => {
  it('is PAID above 7 days left', () => {
    expect(classify(8)).toBe('PAID');
    expect(classify(365)).toBe('PAID');
  });

  it('is DUE_SOON from 0 to 7 days inclusive', () => {
    for (let n = 0; n <= 7; n += 1) {
      expect(classify(n), `${n} days left`).toBe('DUE_SOON');
    }
  });

  it('is EXPIRED below zero — 0 means "ends today", not "expired"', () => {
    expect(classify(-1)).toBe('EXPIRED');
    expect(classify(-100)).toBe('EXPIRED');
  });
});

describe('feeState — the basic cases', () => {
  it('is NONE with no memberships at all', () => {
    expect(feeState(TODAY, [])).toMatchObject({
      feeState: 'NONE',
      daysLeft: null,
      effectiveEndDate: null,
      membershipId: null,
    });
  });

  it('is NONE when nothing is confirmed', () => {
    expect(feeState(TODAY, [ending(30, { status: 'PENDING_PAYMENT' })]).feeState).toBe('NONE');
    expect(feeState(TODAY, [ending(30, { status: 'CANCELLED' })]).feeState).toBe('NONE');
  });

  it('is PAID well before the end date', () => {
    const result = feeState(TODAY, [ending(30)]);
    expect(result.feeState).toBe('PAID');
    expect(result.daysLeft).toBe(30);
    expect(result.effectiveEndDate).toBe('2026-10-10');
  });

  it('is DUE_SOON exactly 7 days out — the PRE_7 reminder day', () => {
    expect(feeState(TODAY, [ending(7)])).toMatchObject({ feeState: 'DUE_SOON', daysLeft: 7 });
  });

  it('is PAID at 8 days out', () => {
    expect(feeState(TODAY, [ending(8)])).toMatchObject({ feeState: 'PAID', daysLeft: 8 });
  });

  it('is DUE_SOON on the last day, with zero days left', () => {
    expect(feeState(TODAY, [ending(0)])).toMatchObject({ feeState: 'DUE_SOON', daysLeft: 0 });
  });

  it('is EXPIRED the day after the end date', () => {
    expect(feeState(TODAY, [ending(-1)])).toMatchObject({ feeState: 'EXPIRED', daysLeft: -1 });
  });

  it('reports the membership the state came from', () => {
    const m = ending(30);
    expect(feeState(TODAY, [m]).membershipId).toBe(m.id);
  });
});

describe('feeState — history', () => {
  it('uses the membership covering today, not the newest row', () => {
    const old = buildMembership({ startDate: istDate('2026-06-01'), endDate: istDate('2026-08-31') });
    const current = ending(20);
    expect(feeState(TODAY, [current, old]).membershipId).toBe(current.id);
  });

  it('falls back to the latest ended membership when nothing covers today', () => {
    const older = buildMembership({ startDate: istDate('2026-01-01'), endDate: istDate('2026-03-31') });
    const newer = buildMembership({ startDate: istDate('2026-06-01'), endDate: istDate('2026-08-31') });
    const result = feeState(TODAY, [older, newer]);
    expect(result.membershipId).toBe(newer.id);
    expect(result.feeState).toBe('EXPIRED');
    expect(result.daysLeft).toBe(-10);
  });

  it('ignores a cancelled membership even when it is the newest', () => {
    const active = ending(20);
    const cancelled = ending(200, { status: 'CANCELLED' });
    expect(feeState(TODAY, [active, cancelled]).membershipId).toBe(active.id);
  });
});

describe('feeState — early renewal (BR-4.2 last sentence)', () => {
  it('extends through a membership starting the day after the current one ends', () => {
    const current = ending(2); // ends 2026-09-12
    const upcoming = buildMembership({
      startDate: addDays(current.endDate, 1),
      endDate: addDays(current.endDate, 31),
    });

    const result = feeState(TODAY, [current, upcoming]);
    expect(result.feeState).toBe('PAID');
    expect(result.daysLeft).toBe(33);
    expect(result.effectiveEndDate).toBe(upcoming.endDate);
    expect(result.extendedByUpcoming).toBe(true);
    // The base membership is still the one covering today — that is what a reminder
    // is about, and what the eligibility check compares against.
    expect(result.membershipId).toBe(current.id);
  });

  it('follows a chain of several contiguous renewals', () => {
    const first = ending(2);
    const second = buildMembership({
      startDate: addDays(first.endDate, 1),
      endDate: addDays(first.endDate, 31),
    });
    const third = buildMembership({
      startDate: addDays(second.endDate, 1),
      endDate: addDays(second.endDate, 31),
    });

    const result = feeState(TODAY, [first, second, third]);
    expect(result.effectiveEndDate).toBe(third.endDate);
    expect(result.feeState).toBe('PAID');
  });

  it('does NOT extend across a gap — ADR-014', () => {
    // Ended in March; a booking starts next January. Today they are expired.
    const lapsed = buildMembership({ startDate: istDate('2026-01-01'), endDate: istDate('2026-03-31') });
    const distantFuture = buildMembership({
      startDate: istDate('2027-01-01'),
      endDate: istDate('2027-01-31'),
    });

    const result = feeState(TODAY, [lapsed, distantFuture]);
    expect(result.feeState).toBe('EXPIRED');
    expect(result.effectiveEndDate).toBe('2026-03-31');
    expect(result.extendedByUpcoming).toBe(false);
  });

  it('does not extend when the next membership starts two days later, leaving a gap', () => {
    const current = ending(2);
    const gapped = buildMembership({
      startDate: addDays(current.endDate, 2),
      endDate: addDays(current.endDate, 32),
    });
    const result = feeState(TODAY, [current, gapped]);
    expect(result.effectiveEndDate).toBe(current.endDate);
    expect(result.feeState).toBe('DUE_SOON');
  });

  it('is NONE when only a future membership exists — not yet a paying member', () => {
    const future = buildMembership({ startDate: addDays(TODAY, 10), endDate: addDays(TODAY, 40) });
    expect(feeState(TODAY, [future]).feeState).toBe('NONE');
  });

  it('ignores a start-less declared membership when chaining', () => {
    const current = ending(2);
    const declared = buildMembership({ startDate: null, endDate: addDays(current.endDate, 31) });
    expect(feeState(TODAY, [current, declared]).extendedByUpcoming).toBe(false);
  });
});

describe('daysExpired', () => {
  it('counts days past the end date and is zero while valid', () => {
    expect(daysExpired(TODAY, istDate('2026-09-01'))).toBe(9);
    expect(daysExpired(TODAY, istDate('2026-09-10'))).toBe(0);
    expect(daysExpired(TODAY, istDate('2026-09-20'))).toBe(0);
    expect(daysExpired(TODAY, null)).toBe(0);
  });
});

describe('shouldAutoMarkLeft — BR-4.3', () => {
  const base = {
    today: TODAY,
    memberStatus: 'ACTIVE',
    effectiveEndDate: addDays(TODAY, -60),
    autoLeftAfterDays: 60,
    hadCallTask: true,
  };

  it('marks an ACTIVE member LEFT at exactly the threshold', () => {
    expect(shouldAutoMarkLeft(base)).toBe(true);
  });

  it('does not mark them a day early', () => {
    expect(shouldAutoMarkLeft({ ...base, effectiveEndDate: addDays(TODAY, -59) })).toBe(false);
  });

  it('refuses when nobody ever tried to ring them', () => {
    expect(shouldAutoMarkLeft({ ...base, hadCallTask: false })).toBe(false);
  });

  it('leaves non-ACTIVE members alone', () => {
    expect(shouldAutoMarkLeft({ ...base, memberStatus: 'LEFT' })).toBe(false);
    expect(shouldAutoMarkLeft({ ...base, memberStatus: 'BLOCKED' })).toBe(false);
  });

  it('never fires for a member with no membership', () => {
    expect(shouldAutoMarkLeft({ ...base, effectiveEndDate: null })).toBe(false);
  });
});

describe('feeStateLabelKey', () => {
  it('produces i18n keys in the documented shape', () => {
    expect(feeStateLabelKey('PAID')).toBe('crm.feeState.paid');
    expect(feeStateLabelKey('DUE_SOON')).toBe('crm.feeState.dueSoon');
    expect(feeStateLabelKey('EXPIRED')).toBe('crm.feeState.expired');
    expect(feeStateLabelKey('NONE')).toBe('crm.feeState.none');
  });
});
