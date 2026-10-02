/**
 * The diet questionnaire (ADR-089).
 *
 * The member answers on WhatsApp, one question at a time, typing one-handed in whatever
 * mixture of Hindi and English they use for everything else. So the parsing is the
 * feature: "72", "72kg", "5'9", "non veg", "nahi" all have to land, and anything we
 * cannot read is **asked again rather than guessed at**. A guessed weight produces a diet
 * for somebody who does not exist, and the member has no way to know it happened.
 *
 * Pure and framework-free: no WhatsApp, no database, no clock. What asks the questions
 * and what stores the answers are somebody else's job.
 */

export const DIET_GOALS = ['MUSCLE_GAIN', 'FAT_LOSS', 'WEIGHT_GAIN', 'WEIGHT_LOSS', 'GENERAL_FITNESS', 'RECOMP'] as const;
export type DietGoal = (typeof DIET_GOALS)[number];

export const DIET_TYPES = ['VEG', 'NON_VEG', 'EGG', 'VEGAN'] as const;
export type DietType = (typeof DIET_TYPES)[number];

export const ACTIVITY_LEVELS = ['DESK', 'ON_FEET', 'HEAVY'] as const;
export type ActivityLevel = (typeof ACTIVITY_LEVELS)[number];

export interface DietAnswers {
  /** Grams, so the stored figure is an integer like money is paise (CLAUDE.md §2.1). */
  readonly weightGrams?: number | undefined;
  readonly heightCm?: number | undefined;
  readonly ageYears?: number | undefined;
  readonly goal?: DietGoal | undefined;
  readonly dietType?: DietType | undefined;
  /** Free text, or the single word `none`. */
  readonly allergies?: string | undefined;
  readonly mealsPerDay?: number | undefined;
  readonly activityLevel?: ActivityLevel | undefined;
  readonly workoutsPerWeek?: number | undefined;
}

export const DIET_QUESTION_KEYS = [
  'weight',
  'height',
  'age',
  'goal',
  'dietType',
  'allergies',
  'mealsPerDay',
  'activityLevel',
  'workoutsPerWeek',
] as const;
export type DietQuestionKey = (typeof DIET_QUESTION_KEYS)[number];

export interface DietQuestion {
  readonly key: DietQuestionKey;
  /** Which answer it fills, so "have we asked this?" is one lookup. */
  readonly fills: keyof DietAnswers;
  /** The options, for the questions that have them; the copy lives in the templates. */
  readonly choices?: readonly string[];
}

export const DIET_QUESTIONS: readonly DietQuestion[] = [
  { key: 'weight', fills: 'weightGrams' },
  { key: 'height', fills: 'heightCm' },
  { key: 'age', fills: 'ageYears' },
  { key: 'goal', fills: 'goal', choices: DIET_GOALS },
  { key: 'dietType', fills: 'dietType', choices: DIET_TYPES },
  { key: 'allergies', fills: 'allergies' },
  { key: 'mealsPerDay', fills: 'mealsPerDay' },
  { key: 'activityLevel', fills: 'activityLevel', choices: ACTIVITY_LEVELS },
  { key: 'workoutsPerWeek', fills: 'workoutsPerWeek' },
];

/** The next unanswered question, or `null` when there is enough to write a plan. */
export function nextDietQuestion(answers: DietAnswers): DietQuestion | null {
  return DIET_QUESTIONS.find((question) => answers[question.fills] === undefined) ?? null;
}

export function dietProfileComplete(answers: DietAnswers): boolean {
  return nextDietQuestion(answers) === null;
}

export type DietAnswerResult =
  | { readonly ok: true; readonly patch: Partial<DietAnswers> }
  | { readonly ok: false; readonly retry: DietQuestionKey };

const no = (retry: DietQuestionKey): DietAnswerResult => ({ ok: false, retry });

/** The first number in a reply: "72 kg" → 72, "about 72.5kg" → 72.5. */
function firstNumber(text: string): number | null {
  const match = /-?\d+(?:[.,]\d+)?/.exec(text);
  if (match === null) return null;
  const value = Number(match[0].replace(',', '.'));
  return Number.isFinite(value) ? value : null;
}

const NONE_WORDS = new Set(['none', 'no', 'nope', 'nothing', 'nil', 'na', 'n/a', '-', 'nahi', 'nahin', 'kuch nahi', 'कुछ नहीं', 'नहीं']);

/** What members type for each option, beyond its number in the list. */
const GOAL_WORDS: ReadonlyArray<readonly [DietGoal, readonly string[]]> = [
  ['MUSCLE_GAIN', ['muscle gain', 'muscle', 'gain muscle', 'bulk', 'mass', 'मसल']],
  ['FAT_LOSS', ['fat loss', 'fat', 'lose fat', 'cutting', 'फैट']],
  ['WEIGHT_GAIN', ['weight gain', 'gain weight', 'wt gain', 'वजन बढ़ाना']],
  ['WEIGHT_LOSS', ['weight loss', 'lose weight', 'wt loss', 'slim', 'वजन कम']],
  ['GENERAL_FITNESS', ['general fitness', 'general', 'fitness', 'fit', 'health', 'फिटनेस']],
  ['RECOMP', ['both', 'muscle and fat', 'recomp', 'muscle building and fat loss', 'दोनों']],
];

const DIET_WORDS: ReadonlyArray<readonly [DietType, readonly string[]]> = [
  // Longest first within each list; "non veg" must not be read as "veg".
  ['NON_VEG', ['non vegetarian', 'non-vegetarian', 'non veg', 'nonveg', 'non-veg', 'nv', 'मांसाहारी']],
  ['EGG', ['eggetarian', 'egg', 'ande', 'अंडा']],
  ['VEGAN', ['vegan', 'वीगन']],
  ['VEG', ['vegetarian', 'veg', 'pure veg', 'शाकाहारी', 'वेज']],
];

const ACTIVITY_WORDS: ReadonlyArray<readonly [ActivityLevel, readonly string[]]> = [
  ['DESK', ['desk', 'desk job', 'sitting', 'office', 'बैठने']],
  ['ON_FEET', ['on feet', 'standing', 'walking', 'shop', 'field', 'खड़े']],
  ['HEAVY', ['heavy', 'labour', 'labor', 'physical', 'mehnat', 'मेहनत']],
];

function matchChoice<T extends string>(reply: string, table: ReadonlyArray<readonly [T, readonly string[]]>, options: readonly T[]): T | null {
  const text = reply.trim().toLowerCase();
  if (text === '') return null;

  // A bare number picks from the list as it was printed to them.
  if (/^\d+$/.test(text)) {
    const picked = options[Number(text) - 1];
    return picked ?? null;
  }
  for (const [value, words] of table) {
    if (words.some((word) => text.includes(word))) return value;
  }
  return null;
}

/**
 * Read one reply.
 *
 * Heights are the interesting case. Most people here know their height in feet and
 * inches, so `5'9` and `5 ft 9` are accepted — but a bare `5.9` is refused, because it is
 * five foot nine to the member and six centimetres to the arithmetic, and getting that
 * wrong feeds a 175cm adult as though they were a doll.
 */
export function answerDietQuestion(key: DietQuestionKey, reply: string): DietAnswerResult {
  const text = reply.trim();

  switch (key) {
    case 'weight': {
      const kg = firstNumber(text);
      if (kg === null || kg < 25 || kg > 250) return no('weight');
      return { ok: true, patch: { weightGrams: Math.round(kg * 1000) } };
    }

    case 'height': {
      const lower = text.toLowerCase();
      const feetInches = /^(\d)\s*(?:'|’|ft|feet|foot)\s*(\d{1,2})?\s*(?:"|''|”|in|inch|inches)?$/.exec(lower);
      if (feetInches !== null) {
        const feet = Number(feetInches[1]);
        const inches = feetInches[2] === undefined ? 0 : Number(feetInches[2]);
        if (feet < 3 || feet > 8 || inches > 11) return no('height');
        return { ok: true, patch: { heightCm: Math.round((feet * 12 + inches) * 2.54) } };
      }
      // Two bare numbers, as in "5 9", are feet and inches; one is centimetres or nothing.
      const pair = /^(\d)\s+(\d{1,2})$/.exec(lower);
      if (pair !== null) {
        const feet = Number(pair[1]);
        const inches = Number(pair[2]);
        if (feet < 3 || feet > 8 || inches > 11) return no('height');
        return { ok: true, patch: { heightCm: Math.round((feet * 12 + inches) * 2.54) } };
      }
      const cm = firstNumber(lower);
      if (cm === null || !Number.isInteger(cm) || cm < 120 || cm > 230) return no('height');
      return { ok: true, patch: { heightCm: cm } };
    }

    case 'age': {
      const years = firstNumber(text);
      if (years === null || !Number.isInteger(years) || years < 12 || years > 100) return no('age');
      return { ok: true, patch: { ageYears: years } };
    }

    case 'goal': {
      const goal = matchChoice(text, GOAL_WORDS, DIET_GOALS);
      return goal === null ? no('goal') : { ok: true, patch: { goal } };
    }

    case 'dietType': {
      const dietType = matchChoice(text, DIET_WORDS, DIET_TYPES);
      return dietType === null ? no('dietType') : { ok: true, patch: { dietType } };
    }

    case 'activityLevel': {
      const activityLevel = matchChoice(text, ACTIVITY_WORDS, ACTIVITY_LEVELS);
      return activityLevel === null ? no('activityLevel') : { ok: true, patch: { activityLevel } };
    }

    case 'allergies': {
      if (text === '') return no('allergies');
      // Three hundred characters is a list of foods; more than that is a conversation,
      // and it would go straight into a model prompt.
      if (text.length > 300) return no('allergies');
      return { ok: true, patch: { allergies: NONE_WORDS.has(text.toLowerCase()) ? 'none' : text } };
    }

    case 'mealsPerDay': {
      const meals = firstNumber(text);
      if (meals === null || !Number.isInteger(meals) || meals < 2 || meals > 8) return no('mealsPerDay');
      return { ok: true, patch: { mealsPerDay: meals } };
    }

    case 'workoutsPerWeek': {
      const days = firstNumber(text);
      if (days === null || !Number.isInteger(days) || days < 0 || days > 7) return no('workoutsPerWeek');
      return { ok: true, patch: { workoutsPerWeek: days } };
    }
  }
}

export const BMI_CATEGORIES = ['UNDERWEIGHT', 'NORMAL', 'OVERWEIGHT', 'OBESE'] as const;
export type BmiCategory = (typeof BMI_CATEGORIES)[number];

/**
 * Weight over height squared, to one decimal (the standard formula).
 *
 * Shown with its band and a line saying what it is not: BMI is a screening measure, and a
 * muscular member will read "overweight" about a body that is nothing of the kind. The
 * plan is built from the goal and the measurements, not from this number.
 */
export function bmiFor(input: { weightGrams?: number | undefined; heightCm?: number | undefined }): number | null {
  const { weightGrams, heightCm } = input;
  if (weightGrams === undefined || heightCm === undefined || heightCm <= 0) return null;
  const metres = heightCm / 100;
  return Math.round((weightGrams / 1000 / (metres * metres)) * 10) / 10;
}

export function bmiCategory(bmi: number): BmiCategory {
  if (bmi < 18.5) return 'UNDERWEIGHT';
  if (bmi < 25) return 'NORMAL';
  if (bmi < 30) return 'OVERWEIGHT';
  return 'OBESE';
}
