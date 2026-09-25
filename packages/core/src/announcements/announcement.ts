import type { ISTTime, Language } from '@mfp/shared';
import { domainError } from '../errors';
import { assertCan, type CrmActor } from '../crm/permissions';
import type { OutboxEventInput } from '../ports/outbox';
import { isWithinQuietHours } from '../reminders/eligibility';

/**
 * One message from the owner to every member — "kal gym band rahega" (ADR-079).
 *
 * This is the only action in the product that messages the whole register, so three
 * things are deliberate. It belongs to the owner and needs the PIN just entered, because
 * two hundred phones is not something a busy desk should be able to do by accident. It
 * counts who it cannot reach and says so, rather than quietly reaching fewer people than
 * the owner thinks. And it refuses at the two moments when sending would be a mistake:
 * while the gym has automatic messages switched off — that switch is usually flipped
 * because WhatsApp has flagged the number — and outside the hours members agreed to.
 *
 * In Meta's terms this is a *marketing* message, whatever it says, so it needs the
 * member's own WhatsApp opt-in and stops at an unsubscribe like the birthday wish does.
 */

/** A template body holds 1024 characters; the rest is the footer and the greeting. */
export const ANNOUNCEMENT_MAX_CHARS = 600;

export type AnnouncementAudience = 'ACTIVE' | 'EVERYONE';

export interface AnnouncementMember {
  readonly memberId: string;
  readonly language: Language;
  readonly whatsappOptIn: boolean;
  readonly remindersUnsubscribedAt: Date | null;
  readonly hasMobile: boolean;
}

export interface AnnouncementRecord {
  readonly gymId: string;
  readonly textEn: string;
  readonly textHi: string;
  readonly audience: AnnouncementAudience;
  readonly createdById: string;
  readonly sentAt: Date;
  readonly recipientCount: number;
}

export interface AnnouncementStore {
  /** The chosen audience as the register has it right now. */
  audience(gymId: string, audience: AnnouncementAudience): Promise<readonly AnnouncementMember[]>;
  create(record: AnnouncementRecord): Promise<string>;
  enqueueOutbox(events: readonly OutboxEventInput[]): Promise<void>;
}

export interface AnnouncementSkipped {
  readonly noOptIn: number;
  readonly unsubscribed: number;
  readonly noMobile: number;
}

export interface AnnouncementResult {
  readonly announcementId: string;
  readonly queued: number;
  readonly skipped: AnnouncementSkipped;
}

/**
 * The owner's words as one line.
 *
 * A WhatsApp template variable cannot hold a newline (the owner's alerts learned this
 * the same way), so paragraphs become sentences. The composer previews exactly this,
 * so nobody is surprised by what arrives.
 */
function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** The text a member reads, falling back rather than sending them an empty message. */
export function announcementBodyFor(text: { readonly textEn: string; readonly textHi: string }, language: Language): string {
  const preferred = (language === 'hi' ? text.textHi : text.textEn).trim();
  return preferred !== '' ? preferred : (language === 'hi' ? text.textEn : text.textHi).trim();
}

/** Why a member is not getting this one, counted so the owner sees the shortfall. */
function sortRecipients(members: readonly AnnouncementMember[]): { reachable: AnnouncementMember[]; skipped: AnnouncementSkipped } {
  const reachable: AnnouncementMember[] = [];
  let noOptIn = 0;
  let unsubscribed = 0;
  let noMobile = 0;
  for (const member of members) {
    if (!member.hasMobile) noMobile += 1;
    else if (member.remindersUnsubscribedAt !== null) unsubscribed += 1;
    else if (!member.whatsappOptIn) noOptIn += 1;
    else reachable.push(member);
  }
  return { reachable, skipped: { noOptIn, unsubscribed, noMobile } };
}

export async function sendAnnouncement(
  input: { readonly textEn: string; readonly textHi: string; readonly audience: AnnouncementAudience },
  deps: {
    readonly actor: CrmActor;
    readonly gymId: string;
    readonly now: Date;
    readonly nowIST: ISTTime;
    readonly settings: { readonly automaticPaused: boolean; readonly quietHours: { readonly start: ISTTime; readonly end: ISTTime } };
    readonly uow: { transaction: <T>(work: (store: AnnouncementStore) => Promise<T>) => Promise<T> };
  },
): Promise<AnnouncementResult> {
  // No new capability for one screen (ADR-066): messaging every member is at least as
  // consequential as changing the gym's settings, and needs the same fresh PIN.
  assertCan(deps.actor, 'settings.manage', deps.now);

  const textEn = oneLine(input.textEn);
  const textHi = oneLine(input.textHi);
  if (textEn === '' && textHi === '') throw domainError('VALIDATION_FAILED', 'An announcement needs some words', { field: 'text' });
  if (textEn.length > ANNOUNCEMENT_MAX_CHARS || textHi.length > ANNOUNCEMENT_MAX_CHARS) {
    throw domainError('VALIDATION_FAILED', `An announcement is at most ${ANNOUNCEMENT_MAX_CHARS} characters`, { field: 'text' });
  }

  if (deps.settings.automaticPaused) {
    throw domainError('CONFLICT', 'Automatic messages are switched off for this gym', { field: 'automaticPaused' });
  }
  if (!isWithinQuietHours(deps.nowIST, deps.settings.quietHours)) {
    throw domainError('QUIET_HOURS_VIOLATION', 'Outside the hours members agreed to be messaged', {
      start: deps.settings.quietHours.start,
      end: deps.settings.quietHours.end,
    });
  }

  return deps.uow.transaction(async (store) => {
    const { reachable, skipped } = sortRecipients(await store.audience(deps.gymId, input.audience));
    if (reachable.length === 0) {
      throw domainError('VALIDATION_FAILED', 'Nobody in this audience can be messaged', { field: 'audience' });
    }

    const announcementId = await store.create({
      gymId: deps.gymId,
      textEn,
      textHi,
      audience: input.audience,
      createdById: deps.actor.staffUserId,
      sentAt: deps.now,
      recipientCount: reachable.length,
    });

    // One event per member, named so a repeated dispatch cannot message anybody twice.
    // The words are not copied into the payload: the row is the one source of them.
    await store.enqueueOutbox(
      reachable.map((member) => ({
        type: 'whatsapp.announcement' as const,
        gymId: deps.gymId,
        payload: { announcementId, memberId: member.memberId },
        dedupeKey: `announcement:${announcementId}:${member.memberId}`,
      })),
    );

    return { announcementId, queued: reachable.length, skipped };
  });
}
