import { todayIST, type Clock, type Gender, type ISTDate, type Language, type MemberStatus } from '@mfp/shared';
import type { OutboxEventInput } from '../ports/outbox';
import { assertCan, type CrmActor } from '../crm/permissions';
import { answerDietQuestion, nextDietQuestion, type DietAnswers, type DietQuestionKey } from './questionnaire';

/**
 * Collecting a member's answers over WhatsApp (ADR-089).
 *
 * The owner picks members in the CRM and this asks them, one question per message, and
 * remembers which question each person is on — that memory is also how an incoming message
 * is recognised as an answer rather than a stray "what time do you open?".
 *
 * Three rules it will not bend. **Nobody is messaged who has not agreed to be messaged**,
 * which is the same consent the reminders respect, checked here rather than trusted to the
 * caller. **An unreadable reply is asked again, never skipped**, because a missing weight
 * is better than a wrong one. And after three tries it **gives up** — a member who is not
 * answering is not going to start, and the gym's WhatsApp number pays for the nagging.
 */

export const DIET_SKIP_REASONS = ['MEMBER_NOT_ACTIVE', 'NOT_OPTED_IN', 'UNSUBSCRIBED', 'NO_MEMBER', 'ALREADY_ASKING'] as const;
export type DietSkipReason = (typeof DIET_SKIP_REASONS)[number];

/** How many times one question is asked before it is let go. */
export const DIET_MAX_ASKS = 3;

export interface DietMemberRecord {
  readonly id: string;
  readonly gymId: string;
  readonly fullName: string;
  readonly language: Language;
  readonly gender: Gender;
  readonly status: MemberStatus;
  readonly whatsappOptIn: boolean;
  readonly remindersUnsubscribedAt: Date | null;
  readonly dob: ISTDate | null;
}

export interface DietProfileRecord extends DietAnswers {
  readonly memberId: string;
  readonly pendingQuestion: DietQuestionKey | null;
  /** How many times the pending question has been sent. */
  readonly nudgesSent: number;
  readonly completedAt: Date | null;
}

export interface DietStore {
  memberForDiet(gymId: string, memberId: string): Promise<DietMemberRecord | null>;
  loadProfile(gymId: string, memberId: string): Promise<DietProfileRecord | null>;
  saveProfile(gymId: string, memberId: string, patch: Partial<DietProfileRecord>): Promise<void>;
  enqueueOutbox(event: OutboxEventInput): Promise<void>;
}

export interface DietUnitOfWork {
  transaction<T>(work: (store: DietStore) => Promise<T>): Promise<T>;
}

export interface DietDeps {
  readonly actor: CrmActor;
  readonly clock: Clock;
  readonly uow: DietUnitOfWork;
}

export interface StartDietResult {
  readonly started: readonly string[];
  readonly skipped: ReadonlyArray<{ readonly memberId: string; readonly reason: DietSkipReason }>;
}

/** Years completed on a date — the same arithmetic a birthday uses. */
function ageOn(dob: ISTDate, today: ISTDate): number {
  const years = Number(today.slice(0, 4)) - Number(dob.slice(0, 4));
  const hadBirthday = today.slice(5) >= dob.slice(5);
  return hadBirthday ? years : years - 1;
}

function askEvent(member: DietMemberRecord, question: DietQuestionKey, attempt: number): OutboxEventInput {
  return {
    type: 'whatsapp.diet_question',
    gymId: member.gymId,
    payload: { memberId: member.id, question, attempt },
    // The attempt is in the key: asking the same question twice is the point of a nudge,
    // so it must not be deduped away as a message already sent.
    dedupeKey: `diet-ask:${member.id}:${question}:${attempt}`,
  };
}

/**
 * Ask these members for what a plan needs.
 *
 * Returns what happened for every member, rather than throwing on the first awkward one:
 * the CRM is sending twenty of these at a time and the owner needs to see which ones did
 * not go, and why.
 */
export async function startDietPlans(input: { readonly memberIds: readonly string[] }, deps: DietDeps): Promise<StartDietResult> {
  const now = deps.clock.now();
  assertCan(deps.actor, 'diet.manage', now);
  const today = todayIST(deps.clock);

  return deps.uow.transaction(async (store) => {
    const started: string[] = [];
    const skipped: Array<{ memberId: string; reason: DietSkipReason }> = [];

    for (const memberId of input.memberIds) {
      const member = await store.memberForDiet(deps.actor.gymId, memberId);
      if (member === null) {
        skipped.push({ memberId, reason: 'NO_MEMBER' });
        continue;
      }
      // The same consent the reminders check (BR-5.3): a diet plan is still a message.
      if (member.status !== 'ACTIVE') {
        skipped.push({ memberId, reason: 'MEMBER_NOT_ACTIVE' });
        continue;
      }
      if (!member.whatsappOptIn) {
        skipped.push({ memberId, reason: 'NOT_OPTED_IN' });
        continue;
      }
      if (member.remindersUnsubscribedAt !== null) {
        skipped.push({ memberId, reason: 'UNSUBSCRIBED' });
        continue;
      }

      const profile = await store.loadProfile(deps.actor.gymId, memberId);
      if (profile?.pendingQuestion != null) {
        skipped.push({ memberId, reason: 'ALREADY_ASKING' });
        continue;
      }

      // Whatever the CRM already knows is not asked again (the client's own instruction).
      const known: Partial<DietProfileRecord> = {
        ...(profile ?? {}),
        ...(member.dob === null ? {} : { ageYears: ageOn(member.dob, today) }),
      };
      const question = nextDietQuestion(known);
      if (question === null) {
        // Everything is known already: go straight to writing the plan.
        await store.saveProfile(deps.actor.gymId, memberId, { ...known, pendingQuestion: null, nudgesSent: 0, completedAt: now });
        await store.enqueueOutbox({
          type: 'diet.generate',
          gymId: member.gymId,
          payload: { memberId },
          dedupeKey: `diet-generate:${memberId}:1`,
        });
        started.push(memberId);
        continue;
      }

      await store.saveProfile(deps.actor.gymId, memberId, { ...known, pendingQuestion: question.key, nudgesSent: 1, askedAt: now } as Partial<DietProfileRecord>);
      await store.enqueueOutbox(askEvent(member, question.key, 1));
      started.push(memberId);
    }

    return { started, skipped };
  });
}

export type DietReplyResult =
  | { readonly outcome: 'ASKED'; readonly question: DietQuestionKey }
  | { readonly outcome: 'REASKED'; readonly question: DietQuestionKey }
  | { readonly outcome: 'GAVE_UP'; readonly question: DietQuestionKey }
  | { readonly outcome: 'COMPLETE' }
  | { readonly outcome: 'NOT_ASKING' };

/**
 * One reply from a member.
 *
 * No permission check: this is the member answering their own question, arriving from the
 * WhatsApp webhook, and there is no staff actor involved. What protects it is that nothing
 * happens unless we are already waiting on that member for that question.
 */
export async function recordDietReply(
  input: { readonly memberId: string; readonly text: string },
  deps: { readonly clock: Clock; readonly uow: DietUnitOfWork; readonly gymId?: string; readonly actor?: CrmActor },
): Promise<DietReplyResult> {
  const now = deps.clock.now();
  const gymId = deps.gymId ?? deps.actor?.gymId ?? '';

  return deps.uow.transaction(async (store) => {
    const profile = await store.loadProfile(gymId, input.memberId);
    const pending = profile?.pendingQuestion ?? null;
    if (profile === null || pending === null) return { outcome: 'NOT_ASKING' };

    const member = await store.memberForDiet(gymId, input.memberId);
    if (member === null) return { outcome: 'NOT_ASKING' };

    const parsed = answerDietQuestion(pending, input.text);
    if (!parsed.ok) {
      const attempt = profile.nudgesSent + 1;
      if (attempt > DIET_MAX_ASKS) {
        // Let it go. A person can pick this up from the CRM; the member is not nagged.
        await store.saveProfile(gymId, input.memberId, { pendingQuestion: null, lastReplyAt: now } as Partial<DietProfileRecord>);
        return { outcome: 'GAVE_UP', question: pending };
      }
      await store.saveProfile(gymId, input.memberId, { nudgesSent: attempt, lastReplyAt: now } as Partial<DietProfileRecord>);
      await store.enqueueOutbox(askEvent(member, pending, attempt));
      return { outcome: 'REASKED', question: pending };
    }

    const answers: Partial<DietProfileRecord> = { ...profile, ...parsed.patch };
    const next = nextDietQuestion(answers);
    if (next === null) {
      await store.saveProfile(gymId, input.memberId, { ...parsed.patch, pendingQuestion: null, nudgesSent: 0, completedAt: now, lastReplyAt: now } as Partial<DietProfileRecord>);
      await store.enqueueOutbox({
        type: 'diet.generate',
        gymId: member.gymId,
        payload: { memberId: input.memberId },
        dedupeKey: `diet-generate:${input.memberId}:1`,
      });
      return { outcome: 'COMPLETE' };
    }

    await store.saveProfile(gymId, input.memberId, { ...parsed.patch, pendingQuestion: next.key, nudgesSent: 1, lastReplyAt: now } as Partial<DietProfileRecord>);
    await store.enqueueOutbox(askEvent(member, next.key, 1));
    return { outcome: 'ASKED', question: next.key };
  });
}
