import type { SettingsAuditEntry, SettingsStore, SettingsUnitOfWork } from '@mfp/core';
import type { GymSettings } from '@mfp/shared';
import type { Prisma } from '../generated/prisma/client';
import { withTransaction, type PrismaClient, type TransactionClient } from '../client';

/**
 * The owner's settings and plan prices (crm-ux-blueprint §14).
 *
 * Settings are one JSON document, so a save is read-modify-write: the gym row is
 * locked for the length of the transaction, or two saves from two phones could each
 * read the old document and the second would quietly undo the first.
 */
export class PrismaSettingsUnitOfWork implements SettingsUnitOfWork {
  readonly #prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.#prisma = prisma;
  }

  transaction<T>(work: (store: SettingsStore) => Promise<T>): Promise<T> {
    return withTransaction(this.#prisma, (tx) => work(settingsStore(tx)));
  }
}

function settingsStore(tx: TransactionClient): SettingsStore {
  return {
    async loadSettings(gymId: string): Promise<unknown> {
      const rows = await tx.$queryRaw<Array<{ settings: unknown }>>`
        SELECT "settings" FROM "Gym" WHERE "id" = ${gymId} FOR UPDATE
      `;
      return rows[0]?.settings ?? {};
    },

    async saveSettings(gymId: string, settings: GymSettings): Promise<void> {
      await tx.gym.update({ where: { id: gymId }, data: { settings } });
    },

    async loadPlans(gymId: string): Promise<ReadonlyArray<{ code: string; pricePaise: number }>> {
      return await tx.plan.findMany({ where: { gymId }, select: { code: true, pricePaise: true } });
    },

    async savePlanPrice(gymId: string, code: string, pricePaise: number): Promise<void> {
      // BR-2.8: only the plan changes; every membership keeps the price it was sold at.
      await tx.plan.update({ where: { gymId_code: { gymId, code } }, data: { pricePaise } });
    },

    async writeAudit(entry: SettingsAuditEntry): Promise<void> {
      await tx.auditLog.create({
        data: {
          gymId: entry.gymId,
          actorType: entry.actorType,
          actorId: entry.actorId,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId,
          before: entry.before as Prisma.InputJsonValue,
          after: entry.after as Prisma.InputJsonValue,
        },
      });
    },
  };
}
