/**
 * Who the camera is looking at (attendance spec §6).
 *
 * Two mistakes matter here and they are not symmetrical. Greeting the wrong member
 * marks the wrong attendance, in front of both of them; failing to recognise somebody
 * costs them one tap on the keypad. So every rule below leans the same way: a match
 * must be good **and** clearly better than the runner-up, and several frames must
 * agree before anything is written down.
 *
 * Pure, and deliberately independent of any face engine: embeddings are numbers, and
 * whether they came from a licensed SDK or a WASM model is not this file's business
 * (spec §4 — the engine is swappable).
 */

export interface FaceTemplateRow {
  readonly id: string;
  readonly memberId: string;
  /** L2-normalised embedding. Length depends on the model; mismatched lengths are ignored. */
  readonly vector: readonly number[];
}

export interface MatchSettings {
  readonly acceptThreshold: number;
  /** How far below `acceptThreshold` still asks the member to confirm. */
  readonly confirmBand: number;
  /** The gap the best match needs over the runner-up, so siblings are not confused. */
  readonly matchMargin: number;
  readonly framesToAgree: number;
}

export type MatchDecision = 'ACCEPT' | 'CONFIRM' | 'UNKNOWN';

export interface MatchResult {
  readonly decision: MatchDecision;
  readonly memberId: string | null;
  readonly score: number;
  /** The best score belonging to somebody else — the number the margin is about. */
  readonly runnerUpScore: number;
}

const UNKNOWN: MatchResult = { decision: 'UNKNOWN', memberId: null, score: 0, runnerUpScore: 0 };

/**
 * Cosine similarity, or null when the two cannot honestly be compared.
 *
 * Null rather than 0: a template from an older model has a different length, and a
 * zero vector has no direction. Both are "no answer", and calling them "no match"
 * would let a broken embedding quietly look like a stranger.
 */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number | null {
  if (a.length !== b.length || a.length === 0) return null;

  let dot = 0;
  let lengthA = 0;
  let lengthB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    lengthA += x * x;
    lengthB += y * y;
  }
  if (lengthA === 0 || lengthB === 0) return null;
  return dot / (Math.sqrt(lengthA) * Math.sqrt(lengthB));
}

export function matchFace(embedding: readonly number[], gallery: readonly FaceTemplateRow[], settings: MatchSettings): MatchResult {
  // A member's best template wins, not their average: someone with one poor old
  // template and one good recent one should be recognised by the good one.
  const bestByMember = new Map<string, number>();
  for (const template of gallery) {
    const score = cosineSimilarity(embedding, template.vector);
    if (score === null) continue;
    const best = bestByMember.get(template.memberId);
    if (best === undefined || score > best) bestByMember.set(template.memberId, score);
  }
  if (bestByMember.size === 0) return UNKNOWN;

  const ranked = [...bestByMember.entries()].sort((a, b) => b[1] - a[1]);
  const [memberId, score] = ranked[0] ?? ['', 0];
  const runnerUpScore = ranked[1]?.[1] ?? 0;

  // Good enough, and clearly better than whoever came second.
  if (score >= settings.acceptThreshold && score - runnerUpScore >= settings.matchMargin) {
    return { decision: 'ACCEPT', memberId, score, runnerUpScore };
  }
  // Nearly good enough, or good but too close to somebody else: ask, never assume.
  if (score >= settings.acceptThreshold - settings.confirmBand) {
    return { decision: 'CONFIRM', memberId, score, runnerUpScore };
  }
  return { ...UNKNOWN, score, runnerUpScore };
}

/**
 * What several frames agree on (spec §6: 3 of 5).
 *
 * One frame is a glance: a member turning their head, someone walking past behind
 * them, a moment of glare. Agreement across frames is what turns a guess into a
 * decision — and if the frames that agreed were themselves uncertain, the decision
 * stays uncertain too.
 */
export function decideFromFrames(frames: readonly MatchResult[], settings: MatchSettings): MatchResult | null {
  const byMember = new Map<string, MatchResult[]>();
  for (const frame of frames) {
    if (frame.memberId === null) continue;
    const seen = byMember.get(frame.memberId) ?? [];
    seen.push(frame);
    byMember.set(frame.memberId, seen);
  }

  for (const [memberId, seen] of byMember) {
    if (seen.length < settings.framesToAgree) continue;
    const best = seen.reduce((a, b) => (b.score > a.score ? b : a));
    // Confident only if most of the agreeing frames were confident.
    const accepts = seen.filter((frame) => frame.decision === 'ACCEPT').length;
    const decision: MatchDecision = accepts > seen.length / 2 ? 'ACCEPT' : 'CONFIRM';
    return { decision, memberId, score: best.score, runnerUpScore: best.runnerUpScore };
  }

  return null;
}
