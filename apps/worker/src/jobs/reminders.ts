import {
  checkReminderEligibility,
  isWithinQuietHours,
  planSlot,
  type ReminderCandidate,
  type ReminderRule,
  type SendIntent,
} from '@mfp/core';
import type { MessageLogEntry, WhatsAppSendOutcome, WhatsAppSendRequest } from '@mfp/core/ports';
import type { Clock, ISTDate, MemberStatus } from '@mfp/shared';
import { istTime, toISTDate, toISTTime } from '@mfp/shared';

/**
 * The two reminder jobs (whatsapp-automation-engine §5; BR-5.3, BR-5.4).
 *
 * `runReminderSlot` asks the database who qualifies at this slot and queues one message
 * each. `sendReminder` runs per message and checks eligibility again in the moment
 * before it sends — a member can renew, pause or unsubscribe between the two, and the
 * second check is the one that protects them (BR-5.3).
 *
 * Both are pure of infrastructure: the caller brings the clock, the repositories, the
 * queue and the provider, so a whole slot can be exercised without a database.
 */

export interface ReminderSettingsView {
  readonly automaticPaused: boolean;
  readonly quietHours: { readonly start: string; readonly end: string };
  readonly maxMessagesPerNumberPerDay: number;
}

export interface SlotResult {
  /** False when the slot was already run today, or refused for quiet hours. */
  readonly ran: boolean;
  readonly planned: number;
  readonly queued: number;
  readonly skipped: number;
}

export interface SlotDeps {
  readonly clock: Clock;
  readonly gymId: string;
  readonly settings: () => Promise<ReminderSettingsView>;
  readonly rules: () => Promise<readonly ReminderRule[]>;
  readonly candidates: (slot: string, today: ISTDate) => Promise<readonly ReminderCandidate[]>;
  readonly tokens: { renewUrl: (memberId: string) => string; unsubscribePayload: (memberId: string) => string };
  readonly enqueue: (intent: SendIntent) => Promise<void>;
  readonly messageLog: { record: (entry: MessageLogEntry) => Promise<boolean> };
  /** False when this day and slot already have a JobRun row (R15, R16). */
  readonly claimRun: (runKey: string) => Promise<boolean>;
  readonly onWarning?: (code: 'QUIET_HOURS') => void;
}

const NOTHING: SlotResult = { ran: false, planned: 0, queued: 0, skipped: 0 };

export async function runReminderSlot(input: { slot: string; today: ISTDate }, deps: SlotDeps): Promise<SlotResult> {
  const settings = await deps.settings();

  // A slot the owner has moved outside quiet hours is a misconfiguration, not a send
  // (BR-5.5): refuse it loudly rather than message members at an hour they did not agree to.
  if (!isWithinQuietHours(istTime(input.slot), { start: istTime(settings.quietHours.start), end: istTime(settings.quietHours.end) })) {
    deps.onWarning?.('QUIET_HOURS');
    return NOTHING;
  }
  if (!(await deps.claimRun(`${input.today}@${input.slot}`))) return NOTHING;
  // The kill switch stops every automatic message, but the run still counts as done.
  if (settings.automaticPaused) return { ran: true, planned: 0, queued: 0, skipped: 0 };

  const [rules, candidates] = await Promise.all([deps.rules(), deps.candidates(input.slot, input.today)]);
  const plan = planSlot(
    {
      today: input.today,
      slot: input.slot,
      rules,
      candidates,
      maxMessagesPerNumberPerDay: settings.maxMessagesPerNumberPerDay,
    },
    { tokens: deps.tokens },
  );

  for (const intent of plan.intents) await deps.enqueue(intent);
  for (const skip of plan.skipped) {
    await deps.messageLog.record({
      gymId: deps.gymId,
      memberId: skip.memberId,
      membershipId: skip.membershipId,
      direction: 'OUTBOUND',
      purpose: 'REMINDER',
      ruleCode: skip.ruleCode,
      templateName: null,
      language: null,
      toNumber: null,
      idempotencyKey: skip.idempotencyKey,
      providerMessageId: null,
      status: 'SKIPPED',
      bodyPreview: null,
      payload: null,
      errorCode: skip.reason,
      businessDate: input.today,
    });
  }

  return { ran: true, planned: plan.intents.length + plan.skipped.length, queued: plan.intents.length, skipped: plan.skipped.length };
}

/** What the member's record says at the moment of sending (BR-5.3). */
export interface SendContext {
  readonly memberStatus: MemberStatus;
  readonly whatsappOptIn: boolean;
  readonly remindersUnsubscribedAt: Date | null;
  readonly remindersPausedUntil: ISTDate | null;
  readonly hasMobile: boolean;
  readonly latestConfirmedMembershipId: string | null;
  readonly messagesToNumberToday: number;
}

export type SendResult =
  | { readonly outcome: 'SENT' | 'SIMULATED' | 'DUPLICATE' }
  | { readonly outcome: 'SKIPPED'; readonly reason: string }
  | { readonly outcome: 'FAILED'; readonly errorCode: string };

export interface SendDeps {
  readonly clock: Clock;
  readonly gymId: string;
  readonly settings: () => Promise<ReminderSettingsView>;
  readonly loadContext: (memberId: string) => Promise<SendContext>;
  readonly messageLog: {
    record: (entry: MessageLogEntry) => Promise<boolean>;
    updateByIdempotencyKey: (
      key: string,
      status: string,
      fields: { providerMessageId?: string | null; errorCode?: string | null; errorMessage?: string | null; bodyPreview?: string | null },
    ) => Promise<void>;
  };
  readonly whatsapp: { send: (request: WhatsAppSendRequest) => Promise<WhatsAppSendOutcome> };
}

/** A failure the provider may serve differently in a minute; pg-boss retries those. */
export class RetryableSendError extends Error {
  readonly errorCode: string;
  constructor(errorCode: string, message: string) {
    super(`WhatsApp send failed (${errorCode}): ${message}`);
    this.name = 'RetryableSendError';
    this.errorCode = errorCode;
  }
}

export async function sendReminder(intent: SendIntent, deps: SendDeps): Promise<SendResult> {
  const now = deps.clock.now();
  const [settings, context] = await Promise.all([deps.settings(), deps.loadContext(intent.memberId)]);
  const today = toISTDate(now);

  const check = checkReminderEligibility({
    automaticMessagesStopped: settings.automaticPaused,
    memberStatus: context.memberStatus,
    whatsappOptIn: context.whatsappOptIn,
    remindersUnsubscribedAt: context.remindersUnsubscribedAt,
    remindersPausedUntil: context.remindersPausedUntil,
    hasMobile: context.hasMobile,
    targetMembershipId: intent.membershipId,
    latestConfirmedMembershipId: context.latestConfirmedMembershipId,
    today,
    nowTime: toISTTime(now),
    quietHours: { start: istTime(settings.quietHours.start), end: istTime(settings.quietHours.end) },
    alreadySent: false,
    messagesToNumberToday: context.messagesToNumberToday,
    maxMessagesPerNumberPerDay: settings.maxMessagesPerNumberPerDay,
  });

  // The log row is written either way, so a skip is visible to the owner, and its unique
  // key is what makes a repeated job a no-op (BR-5.4).
  const inserted = await deps.messageLog.record({
    gymId: deps.gymId,
    memberId: intent.memberId,
    membershipId: intent.membershipId,
    direction: 'OUTBOUND',
    purpose: 'REMINDER',
    ruleCode: intent.ruleCode,
    templateName: intent.templateName,
    language: intent.language,
    toNumber: intent.to,
    idempotencyKey: intent.idempotencyKey,
    providerMessageId: null,
    status: check.eligible ? 'QUEUED' : 'SKIPPED',
    bodyPreview: null,
    payload: { variables: intent.variables },
    errorCode: check.eligible ? null : check.reason,
    businessDate: today,
  });
  if (!inserted) return { outcome: 'DUPLICATE' };
  if (!check.eligible) return { outcome: 'SKIPPED', reason: check.reason };

  const outcome = await deps.whatsapp.send({
    to: intent.to,
    templateName: intent.templateName,
    language: intent.language,
    variables: intent.variables,
    idempotencyKey: intent.idempotencyKey,
    buttons: [
      { payload: intent.buttons.renewUrl, label: 'renew' },
      { payload: intent.buttons.unsubscribePayload, label: 'unsubscribe' },
    ],
  });

  if (outcome.status === 'SENT') {
    await deps.messageLog.updateByIdempotencyKey(intent.idempotencyKey, 'SENT', { providerMessageId: outcome.providerMessageId, errorCode: null });
    return { outcome: 'SENT' };
  }
  if (outcome.status === 'SIMULATED') {
    await deps.messageLog.updateByIdempotencyKey(intent.idempotencyKey, 'SIMULATED', { errorCode: null, bodyPreview: outcome.bodyPreview });
    return { outcome: 'SIMULATED' };
  }
  if (outcome.status === 'SKIPPED') {
    await deps.messageLog.updateByIdempotencyKey(intent.idempotencyKey, 'SKIPPED', { errorCode: outcome.reason });
    return { outcome: 'SKIPPED', reason: outcome.reason };
  }

  await deps.messageLog.updateByIdempotencyKey(intent.idempotencyKey, 'FAILED', { errorCode: outcome.errorCode, errorMessage: outcome.errorMessage });
  if (outcome.retryable) throw new RetryableSendError(outcome.errorCode, outcome.errorMessage);
  return { outcome: 'FAILED', errorCode: outcome.errorCode };
}

