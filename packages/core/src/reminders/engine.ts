import { formatISTDate, type E164Mobile, type ISTDate, type Language, type ReminderRuleCode, type WhatsAppTemplateName } from '@mfp/shared';
import { offsetFromEndDate, ruleCoversOffset, ruleCoversSlot, type ReminderRule } from './rules';

/**
 * What a slot would send, right now (whatsapp-automation-engine §5; ADR-002, BR-5).
 *
 * Nothing is scheduled per member: at each slot the database is asked who qualifies
 * today, and this turns those rows into messages. A renewal, a pause or an unsubscribe
 * therefore takes effect at the next slot with nothing to cancel — and the send job
 * checks eligibility once more immediately before it sends (BR-5.3).
 *
 * Pure: the caller brings the candidates, the rules and the settings.
 */

export interface ReminderCandidate {
  readonly memberId: string;
  readonly membershipId: string;
  readonly firstName: string;
  readonly mobile: E164Mobile;
  readonly language: Language;
  /** The last day the membership covers. */
  readonly endDate: ISTDate;
}

export interface ReminderButtons {
  /** The URL button: a signed renew link for this member. */
  readonly renewUrl: string;
  /** The quick-reply payload behind "Unsubscribe" (BR-6.1). */
  readonly unsubscribePayload: string;
}

export interface SendIntent {
  /** `rem:{memberId}:{membershipId}:{ruleCode}:{date}:{slot}` (BR-5.4); unique in MessageLog. */
  readonly idempotencyKey: string;
  readonly memberId: string;
  readonly membershipId: string;
  readonly ruleCode: ReminderRuleCode;
  readonly templateName: WhatsAppTemplateName;
  readonly language: Language;
  readonly to: E164Mobile;
  readonly variables: Readonly<Record<string, string>>;
  readonly buttons: ReminderButtons;
}

export type SkipReason = 'NUMBER_CAP';

export interface SkippedIntent {
  readonly idempotencyKey: string;
  readonly memberId: string;
  readonly membershipId: string;
  readonly ruleCode: ReminderRuleCode;
  readonly reason: SkipReason;
}

export interface SlotPlan {
  readonly intents: readonly SendIntent[];
  /** Logged as SKIPPED with the reason, so the owner can see why a message did not go. */
  readonly skipped: readonly SkippedIntent[];
}

/** `{{3}}` in T1: how a person would say the distance to the end date. */
export function relativeDayPhrase(offsetDays: number, language: Language): string {
  const hindi = language === 'hi';
  if (offsetDays === 0) return hindi ? 'आज' : 'today';
  if (offsetDays === -1) return hindi ? 'कल' : 'tomorrow';
  if (offsetDays === 1) return hindi ? 'कल' : 'yesterday';
  const days = Math.abs(offsetDays);
  if (offsetDays < 0) return hindi ? `${days} दिन बाद` : `in ${days} days`;
  return hindi ? `${days} दिन पहले` : `${days} days ago`;
}

/** The variables each reminder template declares (whatsapp-templates.md T1–T3). */
function buildVariables(candidate: ReminderCandidate, offsetDays: number): Record<string, string> {
  const endDate = formatISTDate(candidate.endDate, candidate.language);
  const base = { firstName: candidate.firstName, endDate };
  // Only T1 carries the phrase; the other two name the date and nothing else.
  return { ...base, ...(offsetDays < 0 ? { whenPhrase: relativeDayPhrase(offsetDays, candidate.language) } : {}) };
}

/**
 * The rule for this day, when more than one could match.
 *
 * Rules are meant not to overlap, and the settings screen prevents it, but a stored
 * overlap must not become two messages: the rule whose own day is nearest to today
 * wins, so the day after expiry is POST and the last day is DUE_TODAY.
 */
function ruleForDay(rules: readonly ReminderRule[], offsetDays: number, slot: string): ReminderRule | undefined {
  const matching = rules.filter((rule) => rule.isEnabled && ruleCoversSlot(rule, slot) && ruleCoversOffset(rule, offsetDays));
  return matching.reduce<ReminderRule | undefined>(
    (best, rule) => (best === undefined || rule.offsetDays > best.offsetDays ? rule : best),
    undefined,
  );
}

export function planSlot(
  input: {
    readonly today: ISTDate;
    readonly slot: string;
    readonly rules: readonly ReminderRule[];
    readonly candidates: readonly ReminderCandidate[];
    /** BR-5.6: how many reminders one phone number may receive in a day, families included. */
    readonly maxMessagesPerNumberPerDay: number;
  },
  deps: {
    readonly tokens: {
      renewUrl: (memberId: string) => string;
      unsubscribePayload: (memberId: string) => string;
    };
  },
): SlotPlan {
  const intents: SendIntent[] = [];
  const skipped: SkippedIntent[] = [];
  const perNumber = new Map<string, number>();

  for (const candidate of input.candidates) {
    const offsetDays = offsetFromEndDate(input.today, candidate.endDate);
    const rule = ruleForDay(input.rules, offsetDays, input.slot);
    if (rule === undefined) continue;

    const idempotencyKey = `rem:${candidate.memberId}:${candidate.membershipId}:${rule.code}:${input.today}:${input.slot}`;
    const sentToNumber = perNumber.get(candidate.mobile) ?? 0;
    if (sentToNumber >= input.maxMessagesPerNumberPerDay) {
      skipped.push({ idempotencyKey, memberId: candidate.memberId, membershipId: candidate.membershipId, ruleCode: rule.code, reason: 'NUMBER_CAP' });
      continue;
    }
    perNumber.set(candidate.mobile, sentToNumber + 1);

    intents.push({
      idempotencyKey,
      memberId: candidate.memberId,
      membershipId: candidate.membershipId,
      ruleCode: rule.code,
      templateName: rule.templateName,
      language: candidate.language,
      to: candidate.mobile,
      variables: buildVariables(candidate, offsetDays),
      buttons: {
        renewUrl: deps.tokens.renewUrl(candidate.memberId),
        unsubscribePayload: deps.tokens.unsubscribePayload(candidate.memberId),
      },
    });
  }

  return { intents, skipped };
}
