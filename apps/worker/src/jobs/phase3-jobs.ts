import type { PgBoss } from 'pg-boss';
import {
  attachReceiptPdf,
  dispatchOutbox,
  raiseSignupNotPaidTasks,
  type ClaimedOutboxEvent,
  type OutboxHandlers,
} from '@mfp/core';
import type { StorageDriver } from '@mfp/core/ports';
import {
  PrismaOutboxDispatchStore,
  PrismaReceiptPdfStore,
  PrismaReceiptReader,
  PrismaSignupNotPaidStore,
  type PrismaClient,
} from '@mfp/db';
import type { Clock } from '@mfp/shared';
import type { Logger } from '../logger';
import { renderReceiptPdf } from '../receipts/render-receipt';

/**
 * The worker jobs Phase 3 needs (signup-and-payment-flow.md §5–7).
 *
 * - The outbox poller turns committed side effects into queued jobs every 2 seconds.
 *   It handles only `receipt.pdf` so far; WhatsApp receipts and kiosk enrolment stay
 *   pending in the outbox until their phases land, and are dispatched then.
 * - `receipt-pdf` renders and attaches the receipt PDF.
 * - The 06:00 `nightly-call-tasks` job raises SIGNUP_NOT_PAID tasks (the rest is Phase 4).
 */

export const RECEIPT_PDF_QUEUE = 'receipt-pdf';
const OUTBOX_POLL_MS = 2_000;

export function outboxHandlers(boss: Pick<PgBoss, 'send'>): OutboxHandlers {
  return {
    'receipt.pdf': async (event: ClaimedOutboxEvent) => {
      const paymentId = receiptJobPaymentId(event.payload);
      if (paymentId === null) throw new Error('receipt.pdf event without a paymentId');
      // The dedupe key makes a re-dispatched event a no-op in the queue as well.
      await boss.send(RECEIPT_PDF_QUEUE, { paymentId }, { singletonKey: event.dedupeKey, retryLimit: 5, retryDelay: 30, retryBackoff: true });
    },
  };
}

export function receiptJobPaymentId(data: unknown): string | null {
  const paymentId = (data as { paymentId?: unknown } | null)?.paymentId;
  return typeof paymentId === 'string' && paymentId.length > 0 ? paymentId : null;
}

export interface Phase3Deps {
  readonly boss: PgBoss;
  readonly prisma: PrismaClient;
  readonly storage: StorageDriver;
  readonly clock: Clock;
  readonly log: Logger;
  readonly gymSlug: string;
}

/** Starts the outbox poller; the returned function stops it and waits for a running pass. */
/**
 * The outbox poller.
 *
 *  is how later phases add their own event types without this file
 * knowing about them; an event with no handler stays pending until one exists.
 */
export function startOutboxPoller(deps: Phase3Deps, extraHandlers: OutboxHandlers = {}): () => Promise<void> {
  const store = new PrismaOutboxDispatchStore(deps.prisma);
  const handlers = { ...outboxHandlers(deps.boss), ...extraHandlers };
  let running: Promise<void> | null = null;
  let stopped = false;

  const pass = async () => {
    try {
      const result = await dispatchOutbox({ store, handlers, clock: deps.clock });
      if (result.dispatched + result.retried + result.failed > 0) deps.log.info(result, 'outbox dispatched');
      if (result.failed > 0) deps.log.error({ failed: result.failed }, 'outbox events failed permanently');
    } catch (error) {
      deps.log.error({ err: error }, 'outbox pass failed');
    }
  };

  const timer = setInterval(() => {
    if (stopped || running !== null) return;
    running = pass().finally(() => {
      running = null;
    });
  }, OUTBOX_POLL_MS);

  return async () => {
    stopped = true;
    clearInterval(timer);
    await running;
  };
}

export async function registerReceiptPdfWorker(deps: Phase3Deps): Promise<void> {
  const reader = new PrismaReceiptReader(deps.prisma);
  const store = new PrismaReceiptPdfStore(deps.prisma);

  await deps.boss.work(RECEIPT_PDF_QUEUE, async (jobs) => {
    for (const job of jobs) {
      const paymentId = receiptJobPaymentId(job.data);
      if (paymentId === null) {
        deps.log.error({ jobId: job.id }, 'receipt-pdf job without a paymentId');
        continue;
      }
      const outcome = await attachReceiptPdf(paymentId, {
        load: (id) => reader.receipt(id),
        render: renderReceiptPdf,
        storage: deps.storage,
        store,
      });
      deps.log.info({ jobId: job.id, outcome }, 'receipt pdf');
    }
  });
}

/** The Phase 3 part of the 06:00 nightly call-task job. */
export function nightlyCallTasksHandler(deps: Phase3Deps) {
  return async (): Promise<void> => {
    const gym = await deps.prisma.gym.findUnique({ where: { slug: deps.gymSlug }, select: { id: true } });
    if (gym === null) {
      deps.log.error({ gymSlug: deps.gymSlug }, 'nightly call tasks: gym not found');
      return;
    }
    const created = await raiseSignupNotPaidTasks({ store: new PrismaSignupNotPaidStore(deps.prisma, gym.id), clock: deps.clock });
    deps.log.info({ created, reason: 'SIGNUP_NOT_PAID' }, 'nightly call tasks (the remaining rules arrive in Phase 4)');
  };
}
