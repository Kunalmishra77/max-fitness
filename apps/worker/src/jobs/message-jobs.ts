import {
  buildReceiptMessage,
  buildVerificationApprovedMessage,
  buildWelcomeMessage,
  confirmationText,
  type ClaimedOutboxEvent,
  type OutboxHandlers,
  type TransactionalMessage,
} from '@mfp/core';
import type { MessagePurpose, WhatsAppProvider } from '@mfp/core/ports';
import { PrismaMessageData, PrismaMessageLogWriter, PrismaMessageLogUpdates, type PrismaClient } from '@mfp/db';
import type { Language } from '@mfp/shared';
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
  readonly gymId: () => Promise<string>;
  /** "Mon–Sat 4:30 am – 10:00 pm", for the welcome message. */
  readonly hoursLine: () => Promise<string>;
  readonly unsubscribePayload: (memberId: string) => string;
}

function memberIdOf(event: ClaimedOutboxEvent): string | null {
  const value = (event.payload as { memberId?: unknown }).memberId;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function paymentIdOf(event: ClaimedOutboxEvent): string | null {
  const value = (event.payload as { paymentId?: unknown }).paymentId;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Send one built message, logging it first so a repeat cannot send twice. */
async function sendTemplate(
  deps: MessageJobDeps,
  message: TransactionalMessage,
  to: string,
  memberId: string,
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
    body: confirmationText(kind, member.language as Language),
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

      const planLabel = receipt.durationMonths === 1 ? (receipt.language === 'hi' ? '1 महीना' : '1 month') : receipt.language === 'hi' ? `${receipt.durationMonths} महीने` : `${receipt.durationMonths} months`;
      await sendTemplate(
        deps,
        buildReceiptMessage({ paymentId, firstName: receipt.firstName, language: receipt.language, amountPaise: receipt.amountPaise, planLabel, startDate: receipt.startDate, endDate: receipt.endDate, receiptNo: receipt.receiptNo }),
        receipt.mobile,
        receipt.memberId,
        receipt.membershipId,
      );

      // BR: the welcome follows the first receipt, and only the first.
      if (await data().isFirstMembership(receipt.memberId, receipt.membershipId)) {
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

    'whatsapp.unsubscribe_confirm': (event) => sendConfirmation(deps, event, 'UNSUBSCRIBED'),
    'whatsapp.restart_confirm': (event) => sendConfirmation(deps, event, 'RESTARTED'),
  };
}
