import { formatINR, formatISTDate, type ISTDate, type Language, type WhatsAppTemplateName } from '@mfp/shared';
import type { MessagePurpose } from '../ports/message-log';

/**
 * The messages a member gets because something happened (whatsapp-automation-engine §8).
 *
 * A receipt, a welcome, a confirmed QR submission: each is built here from what the
 * database already holds, so the worker only has to load rows and send. Every one
 * carries the key that makes a repeated outbox dispatch a no-op (CLAUDE.md §2.5), and
 * every one is written in the member's own language.
 */

export interface TransactionalMessage {
  readonly templateName: WhatsAppTemplateName;
  readonly language: Language;
  readonly idempotencyKey: string;
  readonly purpose: MessagePurpose;
  readonly variables: Readonly<Record<string, string>>;
}

export function buildReceiptMessage(input: {
  paymentId: string;
  firstName: string;
  language: Language;
  amountPaise: number;
  planLabel: string;
  startDate: ISTDate;
  endDate: ISTDate;
  receiptNo: string;
}): TransactionalMessage {
  return {
    templateName: 'mf_payment_receipt',
    language: input.language,
    // The same key the payment's outbox event uses, so one payment is one receipt.
    idempotencyKey: `receipt:${input.paymentId}`,
    purpose: 'RECEIPT',
    variables: {
      firstName: input.firstName,
      amount: formatINR(input.amountPaise, { showPaise: false }),
      planName: input.planLabel,
      startDate: formatISTDate(input.startDate, input.language),
      endDate: formatISTDate(input.endDate, input.language),
      receiptNo: input.receiptNo,
    },
  };
}

export function buildWelcomeMessage(input: { memberId: string; firstName: string; language: Language; memberCode: string; hoursLine: string }): TransactionalMessage {
  return {
    templateName: 'mf_welcome_member',
    language: input.language,
    idempotencyKey: `welcome:${input.memberId}`,
    purpose: 'WELCOME',
    variables: { firstName: input.firstName, memberCode: input.memberCode, hours: input.hoursLine },
  };
}

/**
 * The first message a trial member gets (ADR-088).
 *
 * Not the member welcome: they have not joined, so there is no member code to give them,
 * and quoting one would be wrong twice over. What they need is the two dates and what to
 * do when they walk in.
 */
export function buildTrialWelcomeMessage(input: {
  memberId: string;
  firstName: string;
  language: Language;
  days: number;
  startDate: ISTDate;
  endDate: ISTDate;
}): TransactionalMessage {
  const days =
    input.language === 'hi' ? `${input.days} दिन` : input.days === 1 ? '1 day' : `${input.days} days`;
  return {
    templateName: 'mf_trial_welcome',
    language: input.language,
    idempotencyKey: `trial-welcome:${input.memberId}`,
    purpose: 'WELCOME',
    variables: {
      firstName: input.firstName,
      days,
      startDate: formatISTDate(input.startDate, input.language),
      endDate: formatISTDate(input.endDate, input.language),
    },
  };
}

export function buildVerificationApprovedMessage(input: { verificationId: string; firstName: string; language: Language; endDate: ISTDate }): TransactionalMessage {
  return {
    templateName: 'mf_verification_approved',
    language: input.language,
    // Matches the key `approveVerification` enqueues, so one approval is one message.
    idempotencyKey: `verification-approved:${input.verificationId}`,
    purpose: 'VERIFICATION',
    variables: { firstName: input.firstName, endDate: formatISTDate(input.endDate, input.language) },
  };
}

/**
 * The free-form confirmations (BR-6.3).
 *
 * These are not templates: WhatsApp allows plain text inside the service window the
 * member's own tap opens, and a short sentence in their language reads better than an
 * approved template would.
 */
export function confirmationText(kind: 'UNSUBSCRIBED' | 'RESTARTED', language: Language): string {
  if (kind === 'UNSUBSCRIBED') {
    return language === 'hi'
      ? 'आपके रिमाइंडर बंद कर दिए गए हैं। अब आपको मेंबरशिप के रिमाइंडर नहीं आएंगे। गलती से हुआ हो तो "चालू" लिखकर भेजें।'
      : 'Your reminders are stopped. You will not get membership reminders from now on. If this was a mistake, reply Restart.';
  }
  return language === 'hi'
    ? 'आपके रिमाइंडर फिर से चालू कर दिए गए हैं। फीस खत्म होने से पहले हम आपको याद दिला देंगे।'
    : 'Done — your reminders are on again. We will remind you before your fees run out.';
}

/**
 * T20–T22 — autopay (ADR-105).
 *
 * The invitation carries the link because Razorpay issues a fresh one per mandate, and the
 * amount and first-debit date because a member asked to authorise a standing instruction is
 * entitled to see both before they tap.
 *
 * All three are keyed on the mandate, not the member: Razorpay re-delivers freely, and a
 * member told twice that their autopay has stopped would reasonably think it stopped twice.
 */
export function buildMandateInviteMessage(input: {
  mandateId: string;
  firstName: string;
  language: Language;
  amountPaise: number;
  firstChargeDate: ISTDate;
  link: string;
}): TransactionalMessage {
  return {
    templateName: 'mf_autopay_invite',
    language: input.language,
    idempotencyKey: `mandate-invite:${input.mandateId}`,
    purpose: 'AUTOPAY',
    variables: {
      firstName: input.firstName,
      amount: formatINR(input.amountPaise, { showPaise: false }),
      firstChargeDate: formatISTDate(input.firstChargeDate, input.language),
      link: input.link,
    },
  };
}

export function buildMandateHaltedMessage(input: { mandateId: string; firstName: string; language: Language }): TransactionalMessage {
  return {
    templateName: 'mf_autopay_halted',
    language: input.language,
    idempotencyKey: `mandate-halted:${input.mandateId}`,
    purpose: 'AUTOPAY',
    variables: { firstName: input.firstName },
  };
}

export function buildMandateCancelledMessage(input: { mandateId: string; firstName: string; language: Language }): TransactionalMessage {
  return {
    templateName: 'mf_autopay_cancelled',
    language: input.language,
    idempotencyKey: `mandate-cancelled:${input.mandateId}`,
    purpose: 'AUTOPAY',
    variables: { firstName: input.firstName },
  };
}
