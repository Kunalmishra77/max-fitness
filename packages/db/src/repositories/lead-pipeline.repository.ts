import type { LeadForUpdate, LeadPipelineStore, LeadPipelineUnitOfWork, LeadUpdate } from '@mfp/core';
import { withTransaction, type PrismaClient, type TransactionClient } from '../client';

/**
 * Moving an enquiry along from the CRM (BR-10.1).
 *
 * Separate from `PrismaLeadUnitOfWork`, which is how a lead arrives from the website:
 * that one creates and merges, this one only ever moves an existing enquiry forward.
 */
export class PrismaLeadPipelineUnitOfWork implements LeadPipelineUnitOfWork {
  readonly #prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.#prisma = prisma;
  }

  transaction<T>(work: (store: LeadPipelineStore) => Promise<T>): Promise<T> {
    return withTransaction(this.#prisma, (tx) => work(leadPipelineStore(tx)));
  }
}

function leadPipelineStore(tx: TransactionClient): LeadPipelineStore {
  return {
    async loadLead(gymId: string, leadId: string): Promise<LeadForUpdate | null> {
      return await tx.lead.findFirst({
        where: { id: leadId, gymId },
        select: { id: true, gymId: true, status: true, notes: true },
      });
    },

    async updateLead(leadId: string, update: LeadUpdate): Promise<void> {
      await tx.lead.update({
        where: { id: leadId },
        data: {
          status: update.status,
          notes: update.notes,
          followUpAt: update.followUpAt,
          convertedMemberId: update.convertedMemberId,
        },
      });
    },
  };
}
