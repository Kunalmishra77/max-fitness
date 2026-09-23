import { describe, expect, it } from 'vitest';
import { addDays, istDate, istTime } from '@mfp/shared';
import {
  DEFAULT_QUIET_HOURS,
  buildDefaultReminderRules,
  buildReminderRule,
} from '../testing/builders';
import {
  candidateEndDates,
  distinctSlots,
  isBeyondPostExpiryCap,
  matchingRules,
  offsetFromEndDate,
  reminderIdempotencyKey,
  ruleCoversOffset,
} from './rules';
import { checkReminderEligibility, isWithinQuietHours, type EligibilityInput } from './eligibility';

const T = istDate('2026-09-10');
const RULES = buildDefaultReminderRules(7);

/** Which rule codes fire for a membership ending `offset` days from today, at `slot`. */
function firing(offsetDays: number, slot: string, rules = RULES): string[] {
  return matchingRules(rules, T, addDays(T, offsetDays), slot).map((r) => r.code);
}

describe('offsetFromEndDate — the sign convention', () => {
  it('is negative before expiry, zero on the day, positive after', () => {
    expect(offsetFromEndDate(T, addDays(T, 7))).toBe(-7);
    expect(offsetFromEndDate(T, T)).toBe(0);
    expect(offsetFromEndDate(T, addDays(T, -1))).toBe(1);
  });

  it('matches the SQL in database-design.md §4.2', () => {
    // `today − endDate` is what the candidate query compares to offsetDays.
    expect(offsetFromEndDate(istDate('2026-09-10'), istDate('2026-09-17'))).toBe(-7);
  });
});

describe('the BR-5.1 default schedule', () => {
  it('R1 — endDate = T+7 at 10:00 gives one PRE_7 intent', () => {
    expect(firing(7, '10:00')).toEqual(['PRE_7']);
  });

  it('R2 — endDate = T+7 at 19:00 gives nothing', () => {
    expect(firing(7, '19:00')).toEqual([]);
  });

  it('R3 — endDate = T+5 gives nothing at any slot', () => {
    for (const slot of ['10:00', '19:00']) {
      expect(firing(5, slot), slot).toEqual([]);
    }
  });

  it('R4 — T+3, T+2 and T+1 each give one intent at 10:00', () => {
    expect(firing(3, '10:00')).toEqual(['PRE_3']);
    expect(firing(2, '10:00')).toEqual(['PRE_2']);
    expect(firing(1, '10:00')).toEqual(['PRE_1']);
  });

  it('R5 — endDate = T at 10:00 gives DUE_TODAY', () => {
    expect(firing(0, '10:00')).toEqual(['DUE_TODAY']);
  });

  it('R6 — endDate = T−1 fires POST once, in the evening (ADR-068)', () => {
    expect(firing(-1, '19:00')).toEqual(['POST']);
    // ...and not at 10:00, which belongs to the pre-expiry rules, nor at the two
    // slots POST used to share: three a day is 21 messages to one lapsed member.
    expect(firing(-1, '10:00')).toEqual([]);
    expect(firing(-1, '09:30')).toEqual([]);
    expect(firing(-1, '14:00')).toEqual([]);
  });

  it('R7 — endDate = T−8 with a cap of 7 gives nothing', () => {
    expect(firing(-8, '19:00')).toEqual([]);
    expect(isBeyondPostExpiryCap(T, addDays(T, -8), 7)).toBe(true);
  });

  it('fires POST once on every day up to and including the cap', () => {
    for (let day = 1; day <= 7; day += 1) {
      expect(firing(-day, '19:00'), `day +${day}`).toEqual(['POST']);
    }
    expect(firing(-8, '19:00')).toEqual([]);
  });

  it('R8 — an uncapped POST rule still fires 40 days later', () => {
    const uncapped = buildDefaultReminderRules(null);
    expect(firing(-40, '19:00', uncapped)).toEqual(['POST']);
    expect(isBeyondPostExpiryCap(T, addDays(T, -40), null)).toBe(false);
  });

  it('R20 — a 31 Jan monthly membership ends 27 Feb, so PRE_7 lands on 20 Feb', () => {
    // BR-3.1: 31 Jan 2027 + 1M − 1 day = 27 Feb 2027.
    const endDate = istDate('2027-02-27');
    const twentieth = istDate('2027-02-20');
    expect(matchingRules(RULES, twentieth, endDate, '10:00').map((r) => r.code)).toEqual(['PRE_7']);
  });

  it('R21 — a leap-year 12-month membership ends 27 Feb 2029', () => {
    const endDate = istDate('2029-02-27');
    expect(matchingRules(RULES, istDate('2029-02-27'), endDate, '10:00').map((r) => r.code)).toEqual([
      'DUE_TODAY',
    ]);
  });

  it('skips a disabled rule', () => {
    const noDueToday = RULES.map((r) => (r.code === 'DUE_TODAY' ? { ...r, isEnabled: false } : r));
    expect(firing(0, '10:00', noDueToday)).toEqual([]);
  });
});

describe('ruleCoversOffset', () => {
  it('matches a single-day rule exactly', () => {
    const rule = buildReminderRule({ offsetDays: -7, offsetDaysTo: -7 });
    expect(ruleCoversOffset(rule, -7)).toBe(true);
    expect(ruleCoversOffset(rule, -6)).toBe(false);
    expect(ruleCoversOffset(rule, -8)).toBe(false);
  });

  it('matches a range inclusively at both ends', () => {
    const rule = buildReminderRule({ code: 'POST', offsetDays: 1, offsetDaysTo: 7 });
    expect(ruleCoversOffset(rule, 1)).toBe(true);
    expect(ruleCoversOffset(rule, 7)).toBe(true);
    expect(ruleCoversOffset(rule, 0)).toBe(false);
    expect(ruleCoversOffset(rule, 8)).toBe(false);
  });

  it('treats a null upper bound as unbounded', () => {
    const rule = buildReminderRule({ code: 'POST', offsetDays: 1, offsetDaysTo: null });
    expect(ruleCoversOffset(rule, 10_000)).toBe(true);
    expect(ruleCoversOffset(rule, 0)).toBe(false);
  });
});

describe('candidateEndDates — what the slot query looks for', () => {
  it('splits single-day rules from the POST range', () => {
    expect(candidateEndDates(RULES, T, '10:00')).toEqual({
      exactOffsets: [-7, -3, -2, -1, 0],
      ranges: [],
    });
    expect(candidateEndDates(RULES, T, '19:00')).toEqual({
      exactOffsets: [],
      ranges: [{ from: 1, to: 7 }],
    });
  });

  it('returns nothing for a slot no rule uses', () => {
    expect(candidateEndDates(RULES, T, '11:11')).toEqual({ exactOffsets: [], ranges: [] });
  });

  it('ignores disabled rules', () => {
    const disabled = RULES.map((r) => ({ ...r, isEnabled: false }));
    expect(candidateEndDates(disabled, T, '10:00').exactOffsets).toEqual([]);
  });
});

describe('distinctSlots — the cron times the worker registers', () => {
  it('lists each slot once, sorted', () => {
    expect(distinctSlots(RULES)).toEqual(['10:00', '19:00']);
  });
});

describe('reminderIdempotencyKey — BR-5.4', () => {
  const key = reminderIdempotencyKey({
    memberId: 'mem_1',
    membershipId: 'mship_1',
    ruleCode: 'PRE_7',
    date: T,
    slot: '10:00',
  });

  it('matches the documented format', () => {
    expect(key).toBe('rem:mem_1:mship_1:PRE_7:2026-09-10:10:00');
  });

  it('differs per slot, so the three POST sends are not collapsed into one', () => {
    const at0930 = reminderIdempotencyKey({
      memberId: 'mem_1',
      membershipId: 'mship_1',
      ruleCode: 'POST',
      date: T,
      slot: '09:30',
    });
    const at1400 = reminderIdempotencyKey({
      memberId: 'mem_1',
      membershipId: 'mship_1',
      ruleCode: 'POST',
      date: T,
      slot: '14:00',
    });
    expect(at0930).not.toBe(at1400);
  });

  it('R19 — differs per member, so two people sharing a number each get their own', () => {
    const a = reminderIdempotencyKey({
      memberId: 'mem_1',
      membershipId: 'm1',
      ruleCode: 'PRE_7',
      date: T,
      slot: '10:00',
    });
    const b = reminderIdempotencyKey({
      memberId: 'mem_2',
      membershipId: 'm2',
      ruleCode: 'PRE_7',
      date: T,
      slot: '10:00',
    });
    expect(a).not.toBe(b);
  });

  it('differs per membership, so a renewal does not inherit send history', () => {
    const old = reminderIdempotencyKey({
      memberId: 'm',
      membershipId: 'old',
      ruleCode: 'PRE_7',
      date: T,
      slot: '10:00',
    });
    const renewed = reminderIdempotencyKey({
      memberId: 'm',
      membershipId: 'new',
      ruleCode: 'PRE_7',
      date: T,
      slot: '10:00',
    });
    expect(old).not.toBe(renewed);
  });

  it('R15 — is stable, so a duplicate cron fire produces the same key', () => {
    const again = reminderIdempotencyKey({
      memberId: 'mem_1',
      membershipId: 'mship_1',
      ruleCode: 'PRE_7',
      date: T,
      slot: '10:00',
    });
    expect(again).toBe(key);
  });
});

// ── Eligibility (BR-5.3) ─────────────────────────────────────────────────────

function eligibilityInput(overrides: Partial<EligibilityInput> = {}): EligibilityInput {
  return {
    memberStatus: 'ACTIVE',
    whatsappOptIn: true,
    remindersUnsubscribedAt: null,
    remindersPausedUntil: null,
    hasMobile: true,
    targetMembershipId: 'mship_1',
    latestConfirmedMembershipId: 'mship_1',
    today: T,
    nowTime: istTime('10:00'),
    quietHours: DEFAULT_QUIET_HOURS,
    alreadySent: false,
    ...overrides,
  };
}

describe('checkReminderEligibility — BR-5.3', () => {
  it('passes for an opted-in active member inside quiet hours', () => {
    expect(checkReminderEligibility(eligibilityInput())).toEqual({ eligible: true });
  });

  it('R14 — refuses any status other than ACTIVE', () => {
    for (const status of ['PENDING_VERIFICATION', 'PENDING_PAYMENT', 'LEFT', 'BLOCKED'] as const) {
      expect(checkReminderEligibility(eligibilityInput({ memberStatus: status })), status).toEqual({
        eligible: false,
        reason: 'MEMBER_NOT_ACTIVE',
      });
    }
  });

  it('R13 — refuses a member who never opted in (ADR-009 imports)', () => {
    expect(checkReminderEligibility(eligibilityInput({ whatsappOptIn: false }))).toEqual({
      eligible: false,
      reason: 'NOT_OPTED_IN',
    });
  });

  it('R11 — refuses once unsubscribed', () => {
    expect(
      checkReminderEligibility(eligibilityInput({ remindersUnsubscribedAt: new Date('2026-09-10T04:35:00Z') })),
    ).toEqual({ eligible: false, reason: 'UNSUBSCRIBED' });
  });

  it('R12 — refuses while paused, and resumes the day after', () => {
    expect(checkReminderEligibility(eligibilityInput({ remindersPausedUntil: addDays(T, 3) }))).toEqual({
      eligible: false,
      reason: 'REMINDERS_PAUSED',
    });
    // Paused "until today" still blocks today.
    expect(checkReminderEligibility(eligibilityInput({ remindersPausedUntil: T })).eligible).toBe(false);
    // Yesterday's pause has lapsed.
    expect(checkReminderEligibility(eligibilityInput({ remindersPausedUntil: addDays(T, -1) }))).toEqual({
      eligible: true,
    });
  });

  it('R9/R10 — refuses when a newer membership exists: the member already renewed', () => {
    expect(
      checkReminderEligibility(
        eligibilityInput({ targetMembershipId: 'old', latestConfirmedMembershipId: 'new' }),
      ),
    ).toEqual({ eligible: false, reason: 'SUPERSEDED_BY_NEWER_MEMBERSHIP' });
  });

  it('refuses outside quiet hours, as a backstop for a misconfigured slot (R18)', () => {
    expect(checkReminderEligibility(eligibilityInput({ nowTime: istTime('22:00') }))).toEqual({
      eligible: false,
      reason: 'OUTSIDE_QUIET_HOURS',
    });
    expect(checkReminderEligibility(eligibilityInput({ nowTime: istTime('07:59') })).eligible).toBe(false);
    // The boundaries themselves are inside the window.
    expect(checkReminderEligibility(eligibilityInput({ nowTime: istTime('08:00') })).eligible).toBe(true);
    expect(checkReminderEligibility(eligibilityInput({ nowTime: istTime('21:00') })).eligible).toBe(true);
  });

  it('R15 — refuses when the idempotency key already exists', () => {
    expect(checkReminderEligibility(eligibilityInput({ alreadySent: true }))).toEqual({
      eligible: false,
      reason: 'ALREADY_SENT',
    });
  });

  it('refuses a member with no mobile number', () => {
    expect(checkReminderEligibility(eligibilityInput({ hasMobile: false }))).toEqual({
      eligible: false,
      reason: 'NO_MOBILE',
    });
  });

  it('R19 — respects the per-number daily cap on a shared family number', () => {
    const capped = eligibilityInput({ messagesToNumberToday: 4, maxMessagesPerNumberPerDay: 4 });
    expect(checkReminderEligibility(capped)).toEqual({
      eligible: false,
      reason: 'NUMBER_DAILY_CAP_REACHED',
    });
    expect(
      checkReminderEligibility({ ...capped, messagesToNumberToday: 3 }).eligible,
    ).toBe(true);
  });

  it('refuses every automatic reminder while the owner has stopped automatic messages (kill switch)', () => {
    expect(checkReminderEligibility(eligibilityInput({ automaticMessagesStopped: true }))).toEqual({
      eligible: false,
      reason: 'AUTOMATIC_MESSAGES_STOPPED',
    });
    // It outranks everything else: the log should say the owner stopped it.
    expect(
      checkReminderEligibility(eligibilityInput({ automaticMessagesStopped: true, memberStatus: 'LEFT', alreadySent: true })),
    ).toEqual({ eligible: false, reason: 'AUTOMATIC_MESSAGES_STOPPED' });
    expect(checkReminderEligibility(eligibilityInput({ automaticMessagesStopped: false }))).toEqual({ eligible: true });
  });

  it('reports the most informative reason when several apply', () => {
    // LEFT and unsubscribed: LEFT is the more useful log line.
    expect(
      checkReminderEligibility(
        eligibilityInput({ memberStatus: 'LEFT', remindersUnsubscribedAt: new Date() }),
      ),
    ).toEqual({ eligible: false, reason: 'MEMBER_NOT_ACTIVE' });
  });
});

describe('isWithinQuietHours', () => {
  it('includes both boundaries and excludes outside', () => {
    expect(isWithinQuietHours(istTime('08:00'), DEFAULT_QUIET_HOURS)).toBe(true);
    expect(isWithinQuietHours(istTime('21:00'), DEFAULT_QUIET_HOURS)).toBe(true);
    expect(isWithinQuietHours(istTime('07:59'), DEFAULT_QUIET_HOURS)).toBe(false);
    expect(isWithinQuietHours(istTime('21:01'), DEFAULT_QUIET_HOURS)).toBe(false);
    expect(isWithinQuietHours(istTime('00:00'), DEFAULT_QUIET_HOURS)).toBe(false);
  });
});
