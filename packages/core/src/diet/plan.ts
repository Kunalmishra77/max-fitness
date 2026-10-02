import { DietPlanDocSchema, type DietPlanDoc, type Gender, type Language } from '@mfp/shared';
import type { DietAnswers, DietType } from './questionnaire';

/**
 * Asking for a diet plan, and deciding what is allowed back (ADR-089).
 *
 * The model writes the plan. This file decides what it is told and what is accepted, and
 * both halves are here together on purpose: the prompt's promises and the checks that
 * enforce them have to be read side by side, or they drift.
 *
 * Two rules matter more than the prose:
 *
 * **The plan is data, not a paragraph.** JSON in a fixed shape, so the PDF can lay it out,
 * the WhatsApp message can be built from it, and a half-written answer fails the parse
 * instead of reaching a member.
 *
 * **A plan that is wrong for this member is refused, not softened.** Nine hundred calories,
 * chicken for a vegetarian, milk for somebody lactose intolerant: the admin sees "could
 * not generate, try again" rather than the member seeing it over the gym's own logo. This
 * is the part that cannot be left to the model being well behaved.
 */

export interface DietPromptInput {
  readonly firstName: string;
  readonly gender: Gender;
  readonly language: Language;
  readonly gymName: string;
  readonly answers: DietAnswers;
  readonly bmi: number | null;
  /** What the member said at the last follow-up, when this is a revision (ADR-089). */
  readonly feedback?: string | undefined;
}

export interface DietPrompt {
  readonly system: string;
  readonly user: string;
}

const DIET_RULES: Readonly<Record<DietType, string>> = {
  VEG: 'Vegetarian: no meat, no fish, no eggs. Dairy is fine unless an allergy says otherwise.',
  NON_VEG: 'Non-vegetarian: meat, fish and eggs are all fine.',
  EGG: 'Eggetarian: eggs and dairy are fine, but no meat and no fish.',
  VEGAN: 'Vegan: no meat, no fish, no eggs, and no dairy at all — no milk, curd, paneer, ghee, butter or whey.',
};

export function dietPlanPrompt(input: DietPromptInput): DietPrompt {
  const { answers } = input;
  const dietType = answers.dietType ?? 'VEG';

  const system = [
    `You write practical diet plans for members of ${input.gymName}, a neighbourhood gym in Indirapuram, Ghaziabad, India.`,
    '',
    'Rules you must follow:',
    '- Use everyday Indian food that is affordable and easy to find in a local market: dal, roti, rice, curd, paneer, eggs, seasonal vegetables and fruit, poha, idli, upma, chana, rajma, soya. Do not build a plan around imported or expensive items, and do not assume the member has supplements.',
    `- ${DIET_RULES[dietType]} Never include anything this rule forbids, in any meal.`,
    '- Never include anything the member says they are allergic to, or that they have asked to avoid.',
    '- Keep the calorie and protein targets realistic for the member in front of you. Never write an extreme or crash diet, and never a target an adult cannot live on.',
    '- This is general wellness guidance, not medical advice. Make no medical claims, diagnose nothing, and promise no specific weight change by a specific date.',
    '- If the member has a condition, a restriction or a combination you should not plan around alone, set seeProfessional to true and keep the plan conservative.',
    `- Write every line the member will read in ${input.language === 'hi' ? 'Hindi (Devanagari), using the English names of foods where that is how people say them' : 'simple English'}.`,
    '',
    'Reply with JSON only — no prose, no code fence — in exactly this shape:',
    '{"summary":string,"caloriesPerDay":integer,"proteinGramsPerDay":integer,"meals":[{"name":string,"timing":string,"items":[string],"note":string?}],"hydration":string,"portionGuidance":string,"generalAdvice":[string],"seeProfessional":boolean}',
  ].join('\n');

  const user = [
    `Member: ${input.firstName}`,
    `Gender: ${input.gender}`,
    `Age: ${answers.ageYears ?? 'not given'} years`,
    `Weight: ${answers.weightGrams === undefined ? 'not given' : `${answers.weightGrams / 1000} kg`}`,
    `Height: ${answers.heightCm ?? 'not given'} cm`,
    `BMI: ${input.bmi ?? 'not calculated'}`,
    `Goal: ${answers.goal ?? 'GENERAL_FITNESS'}`,
    `Diet: ${dietType}`,
    `Allergies or foods to avoid: ${answers.allergies ?? 'none'}`,
    `Meals per day: ${answers.mealsPerDay ?? 3}`,
    `Daily activity: ${answers.activityLevel ?? 'DESK'}`,
    `Gym sessions per week: ${answers.workoutsPerWeek ?? 0}`,
    ...(input.feedback === undefined || input.feedback.trim() === ''
      ? []
      : ['', `What the member said about their last plan: ${input.feedback.trim()}`, 'Take that into account in this one.']),
    '',
    `Write ${answers.mealsPerDay ?? 3} meals for one day, with timings that fit those gym sessions.`,
  ].join('\n');

  return { system, user };
}

export type DietParseResult = { readonly ok: true; readonly plan: DietPlanDoc } | { readonly ok: false };

/** The model's reply, as a plan — or a refusal. A code fence is forgiven; nothing else is. */
export function parseDietPlan(raw: string): DietParseResult {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false };
  }
  const parsed = DietPlanDocSchema.safeParse(value);
  return parsed.success ? { ok: true, plan: parsed.data } : { ok: false };
}

export const DIET_SAFETY_REASONS = [
  'CALORIES_TOO_LOW',
  'CALORIES_TOO_HIGH',
  'PROTEIN_TOO_HIGH',
  'CONTRADICTS_DIET_TYPE',
  'CONTAINS_ALLERGEN',
] as const;
export type DietSafetyReason = (typeof DIET_SAFETY_REASONS)[number];

export type DietSafetyResult = { readonly ok: true } | { readonly ok: false; readonly reason: DietSafetyReason };

/** Words that give away a food the member's diet forbids. Lower case, matched loosely. */
const FORBIDDEN: Readonly<Record<DietType, readonly string[]>> = {
  VEG: ['chicken', 'mutton', 'fish', 'prawn', 'egg', 'beef', 'pork', 'meat', 'bacon', 'tuna', 'salmon', 'keema'],
  NON_VEG: [],
  EGG: ['chicken', 'mutton', 'fish', 'prawn', 'beef', 'pork', 'meat', 'bacon', 'tuna', 'salmon', 'keema'],
  VEGAN: [
    'chicken', 'mutton', 'fish', 'prawn', 'egg', 'beef', 'pork', 'meat', 'bacon', 'tuna', 'salmon', 'keema',
    'milk', 'curd', 'dahi', 'paneer', 'ghee', 'butter', 'cheese', 'whey', 'yoghurt', 'yogurt', 'lassi', 'malai',
  ],
};

/** "soy milk" and "almond milk" are vegan; the word "milk" alone is not. */
const VEGAN_EXCEPTIONS = ['soy milk', 'soya milk', 'almond milk', 'oat milk', 'coconut milk', 'peanut butter', 'plant milk'];

function mealText(plan: DietPlanDoc): string {
  return plan.meals
    .flatMap((meal) => [meal.name, meal.timing, ...meal.items, meal.note ?? ''])
    .join(' | ')
    .toLowerCase();
}

/**
 * Is this plan safe for this member?
 *
 * The calorie floor is the one worth explaining: 1,200 for an adult is the lowest figure
 * anybody should be eating without supervision, and a model asked for "fat loss" will go
 * below it if nothing stops it. The ceiling and the protein cap are there for the same
 * reason in the other direction — a number that large is a mistake, not a bulk.
 */
export function checkDietPlanSafety(plan: DietPlanDoc, answers: DietAnswers): DietSafetyResult {
  if (plan.caloriesPerDay < 1_200) return { ok: false, reason: 'CALORIES_TOO_LOW' };
  if (plan.caloriesPerDay > 4_500) return { ok: false, reason: 'CALORIES_TOO_HIGH' };

  // Past about 3 g per kg there is no use for it, and most such numbers are slips.
  const kg = (answers.weightGrams ?? 70_000) / 1000;
  if (plan.proteinGramsPerDay > Math.max(200, kg * 3)) return { ok: false, reason: 'PROTEIN_TOO_HIGH' };

  const text = mealText(plan);
  const dietType = answers.dietType ?? 'VEG';
  const cleaned = dietType === 'VEGAN' ? VEGAN_EXCEPTIONS.reduce((acc, phrase) => acc.split(phrase).join(' '), text) : text;
  if (FORBIDDEN[dietType].some((word) => cleaned.includes(word))) return { ok: false, reason: 'CONTRADICTS_DIET_TYPE' };

  const allergies = (answers.allergies ?? 'none').toLowerCase();
  if (allergies !== 'none' && allergies.trim() !== '') {
    // Each thing they listed, on its own; a two-letter fragment would match anything.
    const listed = allergies
      .split(/[,;/]|\band\b|\bor\b/)
      .map((item) => item.trim())
      .filter((item) => item.length >= 3);
    if (listed.some((item) => text.includes(item))) return { ok: false, reason: 'CONTAINS_ALLERGEN' };
  }

  return { ok: true };
}
