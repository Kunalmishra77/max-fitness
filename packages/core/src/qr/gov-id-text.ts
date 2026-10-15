import type { GovIdType } from './gov-id';

/**
 * Is this photograph actually the government ID the member said it was? (ADR-120)
 *
 * Members were uploading anything the camera had last — a selfie, a product, a dog —
 * because nothing looked inside the picture. This looks.
 *
 * **Nothing it reads is kept, and nothing it read is returned.** ADR-074 is the reason
 * the gym holds the photograph and never the number: the Aadhaar Act restricts a private
 * company from storing one, and under DPDP it is a liability with no use. A function that
 * handed the number back would have it logged within a month, so this answers with a
 * verdict and the text goes out of scope.
 *
 * **It is forgiving on purpose.** OCR misreads a character in every other line, and a
 * member at a reception desk holding a creased Aadhaar must not be turned away over an
 * `8` an engine read as a `B`. So the markers that identify the card are required — they
 * are what tells a card from a packet of protein powder — while the name and the date are
 * checked only when they can be found. Silence is not a refusal.
 */

export type GovIdTextProblem = 'UNREADABLE' | 'NOT_AN_ID' | 'WRONG_TYPE' | 'NAME_MISMATCH' | 'DOB_MISMATCH';

export type GovIdTextVerdict = { readonly ok: true } | { readonly ok: false; readonly reason: GovIdTextProblem };

/** Below this there is nothing to judge: a blank card, a thumb over the lens, a dark room. */
const MIN_CHARACTERS = 12;

/**
 * What each card says about itself, in either language.
 *
 * Deliberately the printed words rather than the number format: a number is the one thing
 * on the card the gym must not keep, and matching the wording catches the common case —
 * somebody uploading a photograph that is not a card at all.
 */
const MARKERS: Readonly<Record<GovIdType, readonly RegExp[]>> = {
  AADHAAR: [/aadhaar/i, /आधार/, /unique identification/i, /भारत सरकार/],
  PAN: [/permanent account number/i, /income\s*tax/i, /आयकर/],
  DL: [/driving\s*licen[cs]e/i, /ड्राइविंग/, /transport department/i],
  VOTER: [/election commission/i, /elector/i, /निर्वाचन/, /\bepic\b/i],
};

const normalise = (text: string) => text.toLowerCase().replace(/\s+/g, ' ').trim();

/** Any way a card might print a date, reduced to its three numbers. */
const DATE_PATTERN = /(\d{1,2})[\s./-](\d{1,2})[\s./-](\d{4})/g;

function mentionsDate(text: string, iso: string): boolean | null {
  const [year, month, day] = iso.split('-').map(Number) as [number, number, number];
  const found = [...text.matchAll(DATE_PATTERN)];
  // Nothing date-shaped at all: the engine could not read it, which is not evidence.
  if (found.length === 0) return null;
  return found.some((match) => Number(match[1]) === day && Number(match[2]) === month && Number(match[3]) === year);
}

/**
 * Does the card carry this person's name?
 *
 * Every word of the member's name has to appear, and nothing more is asked: a card may
 * print a middle name the form did not, or a surname first. Single letters are skipped,
 * because an initial survives neither OCR nor the gap between how somebody writes their
 * own name and how a clerk once typed it.
 *
 * **A card the engine read only in Devanagari cannot answer this**, and must not be taken
 * as a no. Aadhaar prints the name twice, in English and in the local language, and which
 * one an engine picks up depends on the crease and the light. Comparing a Latin name
 * against Devanagari text would refuse the member for the engine's choice.
 */
function mentionsName(text: string, fullName: string): boolean | null {
  const words = normalise(fullName)
    .split(' ')
    .filter((word) => word.length > 1);
  if (words.length === 0) return null;
  if (words.every((word) => text.includes(word))) return true;

  // Nothing matched. Only call that a mismatch if the card was readable in this script
  // at all; otherwise the honest answer is that we do not know.
  const latinOnName = /[a-z]/.test(words.join(''));
  const latinOnCard = /[a-z]{3}/.test(text);
  return latinOnName && !latinOnCard ? null : false;
}

export function checkGovIdText(
  type: GovIdType,
  rawText: string,
  claimed: { readonly fullName: string; readonly dob: string },
): GovIdTextVerdict {
  const text = normalise(rawText);
  if (text.length < MIN_CHARACTERS) return { ok: false, reason: 'UNREADABLE' };

  // Is it any kind of identity card? A picture of something else fails here, which is the
  // case the owner actually hit.
  const anyType = (Object.keys(MARKERS) as readonly GovIdType[]).filter((candidate) =>
    MARKERS[candidate].some((marker) => marker.test(text)),
  );
  if (anyType.length === 0) return { ok: false, reason: 'NOT_AN_ID' };

  // A real card, but not the one they chose from the list. Saying so is more useful than
  // "bad photo": they picked the wrong kind, and the fix is one tap.
  if (!anyType.includes(type)) return { ok: false, reason: 'WRONG_TYPE' };

  const nameFound = mentionsName(text, claimed.fullName);
  if (nameFound === false) return { ok: false, reason: 'NAME_MISMATCH' };

  const dateFound = mentionsDate(text, claimed.dob);
  if (dateFound === false) return { ok: false, reason: 'DOB_MISMATCH' };

  return { ok: true };
}
