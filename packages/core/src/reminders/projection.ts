import { addDays, compareISTDates, type E164Mobile, type ISTDate, type MemberStatus } from '@mfp/shared';
import { planSlot, type ReminderCandidate, type SendIntent } from './engine';
import type { ReminderRule } from './rules';

/**
 * What the gym will send over the next month, if nothing changes
 * (whatsapp-automation-engine §10).
 *
 * The Message Simulator's timeline. It runs the same `planSlot` the worker runs, one
 * day and slot at a time against future dates, so the forecast cannot drift from what
 * actually happens — if a rule changes, both change together.
 *
 * "If nothing changes" is the whole caveat: nobody renews in a forecast, nobody
 * unsubscribes, and nobody joins. It is a plan, not a promise, and the screen says so.
 */

export interface ProjectionMember extends ReminderCandidate {
  readonly status: MemberStatus;
  readonly whatsappOptIn: boolean;
  readonly remindersUnsubscribedAt: Date | null;
  /** IST date; reminders resume the day after this (BR-5.3 rule 3). */
  readonly remindersPausedUntil: ISTDate | null;
  /** A reminder about a superseded membership is never sent (BR-5.3 rule 4). */
  readonly latestConfirmedMembershipId: string | null;
}

export interface ProjectedMessage {
  readonly slot: string;
  readonly intent: SendIntent;
}

export interface ProjectedDay {
  readonly date: ISTDate;
  readonly messages: readonly ProjectedMessage[];
  /** How many the day's per-number cap held back (BR-5.6). */
  readonly skipped: number;
}

/**
 * Whether this member would be messaged at all on this date.
 *
 * The date-independent half of BR-5.3 — left, opted out, unsubscribed, superseded —
 * plus the one rule that changes as the forecast walks forward: a pause ends, and the
 * member starts getting messages again the day after.
 */
function eligibleOn(member: ProjectionMember, date: ISTDate): boolean {
  if (member.status !== 'ACTIVE' || !member.whatsappOptIn || member.remindersUnsubscribedAt !== null) return false;
  if (member.latestConfirmedMembershipId !== null && member.latestConfirmedMembershipId !== member.membershipId) return false;
  if (member.remindersPausedUntil !== null && compareISTDates(member.remindersPausedUntil, date) >= 0) return false;
  return true;
}

export function projectReminders(
  input: {
    readonly from: ISTDate;
    readonly days: number;
    readonly slots: readonly string[];
    readonly rules: readonly ReminderRule[];
    readonly members: readonly ProjectionMember[];
    readonly maxMessagesPerNumberPerDay: number;
  },
  deps: {
    readonly tokens: { renewUrl: (memberId: string) => string; unsubscribePayload: (memberId: string) => string };
  },
): ProjectedDay[] {
  const slots = [...input.slots].sort();
  const projected: ProjectedDay[] = [];

  for (let offset = 0; offset < input.days; offset += 1) {
    const date = addDays(input.from, offset);
    const candidates = input.members.filter((member) => eligibleOn(member, date));

    // The cap is a *daily* one (BR-5.6), so it is counted across the day's slots
    // rather than inside each of them: a family that used up the morning must not
    // get another round in the evening.
    const perNumber = new Map<E164Mobile, number>();
    const messages: ProjectedMessage[] = [];
    let skipped = 0;

    for (const slot of slots) {
      // Given an unlimited slot, `planSlot` answers only "which rule fires for whom";
      // the cap is then applied here, once, for the whole day.
      const plan = planSlot({ today: date, slot, rules: input.rules, candidates, maxMessagesPerNumberPerDay: Number.MAX_SAFE_INTEGER }, deps);

      for (const intent of plan.intents) {
        const alreadySent = perNumber.get(intent.to) ?? 0;
        if (alreadySent >= input.maxMessagesPerNumberPerDay) {
          skipped += 1;
          continue;
        }
        perNumber.set(intent.to, alreadySent + 1);
        messages.push({ slot, intent });
      }
    }

    projected.push({ date, messages, skipped });
  }

  return projected;
}

/** One number the owner actually asks for: how many messages this month. */
export function projectedTotal(days: readonly ProjectedDay[]): { messages: number; skipped: number } {
  return days.reduce(
    (total, day) => ({ messages: total.messages + day.messages.length, skipped: total.skipped + day.skipped }),
    { messages: 0, skipped: 0 },
  );
}

