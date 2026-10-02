import { describe, expect, it } from 'vitest';
import { DietPlanDocSchema } from '@mfp/shared';
import { checkDietPlanSafety, dietPlanPrompt, parseDietPlan } from './plan';
import type { DietAnswers } from './questionnaire';

/**
 * Turning answers into a diet plan (ADR-089).
 *
 * The model writes the plan; this file decides what it is asked and what is allowed back.
 * Two rules matter more than the prose. The plan is **data, not a paragraph** — a strict
 * schema, so the PDF can lay it out and a half-finished answer is a failure rather than a
 * page of broken text. And a plan whose numbers are not safe for this member is
 * **refused**, not softened: better the admin sees "could not generate" than a member
 * sees 900 calories a day over the gym's own logo.
 */

const answers: Required<DietAnswers> = {
  weightGrams: 72_000,
  heightCm: 170,
  ageYears: 31,
  goal: 'MUSCLE_GAIN',
  dietType: 'VEG',
  allergies: 'lactose',
  mealsPerDay: 4,
  activityLevel: 'DESK',
  workoutsPerWeek: 5,
};

const doc = (over: Record<string, unknown> = {}) => ({
  summary: 'A vegetarian plan around four meals, built for gaining muscle at a desk job.',
  caloriesPerDay: 2600,
  proteinGramsPerDay: 120,
  meals: [
    { name: 'Breakfast', timing: '7:30 am', items: ['4 idli with sambar', '1 glass soy milk'] },
    { name: 'Lunch', timing: '1:00 pm', items: ['2 roti', 'rajma', 'salad'] },
    { name: 'Pre-workout', timing: '5:30 pm', items: ['banana', 'black coffee'] },
    { name: 'Dinner', timing: '9:00 pm', items: ['paneer bhurji', '2 roti'] },
  ],
  hydration: '3 to 3.5 litres of water across the day.',
  portionGuidance: 'A roti is one fist; paneer is one palm.',
  generalAdvice: ['Eat within an hour of training.', 'Do not skip breakfast on gym days.'],
  seeProfessional: false,
  ...over,
});

describe('dietPlanPrompt', () => {
  const prompt = dietPlanPrompt({
    firstName: 'Suresh',
    gender: 'MALE',
    language: 'en',
    gymName: 'Max Fitness Gym',
    answers,
    bmi: 24.9,
  });

  it('gives the model every answer it was told to consider', () => {
    for (const fact of ['72', '170', '31', 'MUSCLE_GAIN', 'VEG', 'lactose', '4', 'DESK', '5', '24.9']) {
      expect(prompt.user).toContain(fact);
    }
  });

  it('tells it the rules the gym has to live with', () => {
    // Affordable, local food; no medical claims; nothing extreme; say when a professional
    // is needed. These are the client's instructions and our own safety line.
    expect(prompt.system.toLowerCase()).toContain('india');
    expect(prompt.system.toLowerCase()).toContain('affordable');
    expect(prompt.system.toLowerCase()).toContain('not medical advice');
    expect(prompt.system.toLowerCase()).toContain('seeprofessional');
  });

  it('asks for the member language, so a Hindi member gets a Hindi plan', () => {
    const hindi = dietPlanPrompt({ firstName: 'Suresh', gender: 'MALE', language: 'hi', gymName: 'Max Fitness Gym', answers, bmi: 24.9 });
    expect(hindi.system).toContain('Hindi');
  });

  it('never asks for a diet the member cannot eat', () => {
    const vegan = dietPlanPrompt({
      firstName: 'Suresh',
      gender: 'MALE',
      language: 'en',
      gymName: 'Max Fitness Gym',
      answers: { ...answers, dietType: 'VEGAN' },
      bmi: 24.9,
    });
    expect(vegan.user).toContain('VEGAN');
  });
});

describe('parseDietPlan', () => {
  it('takes the JSON the model was asked for', () => {
    const parsed = parseDietPlan(JSON.stringify(doc()));
    expect(parsed.ok).toBe(true);
  });

  it('takes JSON the model wrapped in a code fence anyway', () => {
    // Models do this. Failing the whole generation over three backticks would be silly.
    const parsed = parseDietPlan(['```json', JSON.stringify(doc()), '```'].join('\n'));
    expect(parsed.ok).toBe(true);
  });

  it('refuses anything that is not the shape, rather than half a plan', () => {
    expect(parseDietPlan('not json at all').ok).toBe(false);
    expect(parseDietPlan(JSON.stringify(doc({ meals: [] }))).ok).toBe(false);
    expect(parseDietPlan(JSON.stringify(doc({ caloriesPerDay: 'lots' }))).ok).toBe(false);
    expect(parseDietPlan(JSON.stringify(doc({ summary: undefined }))).ok).toBe(false);
  });
});

describe('checkDietPlanSafety', () => {
  const plan = DietPlanDocSchema.parse(doc());

  it('passes a sensible plan', () => {
    expect(checkDietPlanSafety(plan, answers)).toEqual({ ok: true });
  });

  it('refuses a starvation target for an adult, whatever the goal says', () => {
    const starving = DietPlanDocSchema.parse(doc({ caloriesPerDay: 900 }));
    expect(checkDietPlanSafety(starving, answers)).toEqual({ ok: false, reason: 'CALORIES_TOO_LOW' });
  });

  it('refuses a number nobody should be eating either', () => {
    const feast = DietPlanDocSchema.parse(doc({ caloriesPerDay: 4800 }));
    expect(checkDietPlanSafety(feast, answers)).toEqual({ ok: false, reason: 'CALORIES_TOO_HIGH' });
  });

  it('refuses protein far past what a body uses', () => {
    const tooMuch = DietPlanDocSchema.parse(doc({ proteinGramsPerDay: 260 }));
    expect(checkDietPlanSafety(tooMuch, answers)).toEqual({ ok: false, reason: 'PROTEIN_TOO_HIGH' });
  });

  it('refuses a plan that puts meat in front of a vegetarian', () => {
    // The one mistake a member would notice instantly, and never forgive.
    const wrong = DietPlanDocSchema.parse(
      doc({ meals: [...doc().meals.slice(0, 3), { name: 'Dinner', timing: '9:00 pm', items: ['grilled chicken breast', '2 roti'] }] }),
    );
    expect(checkDietPlanSafety(wrong, answers)).toEqual({ ok: false, reason: 'CONTRADICTS_DIET_TYPE' });
  });

  it('refuses a plan containing something the member is allergic to', () => {
    const wrong = DietPlanDocSchema.parse(
      doc({ meals: [...doc().meals.slice(0, 3), { name: 'Dinner', timing: '9:00 pm', items: ['lactose powder shake'] }] }),
    );
    expect(checkDietPlanSafety(wrong, answers)).toEqual({ ok: false, reason: 'CONTAINS_ALLERGEN' });
  });

  it('lets a non-vegetarian eat chicken', () => {
    const fine = DietPlanDocSchema.parse(
      doc({ meals: [...doc().meals.slice(0, 3), { name: 'Dinner', timing: '9:00 pm', items: ['grilled chicken breast'] }] }),
    );
    expect(checkDietPlanSafety(fine, { ...answers, dietType: 'NON_VEG', allergies: 'none' })).toEqual({ ok: true });
  });

  it('allows eggs for an eggetarian but not for a vegan', () => {
    const withEgg = DietPlanDocSchema.parse(
      doc({ meals: [...doc().meals.slice(0, 3), { name: 'Dinner', timing: '9:00 pm', items: ['3 boiled eggs'] }] }),
    );
    expect(checkDietPlanSafety(withEgg, { ...answers, dietType: 'EGG', allergies: 'none' })).toEqual({ ok: true });
    expect(checkDietPlanSafety(withEgg, { ...answers, dietType: 'VEGAN', allergies: 'none' })).toEqual({ ok: false, reason: 'CONTRADICTS_DIET_TYPE' });
  });

  it('refuses milk and paneer for a vegan', () => {
    expect(checkDietPlanSafety(plan, { ...answers, dietType: 'VEGAN', allergies: 'none' })).toEqual({ ok: false, reason: 'CONTRADICTS_DIET_TYPE' });
  });
});
