import { describe, expect, it } from 'vitest';
import {
  DIET_QUESTIONS,
  answerDietQuestion,
  bmiCategory,
  bmiFor,
  dietProfileComplete,
  nextDietQuestion,
  type DietAnswers,
} from './questionnaire';

/**
 * The diet questionnaire, as a WhatsApp conversation (ADR-089).
 *
 * Everything about it that can be got wrong is in here, on purpose: what to ask next,
 * what a reply means, and when there is enough to write a plan. The member is typing on
 * a phone, one-handed, in Hinglish — "72", "72kg", "5'9", "veg", "haan" — so the parsing
 * is the feature, not an afterthought. A reply we cannot read is **asked again**, never
 * guessed at, because a guessed weight produces a diet for somebody who does not exist.
 */

const answers = (over: Partial<DietAnswers> = {}): DietAnswers => ({
  weightGrams: 72_000,
  heightCm: 170,
  ageYears: 31,
  goal: 'MUSCLE_GAIN',
  dietType: 'VEG',
  allergies: 'none',
  mealsPerDay: 4,
  activityLevel: 'DESK',
  workoutsPerWeek: 5,
  ...over,
});

describe('nextDietQuestion', () => {
  it('starts with the weight', () => {
    expect(nextDietQuestion({})?.key).toBe('weight');
  });

  it('asks each thing once, in order', () => {
    const order: string[] = [];
    let so_far: Partial<DietAnswers> = {};
    for (let i = 0; i < DIET_QUESTIONS.length + 1; i += 1) {
      const question = nextDietQuestion(so_far);
      if (question === null) break;
      order.push(question.key);
      so_far = { ...so_far, ...pretendAnswer(question.key) };
    }
    expect(order).toEqual(['weight', 'height', 'age', 'goal', 'dietType', 'allergies', 'mealsPerDay', 'activityLevel', 'workoutsPerWeek']);
  });

  it('does not ask the age of a member whose date of birth the gym already has', () => {
    // Reuse what the CRM holds rather than asking the member twice (client's list).
    expect(nextDietQuestion({ weightGrams: 72_000, heightCm: 170, ageYears: 31 })?.key).toBe('goal');
  });

  it('is finished once everything needed has an answer', () => {
    expect(nextDietQuestion(answers())).toBeNull();
    expect(dietProfileComplete(answers())).toBe(true);
    expect(dietProfileComplete({ ...answers(), weightGrams: undefined })).toBe(false);
  });
});

function pretendAnswer(key: string): Partial<DietAnswers> {
  const all = answers();
  switch (key) {
    case 'weight':
      return { weightGrams: all.weightGrams };
    case 'height':
      return { heightCm: all.heightCm };
    case 'age':
      return { ageYears: all.ageYears };
    case 'goal':
      return { goal: all.goal };
    case 'dietType':
      return { dietType: all.dietType };
    case 'allergies':
      return { allergies: all.allergies };
    case 'mealsPerDay':
      return { mealsPerDay: all.mealsPerDay };
    case 'activityLevel':
      return { activityLevel: all.activityLevel };
    case 'workoutsPerWeek':
      return { workoutsPerWeek: all.workoutsPerWeek };
    default:
      return {};
  }
}

describe('answerDietQuestion — weight', () => {
  it('reads the ways somebody actually types a weight', () => {
    for (const reply of ['72', '72 kg', '72kg', ' 72 KG ', '72.5']) {
      const result = answerDietQuestion('weight', reply);
      expect(result.ok).toBe(true);
    }
    expect(answerDietQuestion('weight', '72.5')).toEqual({ ok: true, patch: { weightGrams: 72_500 } });
  });

  it('refuses a weight that cannot be a person, and says so rather than guessing', () => {
    for (const reply of ['7', '720', 'bahut', '', '-72']) {
      expect(answerDietQuestion('weight', reply).ok).toBe(false);
    }
  });
});

describe('answerDietQuestion — height', () => {
  it('takes centimetres', () => {
    expect(answerDietQuestion('height', '170')).toEqual({ ok: true, patch: { heightCm: 170 } });
    expect(answerDietQuestion('height', '170 cm')).toEqual({ ok: true, patch: { heightCm: 170 } });
  });

  it("takes feet and inches when the member says so, because most people here know their height that way", () => {
    expect(answerDietQuestion('height', "5'9")).toEqual({ ok: true, patch: { heightCm: 175 } });
    expect(answerDietQuestion('height', '5 ft 9 in')).toEqual({ ok: true, patch: { heightCm: 175 } });
    expect(answerDietQuestion('height', "6'0")).toEqual({ ok: true, patch: { heightCm: 183 } });
  });

  it('refuses a bare number that could be either, rather than picking one', () => {
    // "5.9" is five foot nine to one person and nonsense in centimetres. Guessing it
    // wrong is a 175cm member fed as though they were 6cm tall.
    expect(answerDietQuestion('height', '5.9').ok).toBe(false);
    expect(answerDietQuestion('height', '59').ok).toBe(false);
    expect(answerDietQuestion('height', '300').ok).toBe(false);
  });
});

describe('answerDietQuestion — the choices', () => {
  it('matches a goal by number or by what they typed, in either language', () => {
    expect(answerDietQuestion('goal', '1')).toEqual({ ok: true, patch: { goal: 'MUSCLE_GAIN' } });
    expect(answerDietQuestion('goal', 'fat loss')).toEqual({ ok: true, patch: { goal: 'FAT_LOSS' } });
    expect(answerDietQuestion('goal', 'weight gain')).toEqual({ ok: true, patch: { goal: 'WEIGHT_GAIN' } });
    expect(answerDietQuestion('goal', 'general')).toEqual({ ok: true, patch: { goal: 'GENERAL_FITNESS' } });
  });

  it('matches the diet type the way members write it', () => {
    expect(answerDietQuestion('dietType', 'veg')).toEqual({ ok: true, patch: { dietType: 'VEG' } });
    expect(answerDietQuestion('dietType', 'non veg')).toEqual({ ok: true, patch: { dietType: 'NON_VEG' } });
    expect(answerDietQuestion('dietType', 'eggetarian')).toEqual({ ok: true, patch: { dietType: 'EGG' } });
    expect(answerDietQuestion('dietType', '4')).toEqual({ ok: true, patch: { dietType: 'VEGAN' } });
  });

  it('refuses a choice it does not recognise', () => {
    expect(answerDietQuestion('goal', 'strong banna hai').ok).toBe(false);
    expect(answerDietQuestion('dietType', '9').ok).toBe(false);
  });
});

describe('answerDietQuestion — allergies and the numbers', () => {
  it('takes "none" in several shapes as no allergies', () => {
    for (const reply of ['none', 'No', 'nahi', 'nothing', '-']) {
      expect(answerDietQuestion('allergies', reply)).toEqual({ ok: true, patch: { allergies: 'none' } });
    }
  });

  it('keeps what they wrote when they wrote something', () => {
    expect(answerDietQuestion('allergies', 'lactose, peanuts')).toEqual({ ok: true, patch: { allergies: 'lactose, peanuts' } });
  });

  it('refuses an essay in the allergies box rather than feeding it to the model', () => {
    expect(answerDietQuestion('allergies', 'x'.repeat(301)).ok).toBe(false);
  });

  it('holds meals and workouts to what a week can contain', () => {
    expect(answerDietQuestion('mealsPerDay', '4')).toEqual({ ok: true, patch: { mealsPerDay: 4 } });
    expect(answerDietQuestion('mealsPerDay', '12').ok).toBe(false);
    expect(answerDietQuestion('workoutsPerWeek', '6')).toEqual({ ok: true, patch: { workoutsPerWeek: 6 } });
    expect(answerDietQuestion('workoutsPerWeek', '9').ok).toBe(false);
    expect(answerDietQuestion('workoutsPerWeek', '0')).toEqual({ ok: true, patch: { workoutsPerWeek: 0 } });
  });

  it('takes an age a person can be', () => {
    expect(answerDietQuestion('age', '31')).toEqual({ ok: true, patch: { ageYears: 31 } });
    expect(answerDietQuestion('age', '8').ok).toBe(false);
    expect(answerDietQuestion('age', '120').ok).toBe(false);
  });
});

describe('bmiFor', () => {
  it('is weight over height squared, to one decimal', () => {
    // 72 kg at 1.70 m → 24.9
    expect(bmiFor({ weightGrams: 72_000, heightCm: 170 })).toBe(24.9);
    expect(bmiFor({ weightGrams: 95_000, heightCm: 165 })).toBe(34.9);
  });

  it('is null when either figure is missing, rather than a number nobody can trust', () => {
    expect(bmiFor({ weightGrams: 72_000, heightCm: undefined })).toBeNull();
    expect(bmiFor({ weightGrams: undefined, heightCm: 170 })).toBeNull();
  });

  it('names the band the way a screening measure should', () => {
    expect(bmiCategory(17.5)).toBe('UNDERWEIGHT');
    expect(bmiCategory(22)).toBe('NORMAL');
    expect(bmiCategory(27)).toBe('OVERWEIGHT');
    expect(bmiCategory(31)).toBe('OBESE');
  });

  it('puts the boundaries where the WHO does', () => {
    expect(bmiCategory(18.5)).toBe('NORMAL');
    expect(bmiCategory(24.9)).toBe('NORMAL');
    expect(bmiCategory(25)).toBe('OVERWEIGHT');
    expect(bmiCategory(30)).toBe('OBESE');
  });
});
