import type { OutboxEventInput } from '@mfp/core';
import type { Prisma } from '../generated/prisma/client';
import type { TransactionClient } from '../client';

/**
 * Queue a side effect inside the caller's transaction (system-architecture.md §5).
 *
 * The dedupe key is unique, so a retried request or a second confirmation path
 * queues nothing new (CLAUDE.md §2.5).
 */
export async function enqueueOutboxEvent(tx: TransactionClient, event: OutboxEventInput): Promise<void> {
  await tx.outboxEvent.createMany({
    data: [
      {
        gymId: event.gymId,
        type: event.type,
        payload: event.payload as Prisma.InputJsonValue,
        dedupeKey: event.dedupeKey,
        ...(event.availableAt === undefined ? {} : { availableAt: event.availableAt }),
      },
    ],
    skipDuplicates: true,
  });
}
