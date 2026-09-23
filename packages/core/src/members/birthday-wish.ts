import type { ISTDate, Language, MemberStatus } from '@mfp/shared';
import type { OutboxEventInput } from '../ports/outbox';
import { assertCan, type CrmActor } from '../crm/permissions';
import { isBirthdayToday } from './birthdays';

/**
 * The birthday wish the desk sends (BR-8.2).
 *
 * It is a tap, not a job: `autoBirthdayWish` is off, because a greeting that arrives
 * by itself to someone who stopped coming months ago reads worse than no greeting.
 * So this only queues the message, and everything that decides *whether* is checked
 * here rather than in the button.
 *
 * The wish is a marketing message in Meta's eyes, so it needs the member's WhatsApp
 * opt-in and stops at an unsubscribe like anything else.
 */

export interface BirthdayWishMember {
  readonly memberId: string;
  readonly gymId: string;
  readonly fullName: string;
  readonly dob: ISTDate | null;
  readonly status: MemberStatus;
  readonly language: Language;
  readonly whatsappOptIn: boolean;
  readonly remindersUnsubscribedAt: Date | null;
  readonly hasMobile: boolean;
}

export interface BirthdayWishStore {
  member(memberId: string): Promise<BirthdayWishMember | null>;
  /** True when this year's wish is already in the message log. */
  alreadySent(idempotencyKey: string): Promise<boolean>;
  enqueueOutbox(event: OutboxEventInput): Promise<void>;
}

export type BirthdayWishOutcome = 'QUEUED' | 'ALREADY_SENT' | 'NOT_TODAY' | 'NOT_ELIGIBLE' | 'NOT_FOUND';

export async function sendBirthdayWish(
  input: { memberId: string },
  deps: { actor: CrmActor; gymId: string; today: ISTDate; now: Date; store: BirthdayWishStore },
): Promise<{ outcome: BirthdayWishOutcome }> {
  assertCan(deps.actor, 'member.edit', deps.now);

  const member = await deps.store.member(input.memberId);
  if (member === null || member.gymId !== deps.gymId) return { outcome: 'NOT_FOUND' };

  if (member.dob === null || !isBirthdayToday(member.dob, deps.today)) return { outcome: 'NOT_TODAY' };
  if (member.status !== 'ACTIVE' || !member.whatsappOptIn || member.remindersUnsubscribedAt !== null || !member.hasMobile) {
    return { outcome: 'NOT_ELIGIBLE' };
  }

  // The year, not the date, so a leap-day member wished on 28 February is still
  // that year's one wish (BR-8.1). Matches `buildBirthdayWish`'s key.
  const year = deps.today.slice(0, 4);
  const key = `birthday:${member.memberId}:${year}`;
  if (await deps.store.alreadySent(key)) return { outcome: 'ALREADY_SENT' };

  await deps.store.enqueueOutbox({
    type: 'whatsapp.birthday',
    gymId: member.gymId,
    payload: { memberId: member.memberId, year },
    dedupeKey: key,
  });
  return { outcome: 'QUEUED' };
}
