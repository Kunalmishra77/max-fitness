import { describe, expect, it } from 'vitest';
import { istDate, type E164Mobile } from '@mfp/shared';
import { planSlot, relativeDayPhrase, type ReminderCandidate } from './engine';
import type { ReminderRule } from './rules';

/**
 * What a slot would send, right now (whatsapp-automation-engine §5; BR-5).
 *
 * The database narrows the candidates; this decides which rule wins when two could
 * match, what each message says, which buttons it carries, and who is dropped because
 * one phone number has already had its day's share (BR-5.6). Nothing here sends: the
 * send job checks eligibility again immediately before it does (BR-5.3).
 */

const rule = (over: Partial<ReminderRule> & Pick<ReminderRule, 'code' | 'offsetDays'>): ReminderRule => ({
  offsetDaysTo: over.offsetDays,
  slots: ['10:00'],
  templateName: 'mf_renewal_due',
  isEnabled: true,
  ...over,
});

const RULES: ReminderRule[] = [
  rule({ code: 'PRE_7', offsetDays: -7 }),
  rule({ code: 'PRE_1', offsetDays: -1 }),
  rule({ code: 'DUE_TODAY', offsetDays: 0, templateName: 'mf_renewal_due_today' }),
  rule({ code: 'POST', offsetDays: 1, offsetDaysTo: 7, slots: ['10:00'], templateName: 'mf_membership_expired' }),
];

const candidate = (over: Partial<ReminderCandidate> = {}): ReminderCandidate => ({
  memberId: 'mem_1',
  membershipId: 'mship_1',
  firstName: 'Anita',
  mobile: '+919000000001' as E164Mobile,
  language: 'en',
  endDate: istDate('2026-09-30'),
  ...over,
});

const deps = {
  tokens: { renewUrl: (memberId: string) => `https://max.test/r/${memberId}`, unsubscribePayload: (memberId: string) => `UNSUB.${memberId}` },
};

const plan = (input: { today?: string; slot?: string; candidates: ReminderCandidate[]; maxPerNumber?: number; rules?: ReminderRule[] }) =>
  planSlot(
    {
      today: istDate(input.today ?? '2026-09-23'),
      slot: input.slot ?? '10:00',
      rules: input.rules ?? RULES,
      candidates: input.candidates,
      maxMessagesPerNumberPerDay: input.maxPerNumber ?? 4,
    },
    deps,
  );

describe('planSlot', () => {
  it('builds one message per member, with the day, the phrase and both buttons', () => {
    const { intents, skipped } = plan({ candidates: [candidate()] });

    expect(skipped).toEqual([]);
    expect(intents).toEqual([
      {
        idempotencyKey: 'rem:mem_1:mship_1:PRE_7:2026-09-23:10:00',
        memberId: 'mem_1',
        membershipId: 'mship_1',
        ruleCode: 'PRE_7',
        // The run this message belongs to, carried rather than parsed back out of
        // the key: the failure guard has to know which slot is going wrong.
        businessDate: '2026-09-23',
        slot: '10:00',
        templateName: 'mf_renewal_due',
        language: 'en',
        to: '+919000000001',
        variables: { firstName: 'Anita', endDate: '30 Sep 2026', whenPhrase: 'in 7 days' },
        buttons: { renewUrl: 'https://max.test/r/mem_1', unsubscribePayload: 'UNSUB.mem_1' },
      },
    ]);
  });

  it('writes the date and the phrase in the member’s own language', () => {
    const { intents } = plan({ candidates: [candidate({ language: 'hi' })] });
    expect(intents[0]?.variables).toEqual({ firstName: 'Anita', endDate: '30 सित॰ 2026', whenPhrase: '7 दिन बाद' });
  });

  it('picks the rule for the day when two could match, never two messages', () => {
    // A day after expiry: POST covers +1..+7 and nothing else does.
    const after = plan({ today: '2026-10-01', candidates: [candidate()] });
    expect(after.intents.map((i) => i.ruleCode)).toEqual(['POST']);
    expect(after.intents[0]?.templateName).toBe('mf_membership_expired');

    // The last day: DUE_TODAY, not PRE_1.
    const onTheDay = plan({ today: '2026-09-30', candidates: [candidate()] });
    expect(onTheDay.intents.map((i) => i.ruleCode)).toEqual(['DUE_TODAY']);
  });

  it('sends one message when a stored rule overlaps another, choosing the one whose own day is nearest', () => {
    // A wide rule left over from an edit: it covers the whole week around the end date.
    const wide = rule({ code: 'PRE_3', offsetDays: -7, offsetDaysTo: 7, templateName: 'mf_renewal_due' });
    // Listed first, so the answer cannot come from the order the rules happen to be in.
    const { intents } = plan({ today: '2026-10-01', candidates: [candidate()], rules: [wide, ...RULES] });

    expect(intents).toHaveLength(1);
    expect(intents[0]?.ruleCode).toBe('POST');
  });

  it('sends nothing when no rule covers the day, or the rule is off for this slot', () => {
    expect(plan({ today: '2026-09-20', candidates: [candidate()] }).intents).toEqual([]);
    expect(plan({ slot: '19:00', candidates: [candidate()] }).intents).toEqual([]);
    expect(plan({ candidates: [candidate()], rules: RULES.map((r) => ({ ...r, isEnabled: false })) }).intents).toEqual([]);
  });

  it('keeps one family number under its daily share, and says why the rest were dropped', () => {
    const family = ['mem_1', 'mem_2', 'mem_3'].map((memberId, i) =>
      candidate({ memberId, membershipId: `mship_${i + 1}`, firstName: `Member${i + 1}` }),
    );
    const { intents, skipped } = plan({ candidates: family, maxPerNumber: 2 });

    expect(intents.map((i) => i.memberId)).toEqual(['mem_1', 'mem_2']);
    expect(skipped).toEqual([
      { memberId: 'mem_3', membershipId: 'mship_3', ruleCode: 'PRE_7', idempotencyKey: 'rem:mem_3:mship_3:PRE_7:2026-09-23:10:00', reason: 'NUMBER_CAP' },
    ]);
  });

  it('counts the cap per number, not across the gym', () => {
    const two = [candidate(), candidate({ memberId: 'mem_9', membershipId: 'mship_9', mobile: '+919000000009' as E164Mobile })];
    expect(plan({ candidates: two, maxPerNumber: 1 }).intents).toHaveLength(2);
  });
});

describe('relativeDayPhrase', () => {
  it('reads as a person would say it, in both languages', () => {
    expect(relativeDayPhrase(-7, 'en')).toBe('in 7 days');
    expect(relativeDayPhrase(-1, 'en')).toBe('tomorrow');
    expect(relativeDayPhrase(0, 'en')).toBe('today');
    expect(relativeDayPhrase(1, 'en')).toBe('yesterday');
    expect(relativeDayPhrase(3, 'en')).toBe('3 days ago');
    expect(relativeDayPhrase(-7, 'hi')).toBe('7 दिन बाद');
    expect(relativeDayPhrase(-1, 'hi')).toBe('कल');
    expect(relativeDayPhrase(0, 'hi')).toBe('आज');
    expect(relativeDayPhrase(3, 'hi')).toBe('3 दिन पहले');
  });
});
