import type { PgBoss } from 'pg-boss';
import type { SendIntent, TransactionalMessage } from '@mfp/core';
import { GymSettingsSchema, todayIST, type Clock, type ISTDate } from '@mfp/shared';
import type { WhatsAppProvider } from '@mfp/core/ports';
import {
  PrismaJobRuns,
  PrismaOwnerAlertQueue,
  PrismaOwnerData,
  PrismaMessageLogUpdates,
  PrismaMessageLogWriter,
  PrismaReminderCandidates,
  PrismaReminderRules,
  PrismaSendContext,
  type PrismaClient,
} from '@mfp/db';
import type { Logger } from '../logger';
import { reminderQueueName } from '../schedules';
import { sendTemplate, type MessageJobDeps } from './message-jobs';
import { runOwnerAlerts, runOwnerDigest } from './owner';
import { RetryableSendError, runReminderSlot, sendReminder, type SendContext } from './reminders';

/**
 * Phase 6 wiring: the reminder slots and the send queue (whatsapp-automation-engine §4–5).
 *
 * The slot crons are registered from the gym's own `ReminderRule` rows, so changing a
 * slot time in Settings changes what the worker runs after a restart. Each slot claims a
 * `JobRun` row first, which is what makes a repeated cron fire — or a catch-up after
 * downtime — a no-op rather than a second round of messages (R15, R16).
 */

export const WHATSAPP_SEND_QUEUE = 'whatsapp-send';
const RUN_JOB_NAME = 'reminder-slot';
const DIGEST_JOB_NAME = 'owner-digest';

export interface Phase6Deps {
  readonly boss: Pick<PgBoss, 'send' | 'work' | 'createQueue' | 'schedule'>;
  readonly prisma: PrismaClient;
  readonly clock: Clock;
  readonly log: Logger;
  readonly gymSlug: string;
  readonly whatsapp: WhatsAppProvider;
  /** Where a renew link points; the token itself is minted by the link service. */
  readonly renewUrl: (memberId: string) => string;
  readonly unsubscribePayload: (memberId: string) => string;
}

async function gymId(deps: Phase6Deps): Promise<string> {
  const gym = await deps.prisma.gym.findUnique({ where: { slug: deps.gymSlug }, select: { id: true } });
  if (gym === null) throw new Error(`No gym for slug ${deps.gymSlug}`);
  return gym.id;
}

async function reminderSettings(deps: Phase6Deps, id: string) {
  const gym = await deps.prisma.gym.findUniqueOrThrow({ where: { id }, select: { settings: true } });
  const parsed = GymSettingsSchema.parse(gym.settings);
  return {
    automaticPaused: parsed.reminders.automaticPaused,
    quietHours: parsed.reminders.quietHours,
    maxMessagesPerNumberPerDay: parsed.reminders.maxMessagesPerNumberPerDay,
  };
}

/** Run one slot now: plan it, queue the messages, and record what the run did. */
export async function runSlot(deps: Phase6Deps, slot: string, today: ISTDate): Promise<void> {
  const id = await gymId(deps);
  const runs = new PrismaJobRuns(deps.prisma);
  const runKey = `${today}@${slot}`;

  const result = await runReminderSlot(
    { slot, today },
    {
      clock: deps.clock,
      gymId: id,
      settings: () => reminderSettings(deps, id),
      rules: () => new PrismaReminderRules(deps.prisma).all(id),
      candidates: (forSlot, forDay) => new PrismaReminderCandidates(deps.prisma).forSlot(id, forDay, forSlot),
      tokens: { renewUrl: deps.renewUrl, unsubscribePayload: deps.unsubscribePayload },
      enqueue: async (intent: SendIntent) => {
        // The intent's own key doubles as the queue's singleton key, so a requeue of the
        // same message never becomes two jobs.
        await deps.boss.send(WHATSAPP_SEND_QUEUE, intent, { singletonKey: intent.idempotencyKey, retryLimit: 3, retryDelay: 60, retryBackoff: true });
      },
      messageLog: { record: (entry) => new PrismaMessageLogWriter(deps.prisma).record(entry) },
      claimRun: (key) => runs.claim(RUN_JOB_NAME, key, id),
      onWarning: (code) => deps.log.warn({ slot, code }, 'reminder slot refused'),
    },
  );

  if (!result.ran) {
    deps.log.info({ slot, today }, 'reminder slot skipped (already run, or outside quiet hours)');
    return;
  }
  await runs.finish(RUN_JOB_NAME, runKey, { planned: result.planned, sent: result.queued, skipped: result.skipped, failed: 0 });
  deps.log.info({ slot, today, ...result }, 'reminder slot done');
}

/** Send one queued reminder, re-checking the member's state first (BR-5.3). */
export async function sendOne(deps: Phase6Deps, intent: SendIntent): Promise<void> {
  const id = await gymId(deps);
  const today = todayIST(deps.clock);

  const result = await sendReminder(intent, {
    clock: deps.clock,
    gymId: id,
    settings: () => reminderSettings(deps, id),
    loadContext: async (memberId) => {
      const row = await new PrismaSendContext(deps.prisma).load(memberId, today);
      // A member who has been erased or deleted is not a send: say so in the language
      // the eligibility rules understand.
      return (row ?? {
        memberStatus: 'LEFT',
        whatsappOptIn: false,
        remindersUnsubscribedAt: null,
        remindersPausedUntil: null,
        hasMobile: false,
        latestConfirmedMembershipId: null,
        messagesToNumberToday: 0,
      }) as SendContext;
    },
    messageLog: {
      record: (entry) => new PrismaMessageLogWriter(deps.prisma).record(entry),
      updateByIdempotencyKey: (key, status, fields) =>
        new PrismaMessageLogUpdates(deps.prisma).updateByIdempotencyKey(key, status as Parameters<PrismaMessageLogUpdates['updateByIdempotencyKey']>[1], fields),
    },
    whatsapp: { send: (request) => deps.whatsapp.send(request) },
  });

  if (result.outcome === 'SKIPPED') deps.log.info({ key: intent.idempotencyKey, reason: result.reason }, 'reminder skipped at send time');
  else deps.log.info({ key: intent.idempotencyKey, outcome: result.outcome }, 'reminder handled');
}

/**
 * The owner's own two jobs, for the schedule registration to use.
 *
 * Both need to send a built message the same way every other transactional message
 * is sent — logged under its idempotency key first, then handed to the provider —
 * so they borrow `sendTemplate` rather than growing a second path to WhatsApp.
 */
export function ownerJobHandlers(deps: Phase6Deps, message: MessageJobDeps): Record<string, () => Promise<void>> {
  const deliver = (built: TransactionalMessage, to: string) => sendTemplate(message, built, to, null, null);
  const runs = new PrismaJobRuns(deps.prisma);

  return {
    'owner-digest': async () => {
      const id = await gymId(deps);
      const data = new PrismaOwnerData(deps.prisma);
      const result = await runOwnerDigest({
        clock: deps.clock,
        owner: () => data.owner(id),
        counts: (today, yesterday) => data.digestCounts(id, today, yesterday),
        deliver,
        automaticPaused: async () => (await reminderSettings(deps, id)).automaticPaused,
        claimRun: (runKey) => runs.claim(DIGEST_JOB_NAME, runKey, id),
      });
      deps.log.info(result, 'owner digest');
    },

    'owner-alerts': async () => {
      const id = await gymId(deps);
      const data = new PrismaOwnerData(deps.prisma);
      const queue = new PrismaOwnerAlertQueue(deps.prisma);
      const result = await runOwnerAlerts({
        clock: deps.clock,
        owner: () => data.owner(id),
        pending: (since) => queue.pending(id, since),
        sentInWindow: (since) => queue.sentInWindow(id, since),
        deliver,
        automaticPaused: async () => (await reminderSettings(deps, id)).automaticPaused,
        markNotified: (ids, at) => queue.markNotified(ids, at),
        onError: (error, alertIds) => deps.log.warn({ err: error, alertIds }, 'owner alert will be tried again'),
      });
      if (result.sent > 0 || result.dropped > 0) deps.log.info(result, 'owner alerts');
    },
  };
}

/** The gym's distinct slot times, in order. */
export async function reminderSlots(deps: Phase6Deps): Promise<string[]> {
  return new PrismaReminderRules(deps.prisma).slots(await gymId(deps));
}

/**
 * One handler per slot queue, for the schedule registration to use.
 *
 * They are handed over rather than registered here, because a queue with two workers
 * hands each job to one of them — and the other one would be the "not implemented"
 * placeholder, silently swallowing a slot.
 */
export function slotHandlers(deps: Phase6Deps, slots: readonly string[]): Record<string, () => Promise<void>> {
  return Object.fromEntries(slots.map((slot) => [reminderQueueName(slot), () => runSlot(deps, slot, todayIST(deps.clock))]));
}

/**
 * The send queue, plus a cron for any slot the static schedule list does not already
 * carry (the owner may have moved a slot to a time of their own).
 */
export async function registerReminderJobs(deps: Phase6Deps, slots: readonly string[], alreadyScheduled: ReadonlySet<string>): Promise<void> {
  await deps.boss.createQueue(WHATSAPP_SEND_QUEUE, { deleteAfterSeconds: 14 * 24 * 60 * 60 });
  await deps.boss.work(WHATSAPP_SEND_QUEUE, async (jobs: Array<{ data: SendIntent }>) => {
    for (const job of jobs) {
      try {
        await sendOne(deps, job.data);
      } catch (error) {
        // A retryable provider failure comes back here; pg-boss will try again.
        if (error instanceof RetryableSendError) deps.log.warn({ key: job.data.idempotencyKey, code: error.errorCode }, 'reminder send will be retried');
        throw error;
      }
    }
  });

  for (const slot of slots) {
    const queue = reminderQueueName(slot);
    if (alreadyScheduled.has(queue)) continue;
    const [hour, minute] = slot.split(':');
    await deps.boss.createQueue(queue, { deleteAfterSeconds: 14 * 24 * 60 * 60 });
    await deps.boss.work(queue, async () => {
      await runSlot(deps, slot, todayIST(deps.clock));
    });
    await deps.boss.schedule(queue, `${Number(minute)} ${Number(hour)} * * *`, null, { tz: 'Asia/Kolkata' });
    deps.log.info({ slot, queue }, 'registered a slot the default schedule does not have');
  }
}

/**
 * On boot, run the slots of today that never ran (whatsapp-automation-engine §4).
 *
 * The `JobRun` claim inside each slot is what makes this safe: a slot that already ran
 * is claimed, so catch-up finds nothing to do. Slots still in the future are left alone.
 */
export async function catchUpMissedSlots(deps: Phase6Deps, slots: readonly string[], nowIST: string): Promise<string[]> {
  const today = todayIST(deps.clock);
  const due = slots.filter((slot) => slot <= nowIST);
  const ran: string[] = [];
  for (const slot of due) {
    await runSlot(deps, slot, today);
    ran.push(slot);
  }
  return ran;
}
