import { describe, expect, it } from 'vitest';
import { istDate } from '@mfp/shared';
import { alertSentence, buildBirthdayWish, buildOwnerDigest, planOwnerAlerts, type PendingOwnerAlert } from './owner';

const at = (minutes: number) => new Date(Date.UTC(2026, 8, 23, 4, 0) + minutes * 60_000);

describe('buildOwnerDigest', () => {
  const counts = {
    endingToday: 3,
    overdue: 11,
    dueThisWeek: 8,
    callsToday: 6,
    birthdays: 2,
    collectedYesterdayPaise: 1_450_00,
  };

  it('carries the seven numbers the owner reads over chai', () => {
    const message = buildOwnerDigest({ ownerId: 'staff_1', firstName: 'अजय', language: 'hi', today: istDate('2026-09-23'), counts });

    expect(message.templateName).toBe('mf_owner_daily_digest');
    expect(message.purpose).toBe('OWNER_DIGEST');
    expect(message.language).toBe('hi');
    expect(message.variables).toEqual({
      ownerName: 'अजय',
      endingToday: '3',
      overdue: '11',
      dueThisWeek: '8',
      callsToday: '6',
      birthdays: '2',
      collectedYesterday: '₹1,450',
    });
  });

  it('is one message a day, whatever retries the worker makes', () => {
    const a = buildOwnerDigest({ ownerId: 'staff_1', firstName: 'Ajay', language: 'en', today: istDate('2026-09-23'), counts });
    const b = buildOwnerDigest({ ownerId: 'staff_1', firstName: 'Ajay', language: 'en', today: istDate('2026-09-23'), counts: { ...counts, overdue: 12 } });
    const tomorrow = buildOwnerDigest({ ownerId: 'staff_1', firstName: 'Ajay', language: 'en', today: istDate('2026-09-24'), counts });

    expect(a.idempotencyKey).toBe(b.idempotencyKey);
    expect(a.idempotencyKey).not.toBe(tomorrow.idempotencyKey);
  });
});

describe('alertSentence', () => {
  it('says who walked in and how long their fee has been overdue', () => {
    const hi = alertSentence({ kind: 'EXPIRED_MEMBER_VISIT', memberName: 'संजय तोमर', daysOverdue: 6 }, 'hi');
    expect(hi).toBe('संजय तोमर अभी जिम आए, फीस 6 दिन से बाकी है।');

    const en = alertSentence({ kind: 'EXPIRED_MEMBER_VISIT', memberName: 'Sanjay Tomar', daysOverdue: 6 }, 'en');
    expect(en).toBe('Sanjay Tomar just came in; their fee is 6 days overdue.');
  });

  it('never puts a full mobile number in an enquiry alert', () => {
    const sentence = alertSentence({ kind: 'NEW_LEAD', name: 'नेहा', goal: 'वजन घटाना', mobile: '+919876543210' }, 'hi');

    expect(sentence).not.toContain('9876543210');
    expect(sentence).toContain('98xxxxx210');
    expect(sentence).toContain('नेहा');
    expect(sentence).toContain('वजन घटाना');
  });

  it('drops the goal cleanly when the enquiry did not give one', () => {
    const sentence = alertSentence({ kind: 'NEW_LEAD', name: 'Neha', goal: null, mobile: '+919876543210' }, 'en');

    expect(sentence).toBe('New enquiry: Neha, +91 98xxxxx210.');
  });

  it('reports money in rupees, not paise', () => {
    expect(alertSentence({ kind: 'ONLINE_PAYMENT', memberName: 'Rohit Sharma', amountPaise: 400_000 }, 'en')).toBe('Rohit Sharma paid ₹4,000 online.');
  });

  it('stays on one line, because a template variable cannot hold a newline', () => {
    const alerts: ReadonlyArray<Parameters<typeof alertSentence>[0]> = [
      { kind: 'EXPIRED_MEMBER_VISIT', memberName: 'A', daysOverdue: 1 },
      { kind: 'ONLINE_PAYMENT', memberName: 'B', amountPaise: 100 },
      { kind: 'NEW_LEAD', name: 'C', goal: 'x', mobile: '+919876543210' },
      { kind: 'MEMBER_UNSUBSCRIBED', memberName: 'D' },
      { kind: 'VERIFICATION_PENDING', memberName: 'E', referenceCode: 'Q-4821' },
      { kind: 'PAYMENT_AMOUNT_MISMATCH', memberName: 'F', expectedPaise: 100, receivedPaise: 50 },
      { kind: 'WHATSAPP_QUALITY' },
      { kind: 'WHATSAPP_FAILURE', slot: '19:00', failed: 9, planned: 20 },
      { kind: 'KIOSK_OFFLINE', deviceName: 'Reception', minutesOffline: 45 },
    ];

    for (const alert of alerts) {
      for (const language of ['hi', 'en'] as const) {
        const sentence = alertSentence(alert, language);
        expect(sentence).not.toMatch(/[\n\t]/);
        expect(sentence.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('planOwnerAlerts', () => {
  const pending = (id: string, minutes: number): PendingOwnerAlert => ({
    id,
    at: at(minutes),
    alert: { kind: 'ONLINE_PAYMENT', memberName: id, amountPaise: 100_000 },
  });

  it('sends a quiet morning through one at a time', () => {
    const plan = planOwnerAlerts({ pending: [pending('a', 0), pending('b', 1), pending('c', 2)], language: 'en' });

    expect(plan).toHaveLength(3);
    expect(plan[0]?.alertIds).toEqual(['a']);
    expect(plan[0]?.message.purpose).toBe('OWNER_ALERT');
    expect(plan[0]?.message.variables['sentence']).toBe('a paid ₹1,000 online.');
  });

  it('bundles a burst of more than three into one message', () => {
    const plan = planOwnerAlerts({ pending: [pending('a', 0), pending('b', 1), pending('c', 2), pending('d', 3), pending('e', 4)], language: 'en' });

    expect(plan).toHaveLength(1);
    expect(plan[0]?.alertIds).toEqual(['a', 'b', 'c', 'd', 'e']);

    const text = plan[0]?.message.variables['sentence'] ?? '';
    expect(text).toContain('5 things need you');
    expect(text).toContain('a paid');
    expect(text).toContain('c paid');
    expect(text).not.toContain('d paid');
    expect(text).toContain('2 more');
  });

  it('does not bundle across the five-minute window', () => {
    // Two bursts of four, six minutes apart. One window would make it one message.
    const burst = [pending('a', 0), pending('b', 1), pending('c', 2), pending('d', 3)];
    const later = [pending('e', 6), pending('f', 7), pending('g', 8), pending('h', 9)];
    const plan = planOwnerAlerts({ pending: [...burst, ...later], language: 'en' });

    expect(plan.map((p) => p.alertIds)).toEqual([
      ['a', 'b', 'c', 'd'],
      ['e', 'f', 'g', 'h'],
    ]);
  });

  it('measures the window from the first alert of the cluster, not the one before', () => {
    // A trickle three minutes apart: each is near the last, but chaining the window
    // along would swallow the lot into one bundle and hold the first alert back.
    const trickle = [0, 3, 6, 9, 12, 15].map((minutes, index) => pending(String.fromCharCode(97 + index), minutes));
    const plan = planOwnerAlerts({ pending: trickle, language: 'en' });

    expect(plan.map((p) => p.alertIds)).toEqual([['a'], ['b'], ['c'], ['d'], ['e'], ['f']]);
  });

  it('reads the alerts in time order however the database handed them over', () => {
    const plan = planOwnerAlerts({ pending: [pending('c', 2), pending('a', 0), pending('b', 1)], language: 'en' });

    expect(plan.map((p) => p.alertIds)).toEqual([['a'], ['b'], ['c']]);
  });

  it('gives each message a key that survives a repeated dispatch', () => {
    const burst = [pending('a', 0), pending('b', 1), pending('c', 2), pending('d', 3)];

    expect(planOwnerAlerts({ pending: burst, language: 'en' })[0]?.message.idempotencyKey).toBe(planOwnerAlerts({ pending: [...burst].reverse(), language: 'en' })[0]?.message.idempotencyKey);
    expect(planOwnerAlerts({ pending: [pending('a', 0)], language: 'en' })[0]?.message.idempotencyKey).toBe('alert:a');
  });

  it('counts what already went out in the window against the same budget', () => {
    // Two alerts on their own would go one by one; after two have already buzzed the
    // owner's phone in the last five minutes, the next two arrive as one message.
    const pair = [pending('a', 0), pending('b', 1)];

    expect(planOwnerAlerts({ pending: pair, language: 'en' }).map((p) => p.alertIds)).toEqual([['a'], ['b']]);
    expect(planOwnerAlerts({ pending: pair, language: 'en', alreadySentInWindow: 2 }).map((p) => p.alertIds)).toEqual([['a', 'b']]);
  });

  it('has nothing to say when nothing happened', () => {
    expect(planOwnerAlerts({ pending: [], language: 'hi' })).toEqual([]);
  });
});

describe('buildBirthdayWish', () => {
  it('wishes the member by name, in their language', () => {
    const message = buildBirthdayWish({ memberId: 'm1', firstName: 'Anita', language: 'en', today: istDate('2026-09-23') });

    expect(message.templateName).toBe('mf_birthday_wish');
    expect(message.purpose).toBe('BIRTHDAY');
    expect(message.variables).toEqual({ firstName: 'Anita' });
  });

  it('is one wish a year, so next birthday is a new message', () => {
    const now = buildBirthdayWish({ memberId: 'm1', firstName: 'Anita', language: 'en', today: istDate('2026-09-23') });
    const again = buildBirthdayWish({ memberId: 'm1', firstName: 'Anita', language: 'en', today: istDate('2026-09-23') });
    const nextYear = buildBirthdayWish({ memberId: 'm1', firstName: 'Anita', language: 'en', today: istDate('2027-09-23') });

    expect(now.idempotencyKey).toBe(again.idempotencyKey);
    expect(now.idempotencyKey).not.toBe(nextYear.idempotencyKey);
  });
});
