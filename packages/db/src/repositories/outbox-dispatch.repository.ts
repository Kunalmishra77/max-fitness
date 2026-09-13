import type { ClaimedOutboxEvent, OutboxDispatchStore, OutboxEventType } from '@mfp/core';
import { withTransaction, type PrismaClient } from '../client';

/**
 * Prisma implementation of the outbox dispatcher's store (system-architecture.md §5).
 *
 * A claim locks due rows with `FOR UPDATE SKIP LOCKED` — a second poller skips rows the
 * first is holding instead of waiting — and moves their `availableAt` past a lease in
 * the same transaction. Once it commits, the rows are invisible to every poller until
 * the lease runs out, which is also what hands a crashed worker's events back.
 */
export class PrismaOutboxDispatchStore implements OutboxDispatchStore {
  readonly #prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.#prisma = prisma;
  }

  claimDue(types: readonly OutboxEventType[], now: Date, limit: number, leaseMs: number): Promise<ClaimedOutboxEvent[]> {
    return withTransaction(this.#prisma, async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string; gymId: string; type: string; payload: unknown; dedupeKey: string; attempts: number }>>`
        SELECT "id", "gymId", "type", "payload", "dedupeKey", "attempts"
        FROM "OutboxEvent"
        WHERE "status" = 'PENDING' AND "availableAt" <= ${now} AND "type" = ANY(${[...types]}::text[])
        ORDER BY "availableAt"
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      `;
      if (rows.length === 0) return [];

      await tx.outboxEvent.updateMany({
        where: { id: { in: rows.map((row) => row.id) } },
        data: { availableAt: new Date(now.getTime() + leaseMs) },
      });

      return rows.map((row) => ({
        id: row.id,
        gymId: row.gymId,
        type: row.type as OutboxEventType,
        payload: (typeof row.payload === 'object' && row.payload !== null ? row.payload : {}) as Record<string, unknown>,
        dedupeKey: row.dedupeKey,
        attempts: row.attempts,
      }));
    });
  }

  async markDispatched(id: string, at: Date): Promise<void> {
    await this.#prisma.outboxEvent.update({ where: { id }, data: { status: 'DISPATCHED', dispatchedAt: at, lastError: null } });
  }

  async scheduleRetry(id: string, attempts: number, error: string, availableAt: Date): Promise<void> {
    await this.#prisma.outboxEvent.update({ where: { id }, data: { attempts, lastError: error, availableAt } });
  }

  async markFailed(id: string, attempts: number, error: string): Promise<void> {
    await this.#prisma.outboxEvent.update({ where: { id }, data: { status: 'FAILED', attempts, lastError: error } });
  }
}
