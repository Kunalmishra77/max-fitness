import { describe, expect, it } from 'vitest';
import { istDate } from '@mfp/shared';
import {
  FOLLOW_UP_QUESTIONS,
  answerFollowUpQuestion,
  followUpDue,
  needsNewPlan,
  nextFollowUpQuestion,
  type FollowUpAnswers,
} from './follow-up';

/**
 * The monthly check on a diet plan (ADR-089).
 *
 * Four questions, not seven: this is a nudge on a Tuesday evening, not an exam, and a member
 * who is asked seven things answers none. What matters is whether anything changed enough to
 * be worth rewriting the plan — and that a member who says "change it" is actually heard,
 * rather than logged.
 */

const answers = (over: Partial<FollowUpAnswers> = {}): FollowUpAnswers => ({
  following: 'MOSTLY',
  weightGrams: 73_000,
  energy: 'BETTER',
  wantsChange: false,
  ...over,
});

describe('nextFollowUpQuestion', () => {
  it('asks the four in order and then stops', () => {
    const asked: string[] = [];
    let so_far: Partial<FollowUpAnswers> = {};
    for (let i = 0; i < FOLLOW_UP_QUESTIONS.length + 1; i += 1) {
      const question = nextFollowUpQuestion(so_far);
      if (question === null) break;
      asked.push(question.key);
      so_far = { ...so_far, ...answerOf(question.key) };
    }
    expect(asked).toEqual(['following', 'weight', 'energy', 'wantsChange']);
    expect(nextFollowUpQuestion(answers())).toBeNull();
  });

  it('asks what they want changed only when they said they want a change', () => {
    expect(nextFollowUpQuestion(answers({ wantsChange: true }))?.key).toBe('changeWhat');
    expect(nextFollowUpQuestion(answers({ wantsChange: true, changeWhat: 'too much rice' }))).toBeNull();
  });
});

function answerOf(key: string): Partial<FollowUpAnswers> {
  const all = answers();
  if (key === 'following') return { following: all.following };
  if (key === 'weight') return { weightGrams: all.weightGrams };
  if (key === 'energy') return { energy: all.energy };
  if (key === 'wantsChange') return { wantsChange: false };
  return {};
}

describe('answerFollowUpQuestion', () => {
  it('reads how well they are following it, by number or words', () => {
    expect(answerFollowUpQuestion('following', '1')).toEqual({ ok: true, patch: { following: 'MOSTLY' } });
    expect(answerFollowUpQuestion('following', 'sometimes')).toEqual({ ok: true, patch: { following: 'SOMETIMES' } });
    expect(answerFollowUpQuestion('following', 'nahi kar paya')).toEqual({ ok: true, patch: { following: 'NOT_REALLY' } });
    expect(answerFollowUpQuestion('following', 'hmm').ok).toBe(false);
  });

  it('takes a weight, or "same" for no change', () => {
    expect(answerFollowUpQuestion('weight', '73')).toEqual({ ok: true, patch: { weightGrams: 73_000 } });
    expect(answerFollowUpQuestion('weight', 'same')).toEqual({ ok: true, patch: { weightGrams: null } });
    expect(answerFollowUPSame()).toEqual({ ok: true, patch: { weightGrams: null } });
    expect(answerFollowUpQuestion('weight', '700').ok).toBe(false);
  });

  it('reads yes and no the way people write them', () => {
    expect(answerFollowUpQuestion('wantsChange', 'yes')).toEqual({ ok: true, patch: { wantsChange: true } });
    expect(answerFollowUpQuestion('wantsChange', 'haan')).toEqual({ ok: true, patch: { wantsChange: true } });
    expect(answerFollowUpQuestion('wantsChange', 'no')).toEqual({ ok: true, patch: { wantsChange: false } });
    expect(answerFollowUpQuestion('wantsChange', 'nahi')).toEqual({ ok: true, patch: { wantsChange: false } });
    expect(answerFollowUpQuestion('wantsChange', 'maybe').ok).toBe(false);
  });

  it('keeps what they want changed, within reason', () => {
    expect(answerFollowUpQuestion('changeWhat', 'too much rice')).toEqual({ ok: true, patch: { changeWhat: 'too much rice' } });
    expect(answerFollowUpQuestion('changeWhat', 'x'.repeat(401)).ok).toBe(false);
  });
});

function answerFollowUPSame() {
  return answerFollowUpQuestion('weight', 'wahi hai');
}

describe('followUpDue', () => {
  const plan = { generatedAt: istDate('2026-09-02'), lastFollowUpOn: null };

  it('comes due a month after the plan, not before', () => {
    expect(followUpDue({ ...plan, today: istDate('2026-10-02'), everyDays: 30 })).toBe(true);
    expect(followUpDue({ ...plan, today: istDate('2026-09-20'), everyDays: 30 })).toBe(false);
  });

  it('counts from the last follow-up once there has been one', () => {
    const asked = { generatedAt: istDate('2026-09-02'), lastFollowUpOn: istDate('2026-10-02') };
    expect(followUpDue({ ...asked, today: istDate('2026-10-20'), everyDays: 30 })).toBe(false);
    expect(followUpDue({ ...asked, today: istDate('2026-11-01'), everyDays: 30 })).toBe(true);
  });

  it('never comes due when the owner has switched follow-ups off', () => {
    expect(followUpDue({ ...plan, today: istDate('2027-01-01'), everyDays: 0 })).toBe(false);
  });
});

describe('needsNewPlan', () => {
  it('rewrites the plan when the member asks for a change', () => {
    expect(needsNewPlan(answers({ wantsChange: true, changeWhat: 'too much rice' }), 72_000)).toBe(true);
  });

  it('rewrites it when the weight has moved enough to matter', () => {
    // Three kilos either way is a different plan; half a kilo is a different morning.
    expect(needsNewPlan(answers({ weightGrams: 76_000 }), 72_000)).toBe(true);
    expect(needsNewPlan(answers({ weightGrams: 68_000 }), 72_000)).toBe(true);
    expect(needsNewPlan(answers({ weightGrams: 72_500 }), 72_000)).toBe(false);
  });

  it('leaves a plan alone for somebody who is following it and feels fine', () => {
    expect(needsNewPlan(answers(), 73_000)).toBe(false);
  });

  it('rewrites it for somebody who cannot follow it at all', () => {
    // "Not really" month after month means the plan does not fit their life.
    expect(needsNewPlan(answers({ following: 'NOT_REALLY' }), 73_000)).toBe(true);
  });

  it('says nothing is needed when the member never answered', () => {
    expect(needsNewPlan({}, 72_000)).toBe(false);
  });
});
