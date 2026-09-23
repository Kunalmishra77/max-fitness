import { slotFailureVerdict } from '@mfp/core';
import type { SendIntent } from '@mfp/core';
import type { ISTDate } from '@mfp/shared';

/**
 * The slot failure guard (whatsapp-automation-engine §9).
 *
 * A slot that has started failing is almost never failing member by member: the
 * number is blocked, a token expired, the provider is down. So past a fifth of the
 * sends the whole slot stops and the owner is told, rather than the worker walking
 * cheerfully through another two hundred failures and spending the gym's standing
 * with Meta on them.
 *
 * Stopping is the part that protects the number, so it happens first and is not
 * conditional on the alert getting through.
 */

export interface SlotGuardDeps {
  readonly health: (businessDate: ISTDate, slot: string) => Promise<{ attempted: number; failed: number }>;
  readonly stop: (runKey: string, reason: string) => Promise<void>;
  readonly alertOwner: (slot: string, failed: number, attempted: number) => Promise<void>;
}

/** `2026-09-23@19:00` — the key the slot job claimed its run under. */
export function slotRunKey(intent: SendIntent): string {
  return `${intent.businessDate}@${intent.slot}`;
}

export async function guardSlotAfterFailure(
  intent: SendIntent,
  deps: SlotGuardDeps,
): Promise<{ stopped: boolean; attempted: number; failed: number }> {
  const counts = await deps.health(intent.businessDate, intent.slot);
  const verdict = slotFailureVerdict(counts);
  if (!verdict.stop) return { stopped: false, ...counts };

  await deps.stop(slotRunKey(intent), `${counts.failed} of ${counts.attempted} sends failed`);
  try {
    await deps.alertOwner(intent.slot, counts.failed, counts.attempted);
  } catch {
    // The slot is already stopped, which is what mattered. An alert that could not be
    // written is not a reason to let the rest of the slot go out.
  }
  return { stopped: true, ...counts };
}
