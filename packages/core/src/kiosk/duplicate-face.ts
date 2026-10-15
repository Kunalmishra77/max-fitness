import { cosineSimilarity, type FaceTemplateRow } from './matcher';

/**
 * Has this face already joined? (ADR-118)
 *
 * The owner registered as "Kunal Mishra" on one number and "Indresh Mishra" on another,
 * with their own face both times, and the gym took both. Nothing caught it: the names
 * differed, the numbers differed, and the only thing that did not change was the face.
 *
 * **It is deliberately harder to satisfy than the check-in matcher.** Greeting the wrong
 * member at the door costs one tap to correct. Telling somebody who really is new that
 * they have already joined, at a desk with a queue behind them, costs them the sign-up
 * and the gym the member — so this answers only when it is sure, and the desk is the way
 * round it when it is wrong.
 *
 * There is no runner-up margin here, unlike the matcher. The question is not *which*
 * member this is but *whether* the gym already holds this face, and two templates of the
 * same person scoring alike is the expected shape of a yes rather than a reason to doubt.
 */

export interface DuplicateFaceSettings {
  readonly duplicateThreshold: number;
  /**
   * The member this submission is already about, if any. At the reception QR an existing
   * member is supposed to match themselves; only somebody else's record is a duplicate.
   */
  readonly exceptMemberId?: string;
}

export interface DuplicateFace {
  readonly memberId: string;
  readonly score: number;
}

export function findDuplicateFace(
  embedding: readonly number[],
  gallery: readonly FaceTemplateRow[],
  settings: DuplicateFaceSettings,
): DuplicateFace | null {
  let best: DuplicateFace | null = null;

  for (const template of gallery) {
    if (template.memberId === settings.exceptMemberId) continue;
    const score = cosineSimilarity(embedding, template.vector);
    if (score === null || score < settings.duplicateThreshold) continue;
    // A member's best template speaks for them, as at check-in: one poor old photograph
    // should not hide a good recent one.
    if (best === null || score > best.score) best = { memberId: template.memberId, score };
  }

  return best;
}
