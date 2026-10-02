import { todayIST, type Clock, type ISTDate, type MemberStatus } from '@mfp/shared';
import type { OutboxEventInput } from '../ports/outbox';
import {
  answerFollowUpQuestion,
  followUpDue,
  needsNewPlan,
  nextFollowUpQuestion,
  type FollowUpAnswers,
  type FollowUpQuestionKey,
} from './follow-up';

/**
 * Running the monthly check (ADR-089).
 *
 * A plan is checked on once a month, once — a second open check would be two conversations
 * with one person about the same thing. A member who is no longer reachable is left alone,
 * on the same consent the reminders use.
 *
 * The point of the whole exercise is at the end: when the answers say the plan should change,
 * **a new plan is written**, carrying what the member said about the old one so the model has
 * it. A follow-up that only files answers away would be a survey pretending to be a service.
 */

export interface PlanDueFollowUp {
  readonly planId: string;
  readonly memberId: string;
  readonly gymId: string;
  readonly generatedAt: ISTDate;
  readonly lastFollowUpOn: ISTDate | null;
  /** The weight the current plan was written for, to tell whether it has moved. */
  readonly weightAtPlanGrams: number | undefined;
  readonly whatsappOptIn: boolean;
  readonly remindersUnsubscribedAt: Date | null;
  readonly memberStatus: MemberStatus;
}

export interface OpenFollowUp {
  readonly id: string;
  readonly planId: string;
  readonly memberId: string;
  readonly answers: Record<string, unknown>;
  readonly pendingQuestion: string | null;
  readonly completedAt: Date | null;
}

export interface FollowUpStore {
  /** Every READY plan, with what is needed to decide whether it is due. */
  plansDueFollowUp(gymId?: string): Promise<readonly PlanDueFollowUp[]>;
  openFollowUpFor(gymId: string, memberId: string): Promise<OpenFollowUp | null>;
  createFollowUp(input: { gymId: string; memberId: string; planId: string; pendingQuestion: string }): Promise<string>;
  saveFollowUp(
    id: string,
    patch: { answers?: Record<string, unknown>; pendingQuestion?: string | null; completedAt?: Date | null },
  ): Promise<void>;
  /** The new weight becomes the member's weight, or the next plan is written on the old one. */
  savedWeight(memberId: string, weightGrams: number): Promise<void>;
  enqueueOutbox(event: OutboxEventInput): Promise<void>;
}

export interface FollowUpUnitOfWork {
  transaction<T>(work: (store: FollowUpStore) => Promise<T>): Promise<T>;
}

export interface FollowUpDeps {
  readonly clock: Clock;
  readonly uow: FollowUpUnitOfWork;
}

function askEvent(followUpId: string, memberId: string, gymId: string, question: FollowUpQuestionKey, attempt: number): OutboxEventInput {
  return {
    type: 'whatsapp.diet_follow_up',
    gymId,
    payload: { memberId, followUpId, question, attempt },
    // The attempt is in the key for the same reason the questionnaire's is: a nudge is a
    // send we want, a duplicate is not.
    dedupeKey: `diet-follow:${followUpId}:${question}:${attempt}`,
  };
}

const ATTEMPT_KEY = '_attempt';

/** Ask everyone whose plan is a month old. Runs nightly; sends nothing when nothing is due. */
export async function startDietFollowUps(
  input: { readonly everyDays: number; readonly gymId?: string },
  deps: FollowUpDeps,
): Promise<{ readonly started: number; readonly skipped: number }> {
  const today = todayIST(deps.clock);

  return deps.uow.transaction(async (store) => {
    let started = 0;
    let skipped = 0;

    for (const plan of await store.plansDueFollowUp(input.gymId)) {
      if (!followUpDue({ generatedAt: plan.generatedAt, lastFollowUpOn: plan.lastFollowUpOn, today, everyDays: input.everyDays })) {
        skipped += 1;
        continue;
      }
      // The same consent the reminders check: a follow-up is still a message (BR-5.3).
      if (plan.memberStatus !== 'ACTIVE' || !plan.whatsappOptIn || plan.remindersUnsubscribedAt !== null) {
        skipped += 1;
        continue;
      }
      if ((await store.openFollowUpFor(plan.gymId, plan.memberId)) !== null) {
        skipped += 1;
        continue;
      }

      const id = await store.createFollowUp({ gymId: plan.gymId, memberId: plan.memberId, planId: plan.planId, pendingQuestion: 'following' });
      await store.saveFollowUp(id, { answers: { [ATTEMPT_KEY]: 1 } });
      await store.enqueueOutbox(askEvent(id, plan.memberId, plan.gymId, 'following', 1));
      started += 1;
    }

    return { started, skipped };
  });
}

export type FollowUpReplyResult =
  | { readonly outcome: 'ASKED'; readonly question: FollowUpQuestionKey }
  | { readonly outcome: 'REASKED'; readonly question: FollowUpQuestionKey }
  | { readonly outcome: 'COMPLETE'; readonly newPlan: boolean }
  | { readonly outcome: 'NOT_ASKING' };

/** How many times one follow-up question is asked before it is let go. */
const MAX_ASKS = 3;

export async function recordFollowUpReply(
  input: { readonly gymId: string; readonly memberId: string; readonly text: string },
  deps: FollowUpDeps,
): Promise<FollowUpReplyResult> {
  const now = deps.clock.now();

  return deps.uow.transaction(async (store) => {
    const open = await store.openFollowUpFor(input.gymId, input.memberId);
    const pending = open?.pendingQuestion ?? null;
    if (open === null || pending === null) return { outcome: 'NOT_ASKING' };

    const answers = open.answers as FollowUpAnswers & { [ATTEMPT_KEY]?: number };
    const parsed = answerFollowUpQuestion(pending as FollowUpQuestionKey, input.text);

    if (!parsed.ok) {
      const attempt = (answers[ATTEMPT_KEY] ?? 1) + 1;
      if (attempt > MAX_ASKS) {
        // Let it go, and close the check: a member who is not answering has answered.
        await store.saveFollowUp(open.id, { pendingQuestion: null, completedAt: now });
        return { outcome: 'COMPLETE', newPlan: false };
      }
      await store.saveFollowUp(open.id, { answers: { ...answers, [ATTEMPT_KEY]: attempt } });
      await store.enqueueOutbox(askEvent(open.id, input.memberId, input.gymId, pending as FollowUpQuestionKey, attempt));
      return { outcome: 'REASKED', question: pending as FollowUpQuestionKey };
    }

    const next: FollowUpAnswers = { ...answers, ...parsed.patch };
    const following = nextFollowUpQuestion(next);

    if (following !== null) {
      await store.saveFollowUp(open.id, { answers: { ...next, [ATTEMPT_KEY]: 1 }, pendingQuestion: following.key });
      await store.enqueueOutbox(askEvent(open.id, input.memberId, input.gymId, following.key, 1));
      return { outcome: 'ASKED', question: following.key };
    }

    await store.saveFollowUp(open.id, { answers: { ...next }, pendingQuestion: null, completedAt: now });

    // A weight they have just given is their weight now, whatever the old plan says.
    const weight = next.weightGrams;
    if (weight !== undefined && weight !== null) await store.savedWeight(input.memberId, weight);

    const plans = await store.plansDueFollowUp(input.gymId);
    const plan = plans.find((row) => row.planId === open.planId);
    // The baseline is what the current plan was written for; the new weight is in `next`.
    const newPlan = needsNewPlan(next, plan?.weightAtPlanGrams);

    if (newPlan) {
      await store.enqueueOutbox({
        type: 'diet.generate',
        gymId: input.gymId,
        // What they said about the old plan goes with it, so the model writes a different
        // one rather than the same one again.
        payload: { memberId: input.memberId, ...(next.changeWhat === undefined ? {} : { feedback: next.changeWhat }) },
        dedupeKey: `diet-generate:${input.memberId}:follow:${open.id}`,
      });
    }

    return { outcome: 'COMPLETE', newPlan };
  });
}
