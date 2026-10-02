import { diffDays, type ISTDate } from '@mfp/shared';

/**
 * The monthly check on a diet plan (ADR-089).
 *
 * **Four questions, not seven.** The client's list had seven; this asks whether they are
 * following it, what the scales say, how they feel, and whether they want it changed — and a
 * fifth only when the answer to the fourth was yes. A member asked seven things on a Tuesday
 * evening answers none of them, and the four here are the ones that change what we would do.
 *
 * The point of the whole exercise is the last rule in this file: a member who says "change
 * it", whose weight has moved three kilos, or who cannot follow the plan at all, gets a new
 * plan written. Anything less and this is a survey, not a service.
 */

export const FOLLOWING_LEVELS = ['MOSTLY', 'SOMETIMES', 'NOT_REALLY'] as const;
export type FollowingLevel = (typeof FOLLOWING_LEVELS)[number];

export const ENERGY_LEVELS = ['BETTER', 'SAME', 'WORSE'] as const;
export type EnergyLevel = (typeof ENERGY_LEVELS)[number];

export interface FollowUpAnswers {
  readonly following?: FollowingLevel | undefined;
  /** Grams, or `null` when the member says it has not changed. */
  readonly weightGrams?: number | null | undefined;
  readonly energy?: EnergyLevel | undefined;
  readonly wantsChange?: boolean | undefined;
  /** What they want changed, asked only when `wantsChange` is true. */
  readonly changeWhat?: string | undefined;
}

export const FOLLOW_UP_QUESTION_KEYS = ['following', 'weight', 'energy', 'wantsChange', 'changeWhat'] as const;
export type FollowUpQuestionKey = (typeof FOLLOW_UP_QUESTION_KEYS)[number];

export interface FollowUpQuestion {
  readonly key: FollowUpQuestionKey;
  readonly fills: keyof FollowUpAnswers;
  /** Asked only when this holds; the last question depends on the fourth answer. */
  readonly onlyIf?: (answers: FollowUpAnswers) => boolean;
}

export const FOLLOW_UP_QUESTIONS: readonly FollowUpQuestion[] = [
  { key: 'following', fills: 'following' },
  { key: 'weight', fills: 'weightGrams' },
  { key: 'energy', fills: 'energy' },
  { key: 'wantsChange', fills: 'wantsChange' },
  { key: 'changeWhat', fills: 'changeWhat', onlyIf: (answers) => answers.wantsChange === true },
];

export function nextFollowUpQuestion(answers: FollowUpAnswers): FollowUpQuestion | null {
  return (
    FOLLOW_UP_QUESTIONS.find((question) => {
      if (question.onlyIf !== undefined && !question.onlyIf(answers)) return false;
      return answers[question.fills] === undefined;
    }) ?? null
  );
}

export type FollowUpAnswerResult =
  | { readonly ok: true; readonly patch: Partial<FollowUpAnswers> }
  | { readonly ok: false; readonly retry: FollowUpQuestionKey };

const FOLLOWING_WORDS: ReadonlyArray<readonly [FollowingLevel, readonly string[]]> = [
  ['MOSTLY', ['mostly', 'yes', 'haan', 'kar raha', 'pura', 'पूरा', 'हाँ']],
  ['SOMETIMES', ['sometimes', 'kabhi', 'thoda', 'partly', 'कभी', 'थोड़ा']],
  ['NOT_REALLY', ['not really', 'no', 'nahi', 'nhi', 'नहीं', 'bilkul nahi']],
];

const ENERGY_WORDS: ReadonlyArray<readonly [EnergyLevel, readonly string[]]> = [
  ['BETTER', ['better', 'good', 'achha', 'accha', 'improved', 'अच्छा', 'बेहतर']],
  ['SAME', ['same', 'ok', 'theek', 'thik', 'no change', 'वही', 'ठीक']],
  ['WORSE', ['worse', 'bad', 'kamzor', 'tired', 'खराब', 'कमज़ोर']],
];

const YES_WORDS = ['yes', 'haan', 'han', 'ha', 'yep', 'chahiye', 'हाँ', 'हां', 'चाहिए'];
const NO_WORDS = ['no', 'nahi', 'nhi', 'nope', 'nahin', 'नहीं', 'नही'];
const SAME_WORDS = ['same', 'no change', 'wahi', 'wahi hai', 'utna hi', 'वही', 'वही है', 'कोई बदलाव नहीं'];

function match<T extends string>(reply: string, table: ReadonlyArray<readonly [T, readonly string[]]>, options: readonly T[]): T | null {
  const text = reply.trim().toLowerCase();
  if (text === '') return null;
  if (/^\d+$/.test(text)) return options[Number(text) - 1] ?? null;
  for (const [value, words] of table) {
    if (words.some((word) => text.includes(word))) return value;
  }
  return null;
}

function firstNumber(text: string): number | null {
  const found = /-?\d+(?:[.,]\d+)?/.exec(text);
  if (found === null) return null;
  const value = Number(found[0].replace(',', '.'));
  return Number.isFinite(value) ? value : null;
}

export function answerFollowUpQuestion(key: FollowUpQuestionKey, reply: string): FollowUpAnswerResult {
  const text = reply.trim();
  const lower = text.toLowerCase();

  switch (key) {
    case 'following': {
      const following = match(text, FOLLOWING_WORDS, FOLLOWING_LEVELS);
      return following === null ? { ok: false, retry: 'following' } : { ok: true, patch: { following } };
    }

    case 'weight': {
      // "Same" is a real answer and a common one; it is not a missing answer.
      if (SAME_WORDS.some((word) => lower.includes(word))) return { ok: true, patch: { weightGrams: null } };
      const kg = firstNumber(text);
      if (kg === null || kg < 25 || kg > 250) return { ok: false, retry: 'weight' };
      return { ok: true, patch: { weightGrams: Math.round(kg * 1000) } };
    }

    case 'energy': {
      const energy = match(text, ENERGY_WORDS, ENERGY_LEVELS);
      return energy === null ? { ok: false, retry: 'energy' } : { ok: true, patch: { energy } };
    }

    case 'wantsChange': {
      if (/^\d+$/.test(lower)) return { ok: true, patch: { wantsChange: lower === '1' } };
      if (YES_WORDS.some((word) => lower.includes(word))) return { ok: true, patch: { wantsChange: true } };
      if (NO_WORDS.some((word) => lower.includes(word))) return { ok: true, patch: { wantsChange: false } };
      return { ok: false, retry: 'wantsChange' };
    }

    case 'changeWhat': {
      if (text === '' || text.length > 400) return { ok: false, retry: 'changeWhat' };
      return { ok: true, patch: { changeWhat: text } };
    }
  }
}

/** Is a check-in due? `everyDays` of 0 means the owner has switched them off. */
export function followUpDue(input: {
  readonly generatedAt: ISTDate;
  readonly lastFollowUpOn: ISTDate | null;
  readonly today: ISTDate;
  readonly everyDays: number;
}): boolean {
  if (input.everyDays <= 0) return false;
  const since = input.lastFollowUpOn ?? input.generatedAt;
  return diffDays(input.today, since) >= input.everyDays;
}

/** Three kilos either way is a different plan; half a kilo is a different morning. */
const WEIGHT_MOVED_GRAMS = 3_000;

/**
 * Should the plan be rewritten?
 *
 * Yes when the member asks, yes when the scales have moved enough to change the numbers, and
 * yes when they cannot follow it at all — a plan nobody can follow is the plan's problem.
 * Otherwise it stands: rewriting a working plan every month would be churn dressed as care.
 */
export function needsNewPlan(answers: FollowUpAnswers, weightAtLastPlanGrams: number | undefined): boolean {
  if (answers.wantsChange === true) return true;
  if (answers.following === 'NOT_REALLY') return true;
  const now = answers.weightGrams;
  if (now === undefined || now === null || weightAtLastPlanGrams === undefined) return false;
  return Math.abs(now - weightAtLastPlanGrams) >= WEIGHT_MOVED_GRAMS;
}
