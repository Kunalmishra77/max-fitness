import { describe, expect, it } from 'vitest';
import { istDate, type E164Mobile, type ISTDate } from '@mfp/shared';
import type { ReminderRule } from './rules';
import { projectReminders, type ProjectionMember } from './projection';

/**
 * The 30-day forecast behind the Message Simulator (whatsapp-automation-engine §10).
 *
 * It answers "what will this gym send, if nothing changes" — so the interesting cases
 * are the ones where nothing changing is exactly the point: a member who is paused
 * today wakes up mid-forecast, and one who has left never appears at all.
 */

const SLOTS = ['10:00', '19:00'];
const TODAY = istDate('2026-09-23');

const rules: ReminderRule[] = [
  { code: 'PRE_7', offsetDays: -7, offsetDaysTo: -7, slots: ['10:00'], templateName: 'mf_renewal_due', isEnabled: true },
  { code: 'PRE_1', offsetDays: -1, offsetDaysTo: -1, slots: ['10:00'], templateName: 'mf_renewal_due', isEnabled: true },
  { code: 'DUE_TODAY', offsetDays: 0, offsetDaysTo: 0, slots: ['10:00'], templateName: 'mf_renewal_due_today', isEnabled: true },
  { code: 'POST', offsetDays: 1, offsetDaysTo: 3, slots: ['19:00'], templateName: 'mf_membership_expired', isEnabled: true },
];

const member = (over: Partial<ProjectionMember> = {}): ProjectionMember => ({
  memberId: 'mem_1',
  membershipId: 'ms_1',
  firstName: 'Anita',
  mobile: '+919876543210' as E164Mobile,
  language: 'hi',
  endDate: istDate('2026-09-30'),
  status: 'ACTIVE',
  whatsappOptIn: true,
  remindersUnsubscribedAt: null,
  remindersPausedUntil: null,
  latestConfirmedMembershipId: 'ms_1',
  ...over,
});

const deps = { tokens: { renewUrl: (id: string) => `https://x/r/${id}`, unsubscribePayload: (id: string) => `UNSUB.${id}` } };

const project = (members: readonly ProjectionMember[], over: { days?: number; cap?: number; from?: ISTDate } = {}) =>
  projectReminders(
    {
      from: over.from ?? TODAY,
      days: over.days ?? 30,
      slots: SLOTS,
      rules,
      members,
      maxMessagesPerNumberPerDay: over.cap ?? 4,
    },
    deps,
  );

/** Every day that has at least one message, as `date slot rule` lines. */
const lines = (days: ReturnType<typeof project>) =>
  days.flatMap((day) => day.messages.map((message) => `${day.date} ${message.slot} ${message.intent.ruleCode}`));

describe('projectReminders', () => {
  it('walks one member through the whole sequence', () => {
    expect(lines(project([member()]))).toEqual([
      '2026-09-23 10:00 PRE_7',
      '2026-09-29 10:00 PRE_1',
      '2026-09-30 10:00 DUE_TODAY',
      '2026-10-01 19:00 POST',
      '2026-10-02 19:00 POST',
      '2026-10-03 19:00 POST',
    ]);
  });

  it('returns a row for every day of the window, even the empty ones', () => {
    const days = project([member()], { days: 5 });

    expect(days.map((day) => day.date)).toEqual(['2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26', '2026-09-27']);
    expect(days[1]?.messages).toEqual([]);
  });

  it('writes the message the member will actually read', () => {
    const first = project([member()])[0]?.messages[0]?.intent;

    expect(first?.templateName).toBe('mf_renewal_due');
    expect(first?.language).toBe('hi');
    expect(first?.variables).toMatchObject({ firstName: 'Anita', endDate: '30 सित॰ 2026', whenPhrase: '7 दिन बाद' });
    expect(first?.buttons.unsubscribePayload).toBe('UNSUB.mem_1');
  });

  it('leaves out everyone who would never be messaged', () => {
    const nobody = [
      member({ memberId: 'a', status: 'LEFT' }),
      member({ memberId: 'b', whatsappOptIn: false }),
      member({ memberId: 'c', remindersUnsubscribedAt: new Date('2026-09-01T00:00:00Z') }),
      member({ memberId: 'd', membershipId: 'ms_old', latestConfirmedMembershipId: 'ms_new' }),
    ];

    expect(lines(project(nobody))).toEqual([]);
  });

  it('wakes a paused member up the day after their pause ends (BR-5.3)', () => {
    // Paused through 29 September, so PRE_7 on the 23rd and PRE_1 on the 29th are
    // both inside the pause; DUE_TODAY on the 30th is the first message they get.
    const paused = member({ remindersPausedUntil: istDate('2026-09-29') });

    expect(lines(project([paused]))).toEqual(['2026-09-30 10:00 DUE_TODAY', '2026-10-01 19:00 POST', '2026-10-02 19:00 POST', '2026-10-03 19:00 POST']);
  });

  it('counts the family’s cap across the whole day, not slot by slot', () => {
    // Three people on one number, all expired yesterday, with a cap of two: the POST
    // slot sends two and the third is a skip the owner can see.
    const family = ['a', 'b', 'c'].map((key) =>
      member({ memberId: `mem_${key}`, membershipId: `ms_${key}`, latestConfirmedMembershipId: `ms_${key}`, endDate: istDate('2026-09-22') }),
    );

    const day = project(family, { days: 1, cap: 2 })[0];

    expect(day?.messages.map((message) => message.intent.memberId)).toEqual(['mem_a', 'mem_b']);
    expect(day?.skipped).toBe(1);
  });

  it('spends the day’s cap on the first slot that asks for it', () => {
    // One member due today (10:00) and, on the same number, one expired yesterday
    // (19:00). A cap of one means the morning message goes and the evening one does not.
    const two = [
      member({ memberId: 'mem_a', membershipId: 'ms_a', latestConfirmedMembershipId: 'ms_a', endDate: istDate('2026-09-23') }),
      member({ memberId: 'mem_b', membershipId: 'ms_b', latestConfirmedMembershipId: 'ms_b', endDate: istDate('2026-09-22') }),
    ];

    const day = project(two, { days: 1, cap: 1 })[0];

    expect(day?.messages.map((message) => `${message.slot} ${message.intent.memberId}`)).toEqual(['10:00 mem_a']);
    expect(day?.skipped).toBe(1);
  });

  it('adds up what the month will cost in messages', () => {
    const days = project([member(), member({ memberId: 'mem_2', membershipId: 'ms_2', latestConfirmedMembershipId: 'ms_2', mobile: '+919876500000' as E164Mobile })]);

    expect(days.reduce((sum, day) => sum + day.messages.length, 0)).toBe(12);
  });
});
