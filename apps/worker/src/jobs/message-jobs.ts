import {
  announcementBodyFor,
  bmiFor,
  buildAnnouncement,
  buildBirthdayWish,
  buildReceiptMessage,
  buildVerificationApprovedMessage,
  buildMandateCancelledMessage,
  buildMandateHaltedMessage,
  buildMandateInviteMessage,
  buildTrialWelcomeMessage,
  buildWelcomeMessage,
  checkDietPlanSafety,
  confirmationText,
  dietPlanPrompt,
  dietProfileComplete,
  parseDietPlan,
  type ClaimedOutboxEvent,
  type OutboxEventInput,
  type OutboxHandlers,
  type TransactionalMessage,
} from '@mfp/core';
import type { AiTextGenerator, MessagePurpose, WhatsAppProvider } from '@mfp/core/ports';
import { DIET_QUESTION_TEXT, FOLLOW_UP_QUESTION_TEXT } from '@mfp/integrations';
import {
  PrismaAnnouncements,
  PrismaDietFollowUps,
  PrismaDietPlans,
  PrismaDietReader,
  PrismaMessageData,
  PrismaMessageLogWriter,
  PrismaMessageLogUpdates,
  dietStore,
  type PrismaClient,
} from '@mfp/db';
import { istDate, todayIST, type Clock } from '@mfp/shared';
import type { Logger } from '../logger';

/**
 * The messages a member gets because something happened (whatsapp-automation-engine §8).
 *
 * Each handler loads one row, lets the core build the words, and sends. Sending is
 * guarded twice over: the outbox dedupe key stops the event being dispatched twice, and
 * the message log's idempotency key stops a send even if it is.
 *
 * A message that cannot be built — an erased member, a voided payment — is not an
 * error: the handler logs why and finishes, so the event does not retry forever.
 */

export interface MessageJobDeps {
  readonly prisma: PrismaClient;
  readonly whatsapp: WhatsAppProvider;
  readonly log: Logger;
  readonly clock: Clock;
  readonly gymId: () => Promise<string>;
  /** "Mon–Sat 4:30 am – 10:00 pm", for the welcome message. */
  readonly hoursLine: () => Promise<string>;
  readonly unsubscribePayload: (memberId: string) => string;
  /** The model that writes diet plans; unavailable until a key is configured (ADR-089). */
  readonly ai: AiTextGenerator;
  /** The gym's name, which the diet prompt puts in front of the model. */
  readonly gymName: () => Promise<string>;
  /** Where a member reads their own plan: a signed link that lapses. */
  readonly dietPlanUrl: (memberId: string) => string;
  /** Enqueue a follow-on event from a handler, outside the original transaction. */
  readonly enqueue: (event: OutboxEventInput) => Promise<void>;
}

function memberIdOf(event: ClaimedOutboxEvent): string | null {
  const value = (event.payload as { memberId?: unknown }).memberId;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function paymentIdOf(event: ClaimedOutboxEvent): string | null {
  const value = (event.payload as { paymentId?: unknown }).paymentId;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function mandateIdOf(event: ClaimedOutboxEvent): string | null {
  const value = (event.payload as { mandateId?: unknown }).mandateId;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Send one built message, logging it first so a repeat cannot send twice.
 *
 * `memberId` is null for the messages that go to the owner rather than to a member:
 * the digest and the alerts belong to the gym, not to anybody's record.
 */
export async function sendTemplate(
  deps: MessageJobDeps,
  message: TransactionalMessage,
  to: string,
  memberId: string | null,
  membershipId: string | null,
  buttons?: ReadonlyArray<{ payload: string; label: string }>,
): Promise<void> {
  const gymId = await deps.gymId();
  const inserted = await new PrismaMessageLogWriter(deps.prisma).record({
    gymId,
    memberId,
    membershipId,
    direction: 'OUTBOUND',
    purpose: message.purpose,
    ruleCode: null,
    templateName: message.templateName,
    language: message.language,
    toNumber: to as Parameters<PrismaMessageLogWriter['record']>[0]['toNumber'],
    idempotencyKey: message.idempotencyKey,
    providerMessageId: null,
    status: 'QUEUED',
    bodyPreview: null,
    payload: { variables: message.variables },
  });
  if (!inserted) {
    deps.log.info({ key: message.idempotencyKey }, 'message already logged — not sending again');
    return;
  }

  const outcome = await deps.whatsapp.send({
    to: to as Parameters<WhatsAppProvider['send']>[0]['to'],
    templateName: message.templateName,
    language: message.language,
    variables: message.variables,
    idempotencyKey: message.idempotencyKey,
    ...(buttons === undefined ? {} : { buttons: [...buttons] }),
  });

  const updates = new PrismaMessageLogUpdates(deps.prisma);
  if (outcome.status === 'SENT') await updates.updateByIdempotencyKey(message.idempotencyKey, 'SENT', { providerMessageId: outcome.providerMessageId });
  else if (outcome.status === 'SIMULATED') await updates.updateByIdempotencyKey(message.idempotencyKey, 'SIMULATED', { bodyPreview: outcome.bodyPreview });
  else if (outcome.status === 'FAILED') {
    await updates.updateByIdempotencyKey(message.idempotencyKey, 'FAILED', { errorCode: outcome.errorCode, errorMessage: outcome.errorMessage });
    // Retryable failures go back to the outbox, which has its own backoff.
    if (outcome.retryable) throw new Error(`WhatsApp send failed (${outcome.errorCode})`);
  } else await updates.updateByIdempotencyKey(message.idempotencyKey, 'SKIPPED', { errorCode: outcome.reason });
}

/** A free-form confirmation, inside the window the member's own tap opened (BR-6.3). */
async function sendConfirmation(deps: MessageJobDeps, event: ClaimedOutboxEvent, kind: 'UNSUBSCRIBED' | 'RESTARTED'): Promise<void> {
  const memberId = memberIdOf(event);
  if (memberId === null) return;
  const member = await new PrismaMessageData(deps.prisma).member(memberId);
  if (member === null) return;

  const purpose: MessagePurpose = kind === 'UNSUBSCRIBED' ? 'UNSUBSCRIBE_CONFIRM' : 'RESTART_CONFIRM';
  const outcome = await deps.whatsapp.sendText({
    to: member.mobile,
    body: confirmationText(kind, member.language),
    idempotencyKey: event.dedupeKey,
    purpose,
    memberId,
  });
  deps.log.info({ key: event.dedupeKey, outcome: outcome.status }, 'confirmation handled');
}

export function messageOutboxHandlers(deps: MessageJobDeps): OutboxHandlers {
  const data = () => new PrismaMessageData(deps.prisma);

  return {
    'whatsapp.receipt': async (event) => {
      const paymentId = paymentIdOf(event);
      if (paymentId === null) return;
      const receipt = await data().receipt(paymentId);
      if (receipt === null) {
        deps.log.info({ paymentId }, 'no receipt to send (not paid, voided, or the member is gone)');
        return;
      }

      // What the member paid for, in words: months for a plan, days for a trial (ADR-088).
      const hindi = receipt.language === 'hi';
      const planLabel = receipt.isTrial
        ? hindi
          ? `${receipt.trialDays ?? 0} दिन का ट्रायल`
          : `${receipt.trialDays ?? 0}-day trial`
        : receipt.durationMonths === 1
          ? hindi
            ? '1 महीना'
            : '1 month'
          : hindi
            ? `${receipt.durationMonths} महीने`
            : `${receipt.durationMonths} months`;
      await sendTemplate(
        deps,
        buildReceiptMessage({ paymentId, firstName: receipt.firstName, language: receipt.language, amountPaise: receipt.amountPaise, planLabel, startDate: receipt.startDate, endDate: receipt.endDate, receiptNo: receipt.receiptNo }),
        receipt.mobile,
        receipt.memberId,
        receipt.membershipId,
      );

      // BR: the welcome follows the first receipt, and only the first.
      if (await data().isFirstMembership(receipt.memberId, receipt.membershipId)) {
        // A trial member gets the trial's own welcome: they have not joined, so there is
        // no member code to quote at them (ADR-088).
        if (receipt.isTrial) {
          await sendTemplate(
            deps,
            buildTrialWelcomeMessage({
              memberId: receipt.memberId,
              firstName: receipt.firstName,
              language: receipt.language,
              days: receipt.trialDays ?? 0,
              startDate: receipt.startDate,
              endDate: receipt.endDate,
            }),
            receipt.mobile,
            receipt.memberId,
            receipt.membershipId,
          );
          return;
        }
        const member = await data().member(receipt.memberId);
        if (member?.memberCode != null) {
          await sendTemplate(deps, buildWelcomeMessage({ memberId: member.memberId, firstName: member.firstName, language: member.language, memberCode: member.memberCode, hoursLine: await deps.hoursLine() }), member.mobile, member.memberId, receipt.membershipId);
        }
      }
    },

    'whatsapp.welcome': async (event) => {
      const memberId = memberIdOf(event);
      if (memberId === null) return;
      const member = await data().member(memberId);
      if (member?.memberCode == null) return;
      await sendTemplate(deps, buildWelcomeMessage({ memberId, firstName: member.firstName, language: member.language, memberCode: member.memberCode, hoursLine: await deps.hoursLine() }), member.mobile, memberId, null);
    },

    'whatsapp.verification_approved': async (event) => {
      const memberId = memberIdOf(event);
      if (memberId === null) return;
      const member = await data().member(memberId);
      if (member === null || member.endDate === null) return;
      // The dedupe key already names the approval; reuse it as the message's key.
      const verificationId = event.dedupeKey.split(':')[1] ?? memberId;
      await sendTemplate(
        deps,
        buildVerificationApprovedMessage({ verificationId, firstName: member.firstName, language: member.language, endDate: member.endDate }),
        member.mobile,
        memberId,
        null,
        [{ payload: deps.unsubscribePayload(memberId), label: 'unsubscribe' }],
      );
    },

    'whatsapp.birthday': async (event) => {
      const memberId = memberIdOf(event);
      if (memberId === null) return;
      const member = await data().member(memberId);
      if (member === null) return;
      // The year comes from the event, not from today: a wish queued at 11:58 pm on
      // 31 December must still be that year's wish when the worker picks it up.
      const year = (event.payload as { year?: unknown }).year;
      const today = typeof year === 'string' ? istDate(`${year}-01-01`) : todayIST(deps.clock);
      await sendTemplate(deps, buildBirthdayWish({ memberId, firstName: member.firstName, language: member.language, today }), member.mobile, memberId, null);
    },

    /**
     * The owner's announcement, one member at a time (ADR-079).
     *
     * Eligibility is checked again here, not only when the owner pressed send: a member
     * can unsubscribe in the seconds between, and a marketing message to somebody who
     * just opted out is the one that costs the gym its number.
     */
    'whatsapp.announcement': async (event) => {
      const memberId = memberIdOf(event);
      const payload = event.payload as { announcementId?: unknown };
      const announcementId = typeof payload.announcementId === 'string' ? payload.announcementId : null;
      if (memberId === null || announcementId === null) return;

      const found = await new PrismaAnnouncements(deps.prisma).forMember(announcementId, memberId);
      if (found === null || found.member === null) return;
      if (!found.stillEligible) {
        deps.log.info({ announcementId }, 'member is no longer reachable — announcement not sent');
        return;
      }

      const message = announcementBodyFor(found, found.member.language);
      if (message === '') return;
      await sendTemplate(
        deps,
        buildAnnouncement({ announcementId, memberId, firstName: found.member.firstName, language: found.member.language, message }),
        found.member.mobile,
        memberId,
        null,
        [{ payload: deps.unsubscribePayload(memberId), label: 'unsubscribe' }],
      );
    },

    /**
     * One question from the diet questionnaire (ADR-089).
     *
     * The question the event names, not whatever the profile says now: if the member has
     * since answered and moved on, the event is stale and sending it would ask something
     * twice. The attempt number is in the key, so a nudge is allowed through where a
     * duplicate is not.
     */
    'whatsapp.diet_question': async (event) => {
      const memberId = memberIdOf(event);
      const payload = event.payload as { question?: unknown; attempt?: unknown };
      const question = typeof payload.question === 'string' ? payload.question : null;
      const attempt = typeof payload.attempt === 'number' ? payload.attempt : 1;
      if (memberId === null || question === null) return;

      const store = dietStore(deps.prisma);
      const [member, profile] = await Promise.all([store.memberForDiet(await deps.gymId(), memberId), store.loadProfile(await deps.gymId(), memberId)]);
      if (member === null) return;
      if (profile?.pendingQuestion !== question) {
        deps.log.info({ memberId, question }, 'the member has moved on from that diet question — not asking again');
        return;
      }

      const text = DIET_QUESTION_TEXT[question]?.[member.language];
      if (text === undefined) {
        deps.log.warn({ question }, 'no wording for that diet question');
        return;
      }
      await sendTemplate(
        deps,
        {
          templateName: 'mf_diet_question',
          language: member.language,
          idempotencyKey: `diet-ask:${memberId}:${question}:${attempt}`,
          purpose: 'DIET',
          variables: { firstName: member.fullName.trim().split(/\s+/)[0] ?? member.fullName, question: text },
        },
        (await new PrismaDietReader(deps.prisma).forGeneration(await deps.gymId(), memberId))?.member.mobile ?? '',
        memberId,
        null,
      );
    },

    /**
     * Write the plan (ADR-089).
     *
     * The row is created before the model is called, so a batch in progress is visible in
     * the CRM. A refusal, an unreadable answer or a plan that fails the safety checks all
     * end as `FAILED` with a code — never as a plan the member can see.
     */
    'diet.generate': async (event) => {
      const memberId = memberIdOf(event);
      if (memberId === null) return;
      const gymId = await deps.gymId();

      const reader = new PrismaDietReader(deps.prisma);
      const found = await reader.forGeneration(gymId, memberId);
      if (found === null) return;
      if (!dietProfileComplete(found.answers)) {
        deps.log.info({ memberId }, 'diet answers are not complete — nothing to generate');
        return;
      }

      const plans = new PrismaDietPlans(deps.prisma);
      const bmi = bmiFor(found.answers);
      const started = await plans.start({
        gymId,
        memberId,
        answers: found.answers,
        bmiTenths: bmi === null ? null : Math.round(bmi * 10),
        requestedById: null,
      });

      if (!deps.ai.available) {
        await plans.markFailed(started.id, 'NO_AI_KEY');
        deps.log.warn({ memberId }, 'no AI key configured — diet plan not generated');
        return;
      }

      // What the member said at the last check goes with it, so a rewrite is a different
      // plan rather than the same one again (ADR-089).
      const feedback = (event.payload as { feedback?: unknown }).feedback;
      const prompt = dietPlanPrompt({
        firstName: found.member.firstName,
        gender: found.member.gender,
        language: found.member.language,
        gymName: await deps.gymName(),
        answers: found.answers,
        bmi,
        ...(typeof feedback === 'string' && feedback.trim() !== '' ? { feedback } : {}),
      });

      let answer: { text: string; model: string };
      try {
        answer = await deps.ai.generate({ system: prompt.system, user: prompt.user, maxTokens: 2_500 });
      } catch (error) {
        const code = error instanceof Error ? (error.message.split(':')[0] ?? 'AI_FAILED') : 'AI_FAILED';
        await plans.markFailed(started.id, code);
        deps.log.warn({ memberId, code }, 'the model did not produce a diet plan');
        return;
      }

      const parsed = parseDietPlan(answer.text);
      if (!parsed.ok) {
        await plans.markFailed(started.id, 'NOT_THE_SHAPE');
        return;
      }
      const safety = checkDietPlanSafety(parsed.plan, found.answers);
      if (!safety.ok) {
        await plans.markFailed(started.id, safety.reason);
        deps.log.warn({ memberId, reason: safety.reason }, 'diet plan refused by the safety checks');
        return;
      }

      await plans.markReady(started.id, { doc: parsed.plan, model: answer.model, at: deps.clock.now() });
      await deps.enqueue({
        type: 'whatsapp.diet_plan',
        gymId,
        payload: { memberId, planId: started.id },
        dedupeKey: `diet-plan:${started.id}`,
      });
    },

    /** Tell the member it is ready, with a link to it. */
    'whatsapp.diet_plan': async (event) => {
      const memberId = memberIdOf(event);
      const planId = typeof (event.payload as { planId?: unknown }).planId === 'string' ? (event.payload as { planId: string }).planId : null;
      if (memberId === null || planId === null) return;
      const gymId = await deps.gymId();

      const reader = new PrismaDietReader(deps.prisma);
      const [found, plan] = await Promise.all([reader.forGeneration(gymId, memberId), new PrismaDietPlans(deps.prisma).latest(gymId, memberId)]);
      if (found === null || plan === null || plan.id !== planId || plan.status !== 'READY' || plan.doc === null) return;

      const doc = plan.doc as { caloriesPerDay?: number; meals?: unknown[] };
      await sendTemplate(
        deps,
        {
          templateName: 'mf_diet_plan_ready',
          language: found.member.language,
          idempotencyKey: `diet-plan:${planId}`,
          purpose: 'DIET',
          variables: {
            firstName: found.member.firstName,
            calories: String(doc.caloriesPerDay ?? ''),
            meals: String((doc.meals ?? []).length),
            link: deps.dietPlanUrl(memberId),
          },
        },
        found.member.mobile,
        memberId,
        null,
      );
      await new PrismaDietPlans(deps.prisma).markSent(planId, deps.clock.now());
    },

    /**
     * This month's question about their plan (ADR-089).
     *
     * Checked against the open follow-up, like the questionnaire is against the profile, so
     * a stale event cannot ask something already answered.
     */
    'whatsapp.diet_follow_up': async (event) => {
      const memberId = memberIdOf(event);
      const payload = event.payload as { followUpId?: unknown; question?: unknown; attempt?: unknown };
      const followUpId = typeof payload.followUpId === 'string' ? payload.followUpId : null;
      const question = typeof payload.question === 'string' ? payload.question : null;
      const attempt = typeof payload.attempt === 'number' ? payload.attempt : 1;
      if (memberId === null || followUpId === null || question === null) return;
      const gymId = await deps.gymId();

      const follows = new PrismaDietFollowUps(deps.prisma);
      const open = await follows.transaction((store) => store.openFollowUpFor(gymId, memberId));
      if (open === null || open.id !== followUpId || open.pendingQuestion !== question) {
        deps.log.info({ memberId, question }, 'the member has moved on from that follow-up question');
        return;
      }

      const found = await new PrismaDietReader(deps.prisma).forGeneration(gymId, memberId);
      if (found === null) return;
      const text = FOLLOW_UP_QUESTION_TEXT[question]?.[found.member.language];
      if (text === undefined) {
        deps.log.warn({ question }, 'no wording for that follow-up question');
        return;
      }

      await sendTemplate(
        deps,
        {
          templateName: 'mf_diet_follow_up',
          language: found.member.language,
          idempotencyKey: `diet-follow:${followUpId}:${question}:${attempt}`,
          purpose: 'DIET',
          variables: { firstName: found.member.firstName, question: text },
        },
        found.member.mobile,
        memberId,
        null,
      );
    },

    'whatsapp.unsubscribe_confirm': (event) => sendConfirmation(deps, event, 'UNSUBSCRIBED'),
    'whatsapp.restart_confirm': (event) => sendConfirmation(deps, event, 'RESTARTED'),

    // Autopay (ADR-105). All three read the mandate rather than the event payload, so a
    // mandate the desk removed — or a member erased under DPDP — produces no message about
    // something that no longer exists.
    'whatsapp.mandate_invite': async (event) => {
      const mandateId = mandateIdOf(event);
      if (mandateId === null) return;
      const mandate = await data().mandate(mandateId);
      // Without a link there is nothing for the member to tap, and without a first-charge
      // date the message cannot say when the money goes. Both come from Razorpay, and a
      // mandate missing either is one to look at rather than to send.
      if (mandate === null || mandate.shortUrl === null || mandate.nextChargeOn === null) {
        deps.log.info({ mandateId }, 'no autopay invitation to send (mandate gone, or no link yet)');
        return;
      }
      await sendTemplate(
        deps,
        buildMandateInviteMessage({
          mandateId: mandate.mandateId,
          firstName: mandate.firstName,
          language: mandate.language,
          amountPaise: mandate.amountPaise,
          firstChargeDate: mandate.nextChargeOn,
          link: mandate.shortUrl,
        }),
        mandate.mobile,
        mandate.memberId,
        null,
      );
    },

    'whatsapp.mandate_halted': async (event) => {
      const mandateId = mandateIdOf(event);
      if (mandateId === null) return;
      const mandate = await data().mandate(mandateId);
      if (mandate === null) return;
      await sendTemplate(
        deps,
        buildMandateHaltedMessage({ mandateId: mandate.mandateId, firstName: mandate.firstName, language: mandate.language }),
        mandate.mobile,
        mandate.memberId,
        null,
      );
    },

    'whatsapp.mandate_cancelled': async (event) => {
      const mandateId = mandateIdOf(event);
      if (mandateId === null) return;
      const mandate = await data().mandate(mandateId);
      if (mandate === null) return;
      await sendTemplate(
        deps,
        buildMandateCancelledMessage({ mandateId: mandate.mandateId, firstName: mandate.firstName, language: mandate.language }),
        mandate.mobile,
        mandate.memberId,
        null,
      );
    },
  };
}
