import type { MessageLogEntry, MessageLogWriter, MessageStatus } from '@mfp/core/ports';
import type { Prisma } from '../generated/prisma/client';
import type { PrismaClient, TransactionClient } from '../client';

/**
 * The database implementation of the `MessageLogWriter` port (ADR-017).
 *
 * `packages/integrations` may not import Prisma, so this lives here and is injected
 * at the app boundary. That keeps the ESLint dependency boundary enforceable and
 * lets the simulator be tested against an in-memory writer.
 */
export class PrismaMessageLogWriter implements MessageLogWriter {
  readonly #db: PrismaClient | TransactionClient;

  constructor(db: PrismaClient | TransactionClient) {
    this.#db = db;
  }

  /**
   * Insert, ignoring a conflict on `idempotencyKey`.
   *
   * Returning `false` rather than throwing is deliberate: a duplicate is the
   * normal, expected outcome of a retried job or a duplicate cron fire (BR-5.4,
   * case R15), and the caller must skip the send — not log an error.
   *
   * `createMany` with `skipDuplicates` does the conflict handling in the database,
   * so two workers racing on the same key cannot both proceed.
   */
  async record(entry: MessageLogEntry): Promise<boolean> {
    const result = await this.#db.messageLog.createMany({
      data: [
        {
          gymId: entry.gymId,
          memberId: entry.memberId,
          membershipId: entry.membershipId,
          direction: entry.direction,
          purpose: entry.purpose,
          ruleCode: entry.ruleCode,
          templateName: entry.templateName,
          language: entry.language,
          toNumber: entry.toNumber,
          idempotencyKey: entry.idempotencyKey,
          providerMessageId: entry.providerMessageId,
          status: entry.status,
          bodyPreview: entry.bodyPreview,
          // A nullable JSON column takes an omitted key, not `null`. The port types the
          // payload as plain JSON-serialisable data, which is what Prisma stores.
          ...(entry.payload === null ? {} : { payload: entry.payload as Prisma.InputJsonValue }),
          errorCode: entry.errorCode ?? null,
          errorMessage: entry.errorMessage ?? null,
        },
      ],
      skipDuplicates: true,
    });

    return result.count === 1;
  }

  /**
   * Apply a provider status callback.
   *
   * WhatsApp status webhooks can arrive out of order — `read` before `delivered`
   * is common — so each timestamp is written to its own column and the row's
   * `status` is only advanced, never walked back.
   */
  async updateStatus(
    providerMessageId: string,
    status: MessageStatus,
    at: Date,
    error?: { code: string; message: string },
  ): Promise<void> {
    const timestampField =
      status === 'SENT'
        ? { sentAt: at }
        : status === 'DELIVERED'
          ? { deliveredAt: at }
          : status === 'READ'
            ? { readAt: at }
            : {};

    await this.#db.messageLog.updateMany({
      where: { providerMessageId },
      data: {
        status,
        ...timestampField,
        ...(error === undefined ? {} : { errorCode: error.code, errorMessage: error.message }),
      },
    });
  }
}
