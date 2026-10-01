import { describe, expect, it } from 'vitest';
import { istDate } from '@mfp/shared';
import { assertTrialAllowed, trialOptions, trialPeriod, trialQuote, type TrialSettings } from './trial';

/**
 * The paid trial (ADR-088).
 *
 * The gym calls it a free trial; it costs ₹100 a day. A newcomer buys a few days before
 * committing to a month, so it is priced by the day rather than from the plan catalogue —
 * there is no row to point at, and the member chooses the length.
 *
 * Two rules carry the weight. A trial is **for somebody who is not a member**: offering it
 * to a member who already pays monthly is a discount nobody asked for. And **the dates are
 * inclusive**, because a one-day trial is today, not today and tomorrow.
 */

const settings: TrialSettings = { trialEnabled: true, trialPerDayPaise: 10_000, trialDayOptions: [1, 2, 3, 5, 7] };

describe('trialQuote', () => {
  it('charges the day rate for each day', () => {
    expect(trialQuote({ days: 1, settings }).totalPaise).toBe(10_000);
    expect(trialQuote({ days: 3, settings }).totalPaise).toBe(30_000);
    expect(trialQuote({ days: 7, settings }).totalPaise).toBe(70_000);
  });

  it('refuses a length the gym does not offer', () => {
    // Not an arbitrary number of days: what is on sale is what the owner listed.
    expect(() => trialQuote({ days: 4, settings })).toThrow(expect.objectContaining({ code: 'VALIDATION_FAILED' }) as Error);
    expect(() => trialQuote({ days: 0, settings })).toThrow(expect.objectContaining({ code: 'VALIDATION_FAILED' }) as Error);
  });

  it('refuses when the gym has the trial switched off', () => {
    expect(() => trialQuote({ days: 3, settings: { ...settings, trialEnabled: false } })).toThrow(
      expect.objectContaining({ code: 'TRIAL_NOT_OFFERED' }) as Error,
    );
  });
});

describe('trialPeriod', () => {
  it('counts the first day as a day', () => {
    // A one-day trial is today. Off by one here is a free day for every trial member.
    expect(trialPeriod(istDate('2026-10-02'), 1)).toEqual({ startDate: '2026-10-02', endDate: '2026-10-02' });
    expect(trialPeriod(istDate('2026-10-02'), 3)).toEqual({ startDate: '2026-10-02', endDate: '2026-10-04' });
  });

  it('crosses a month end without arithmetic of its own', () => {
    expect(trialPeriod(istDate('2026-10-30'), 5).endDate).toBe('2026-11-03');
  });
});

describe('trialOptions', () => {
  it('prices every length the gym offers, shortest first', () => {
    expect(trialOptions(settings)).toEqual([
      { days: 1, totalPaise: 10_000 },
      { days: 2, totalPaise: 20_000 },
      { days: 3, totalPaise: 30_000 },
      { days: 5, totalPaise: 50_000 },
      { days: 7, totalPaise: 70_000 },
    ]);
  });

  it('offers nothing at all when the trial is switched off', () => {
    expect(trialOptions({ ...settings, trialEnabled: false })).toEqual([]);
  });
});

describe('assertTrialAllowed', () => {
  it('lets somebody with no history here take one', () => {
    expect(() => assertTrialAllowed({ membersOnThatMobile: 0, trialsOnThatMobile: 0 })).not.toThrow();
  });

  it('refuses somebody who is already a member', () => {
    // A trial is for deciding whether to join. Someone who has joined has decided.
    expect(() => assertTrialAllowed({ membersOnThatMobile: 1, trialsOnThatMobile: 0 })).toThrow(
      expect.objectContaining({ code: 'TRIAL_NOT_FOR_MEMBERS' }) as Error,
    );
  });

  it('refuses a second trial on the same number', () => {
    expect(() => assertTrialAllowed({ membersOnThatMobile: 0, trialsOnThatMobile: 1 })).toThrow(
      expect.objectContaining({ code: 'TRIAL_ALREADY_TAKEN' }) as Error,
    );
  });
});
