import type { E164Mobile } from '@mfp/shared';
import type { LeadStore, LeadUnitOfWork } from '@mfp/core';
import { withTransaction, type PrismaClient, type TransactionClient } from '../client';
import { enqueueOutboxEvent } from './outbox';

/**
 * Prisma implementation of the lead service's unit of work.
 *
 * Every store method runs on the transaction client, so the lead, its bell alert and
 * its outbox event commit together or not at all (system-architecture.md §5).
 */
export class PrismaLeadUnitOfWork implements LeadUnitOfWork {
  readonly #prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.#prisma = prisma;
  }

  transaction<T>(work: (store: LeadStore) => Promise<T>): Promise<T> {
    return withTransaction(this.#prisma, (tx) => work(storeFor(tx)));
  }
}

function storeFor(tx: TransactionClient): LeadStore {
  return {
    async findLeadsByMobileSince(gymId: string, mobile: E164Mobile, since: Date) {
      return tx.lead.findMany({
        where: { gymId, mobile, createdAt: { gte: since } },
        select: { id: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 5,
      });
    },

    async createLead(lead) {
      const created = await tx.lead.create({
        data: {
          gymId: lead.gymId,
          name: lead.name,
          mobile: lead.mobile,
          goal: lead.goal,
          source: lead.source,
          status: 'NEW',
          consentContact: true,
          ...(lead.utm === null || lead.utm === undefined ? {} : { utm: lead.utm }),
        },
        select: { id: true },
      });
      return created.id;
    },

    async appendLeadNote(leadId, update) {
      // Read inside the transaction so two quick repeat enquiries cannot overwrite
      // each other's note.
      const lead = await tx.lead.findUniqueOrThrow({ where: { id: leadId }, select: { notes: true } });
      await tx.lead.update({ where: { id: leadId }, data: { notes: update(lead.notes) } });
    },

    async createAlert(alert) {
      await tx.alert.create({
        data: { gymId: alert.gymId, type: alert.type, title: alert.title, params: { ...alert.params } },
      });
    },

    enqueueOutbox(event) {
      // The dedupe key is unique: a retried request must not queue a second alert.
      return enqueueOutboxEvent(tx, event);
    },
  };
}
