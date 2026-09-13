import { diffDays, type ISTDate, type ISTTime, type ReminderRuleCode, type WhatsAppTemplateName } from '@mfp/shared';

/**
 * Which reminder rule fires on which day (BR-5.1).
 *
 * ADR-002: rules are evaluated at each send slot rather than scheduled per member.
 * That is what makes renewal and unsubscribe work — the next evaluation simply finds
 * nothing to send, so there are no queued jobs to hunt down and cancel.
 *
 * The sign convention throughout: `offsetDays = today − endDate`. Negative before
 * expiry (PRE_7 is −7), zero on the day, positive after (POST is +1 upwards). This
 * matches the SQL in database-design.md §4.2 exactly, on purpose.
 */

export interface ReminderRule {
  readonly code: ReminderRuleCode;
  readonly offsetDays: number;
  /** Inclusive upper bound for a range rule. `null` = uncapped. Equals `offsetDays` for single-day rules. */
  readonly offsetDaysTo: number | null;
  readonly slots: readonly string[];
  readonly templateName: WhatsAppTemplateName;
  readonly isEnabled: boolean;
}

/** `today − endDate`. −7 on the PRE_7 day, +1 the day after expiry. */
export function offsetFromEndDate(today: ISTDate, endDate: ISTDate): number {
  return diffDays(today, endDate);
}

/**
 * Does this rule cover this offset?
 *
 * An uncapped POST rule (`offsetDaysTo === null`) matches every day from
 * `offsetDays` onwards. BR-5.2 allows it but the settings screen warns, because it
 * means messaging people who left months ago — which is how a WhatsApp number's
 * quality rating gets downgraded.
 */
export function ruleCoversOffset(rule: ReminderRule, offsetDays: number): boolean {
  if (offsetDays < rule.offsetDays) return false;
  if (rule.offsetDaysTo === null) return true;
  return offsetDays <= rule.offsetDaysTo;
}

export function ruleCoversSlot(rule: ReminderRule, slot: ISTTime | string): boolean {
  return rule.slots.includes(slot);
}

/**
 * The rules that fire for a membership at a given slot.
 *
 * Normally at most one. Two rules matching the same day and slot would be a
 * misconfiguration, so the caller sends only the first and the settings screen
 * prevents the overlap.
 */
export function matchingRules(
  rules: readonly ReminderRule[],
  today: ISTDate,
  endDate: ISTDate,
  slot: ISTTime | string,
): ReminderRule[] {
  const offset = offsetFromEndDate(today, endDate);
  return rules.filter((r) => r.isEnabled && ruleCoversSlot(r, slot) && ruleCoversOffset(r, offset));
}

/**
 * The end dates a slot's candidate query should look for.
 *
 * Single-day rules give exact dates; the POST range gives a window. Returning both
 * lets the SQL stay one indexed query (`endDate IN (...) OR endDate BETWEEN ...`)
 * rather than a scan (database-design.md §4.2).
 */
export function candidateEndDates(
  rules: readonly ReminderRule[],
  today: ISTDate,
  slot: ISTTime | string,
): { exactOffsets: number[]; ranges: Array<{ from: number; to: number | null }> } {
  const exactOffsets: number[] = [];
  const ranges: Array<{ from: number; to: number | null }> = [];

  for (const rule of rules) {
    if (!rule.isEnabled || !ruleCoversSlot(rule, slot)) continue;
    if (rule.offsetDaysTo !== null && rule.offsetDaysTo === rule.offsetDays) {
      exactOffsets.push(rule.offsetDays);
    } else {
      ranges.push({ from: rule.offsetDays, to: rule.offsetDaysTo });
    }
  }

  return { exactOffsets, ranges };
}

/**
 * BR-5.4: `rem:{memberId}:{membershipId}:{ruleCode}:{yyyy-mm-dd}:{slot}`.
 *
 * The unique constraint on `MessageLog.idempotencyKey` is what makes a duplicate
 * cron fire (case R15) and a catch-up run (R16) both harmless. Every component
 * matters: drop the slot and the three POST sends collapse into one; drop the
 * membership and a renewal would inherit the old membership's send history.
 */
export function reminderIdempotencyKey(input: {
  readonly memberId: string;
  readonly membershipId: string;
  readonly ruleCode: ReminderRuleCode;
  readonly date: ISTDate;
  readonly slot: ISTTime | string;
}): string {
  return `rem:${input.memberId}:${input.membershipId}:${input.ruleCode}:${input.date}:${input.slot}`;
}

/**
 * BR-5.7: past the post-expiry cap, automatic reminders stop and the member moves
 * to the call list instead. This is the boundary between "the system will keep
 * trying" and "a human needs to ring them".
 */
export function isBeyondPostExpiryCap(
  today: ISTDate,
  endDate: ISTDate,
  postExpiryMaxDays: number | null,
): boolean {
  if (postExpiryMaxDays === null) return false;
  return offsetFromEndDate(today, endDate) > postExpiryMaxDays;
}

/** Every distinct slot across the enabled rules — the cron times the worker registers. */
export function distinctSlots(rules: readonly ReminderRule[]): string[] {
  return [...new Set(rules.filter((r) => r.isEnabled).flatMap((r) => r.slots))].sort();
}
