import type { ReminderRuleCode } from '@mfp/shared';

/**
 * The two guards that stop a bad night becoming a banned number
 * (whatsapp-automation-engine §9).
 *
 * Both are deliberately blunt. They stop sending and tell the owner; neither tries to
 * work out *why*, because the thing that knows why is Meta, and the only safe move
 * while the answer is unknown is to stop pushing.
 *
 * What they do **not** stop is as important as what they do. A receipt, a welcome and
 * a pre-expiry reminder are messages the member is expecting; it is the chasing after
 * expiry that earns a quality downgrade, so that is what gets paused.
 */

/**
 * Meta's own signals that the gym's number is in trouble.
 *
 * 131049 healthy-ecosystem hold, 131048 spam-rate limit, 130472 the user is in an
 * experiment group, 131056 pair-rate limit. A plain undeliverable (131026) is one
 * member's problem and is deliberately not here.
 */
export const QUALITY_ERROR_CODES: ReadonlySet<string> = new Set(['131049', '131048', '130472', '131056']);

export function isQualitySignal(errorCode: string | null | undefined): boolean {
  return errorCode != null && QUALITY_ERROR_CODES.has(errorCode);
}

/** §9: a quality drop pauses the post-expiry rule and nothing else. */
export const RULES_PAUSED_ON_QUALITY_DROP: readonly ReminderRuleCode[] = ['POST'];

export interface QualityGuardStore {
  /** Disables the named rules; returns how many were actually still enabled. */
  disableRules(codes: readonly ReminderRuleCode[]): Promise<number>;
  alertOwner(errorCode: string, message: string): Promise<void>;
}

export async function pauseOnQualitySignal(
  input: { errorCode: string; message: string },
  store: QualityGuardStore,
): Promise<{ paused: readonly ReminderRuleCode[] }> {
  if (!isQualitySignal(input.errorCode)) return { paused: [] };

  const disabled = await store.disableRules(RULES_PAUSED_ON_QUALITY_DROP);
  // Meta repeats the same error for every message in the batch. The rule is already
  // off by the second one, so the owner hears about it once rather than forty times.
  if (disabled === 0) return { paused: [] };

  await store.alertOwner(input.errorCode, input.message);
  return { paused: RULES_PAUSED_ON_QUALITY_DROP };
}

/** §9: more than a fifth of a slot's sends failing means the channel, not the members. */
export const SLOT_FAILURE_THRESHOLD = 0.2;
/**
 * Below this many attempts the ratio says nothing: one failure out of two is 50% and
 * means only that one message failed.
 */
export const SLOT_FAILURE_MINIMUM_ATTEMPTS = 5;

export function slotFailureVerdict(
  counts: { attempted: number; failed: number },
  options: { threshold?: number; minimumAttempts?: number } = {},
): { stop: boolean; ratio: number } {
  const threshold = options.threshold ?? SLOT_FAILURE_THRESHOLD;
  const minimum = options.minimumAttempts ?? SLOT_FAILURE_MINIMUM_ATTEMPTS;

  if (counts.attempted <= 0) return { stop: false, ratio: 0 };
  const ratio = counts.failed / counts.attempted;
  return { stop: counts.attempted >= minimum && ratio > threshold, ratio };
}
