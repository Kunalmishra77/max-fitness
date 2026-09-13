import { randomUUID } from 'node:crypto';
import type {
  PaymentConfirmationStore,
  PaymentConfirmationUnitOfWork,
  PaymentForConfirmation,
  WebhookEventStore,
} from '@mfp/core';
import type { Clock } from '@mfp/shared';
import type { Prisma } from '../generated/prisma/client';
import { withTransaction, type PrismaClient, type TransactionClient } from '../client';
import { enqueueOutboxEvent } from './outbox';

/**
 * Prisma implementation of payment confirmation (signup-and-payment-flow.md §5).
 *
 * Two row locks carry the correctness of the whole flow:
 *
 * - `lockPaymentByOrderId` takes `FOR UPDATE` on the payment, so when the checkout
 *   verify call and the webhook (or two webhooks) arrive together, the second waits,
 *   then reads `PAID` and does nothing (cases P1–P3).
 * - `nextCounterValue` increments with an upsert, which locks the counter row until
 *   commit. A rolled-back confirmation releases its number, so the receipt series
 *   has no gaps (BR-11.2, database-design.md §6).
 */
export class PrismaPaymentConfirmationUnitOfWork implements PaymentConfirmationUnitOfWork {
  readonly #prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.#prisma = prisma;
  }

  transaction<T>(work: (store: PaymentConfirmationStore) => Promise<T>): Promise<T> {
    return withTransaction(this.#prisma, (tx) => work(confirmationStoreFor(tx)));
  }
}

function confirmationStoreFor(tx: TransactionClient): PaymentConfirmationStore {
  return {
    async lockPaymentByOrderId(providerOrderId) {
      const rows = await tx.$queryRaw<PaymentForConfirmation[]>`
        SELECT "id", "gymId", "memberId", "membershipId", "amountPaise", "status"::text AS "status", "receiptNo", "failureReason"
        FROM "Payment"
        WHERE "providerOrderId" = ${providerOrderId}
        FOR UPDATE
      `;
      return rows[0] ?? null;
    },

    async nextCounterValue(gymId, key) {
      const rows = await tx.$queryRaw<Array<{ value: number }>>`
        INSERT INTO "Counter" ("id", "gymId", "key", "value")
        VALUES (${randomUUID()}, ${gymId}, ${key}, 1)
        ON CONFLICT ("gymId", "key") DO UPDATE SET "value" = "Counter"."value" + 1
        RETURNING "value"
      `;
      const value = rows[0]?.value;
      if (value === undefined) throw new Error('Counter upsert returned no row');
      return value;
    },

    async markPaymentPaid(paymentId, update) {
      await tx.payment.update({
        where: { id: paymentId },
        data: {
          status: 'PAID',
          providerPaymentId: update.providerPaymentId,
          paidAt: update.paidAt,
          receiptNo: update.receiptNo,
          providerSignatureOk: update.signatureOk,
          method: update.method,
          // An earlier failed attempt on the same order no longer describes this payment.
          failureReason: null,
        },
      });
    },

    async flagPayment(paymentId, reason) {
      // Left CREATED: nothing is activated, and the owner resolves it from the alert.
      await tx.payment.update({ where: { id: paymentId }, data: { failureReason: reason } });
    },

    async confirmMembership(membershipId, confirmedAt) {
      // Money received wins over a reservation the nightly job already cancelled.
      await tx.membership.update({
        where: { id: membershipId },
        data: { status: 'CONFIRMED', confirmedAt, cancelledAt: null },
      });
    },

    getMember(memberId) {
      return tx.member.findUniqueOrThrow({ where: { id: memberId }, select: { id: true, memberCode: true } });
    },

    async activateMember(memberId, memberCode) {
      await tx.member.update({
        where: { id: memberId },
        // BR-4.4: a member who left and pays again is back. Clearing `leftAt` also stops
        // the retention sweep deleting a returning member's photo (database-design.md §9).
        // The WhatsApp unsubscribe flag is deliberately left alone.
        data: { status: 'ACTIVE', memberCode, leftAt: null, leftReason: null },
      });
    },

    async closeOpenCallTasks(memberId, reasons, closedAt) {
      await tx.callTask.updateMany({
        where: { memberId, status: 'OPEN', reason: { in: [...reasons] } },
        data: { status: 'AUTO_CLOSED', doneAt: closedAt },
      });
    },

    async createAlert(alert) {
      await tx.alert.create({
        data: { gymId: alert.gymId, type: alert.type, memberId: alert.memberId, title: alert.title, params: { ...alert.params } },
      });
    },

    enqueueOutbox(event) {
      return enqueueOutboxEvent(tx, event);
    },
  };
}

/** Longest failure description kept; Razorpay's are one sentence. */
const MAX_FAILURE_REASON = 500;

/**
 * Webhook bookkeeping. Not transactional with the confirmation on purpose: the event
 * row must survive a confirmation that rolls back, so the failure is visible and the
 * provider's retry is recognised as a retry of something unfinished.
 */
export class PrismaWebhookEventStore implements WebhookEventStore {
  readonly #prisma: PrismaClient;
  readonly #clock: Clock;

  constructor(prisma: PrismaClient, clock: Clock) {
    this.#prisma = prisma;
    this.#clock = clock;
  }

  async recordEvent(record: Parameters<WebhookEventStore['recordEvent']>[0]): Promise<'NEW' | 'DUPLICATE'> {
    const { count } = await this.#prisma.webhookEvent.createMany({
      data: [
        {
          provider: record.provider,
          externalId: record.externalId,
          eventType: record.eventType,
          signatureOk: record.signatureOk,
          payload: record.payload as Prisma.InputJsonValue,
        },
      ],
      skipDuplicates: true,
    });
    if (count === 1) return 'NEW';

    const existing = await this.#prisma.webhookEvent.findUnique({
      where: { provider_externalId: { provider: record.provider, externalId: record.externalId } },
      select: { processedAt: true },
    });
    return existing?.processedAt === null ? 'NEW' : 'DUPLICATE';
  }

  async markProcessed(externalId: string, error: string | null): Promise<void> {
    await this.#prisma.webhookEvent.update({
      where: { provider_externalId: { provider: 'razorpay', externalId } },
      data: { processedAt: this.#clock.now(), error },
    });
  }

  async markPaymentFailed(providerOrderId: string, reason: string | null): Promise<void> {
    // Only an unpaid attempt: a failure event that arrives after the capture (Razorpay
    // does not guarantee order) must not undo a confirmed payment.
    await this.#prisma.payment.updateMany({
      where: { providerOrderId, status: 'CREATED' },
      data: { status: 'FAILED', failureReason: reason === null ? null : reason.slice(0, MAX_FAILURE_REASON) },
    });
  }
}
