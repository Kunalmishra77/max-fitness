import type { NewStaffRecord, StaffAuditEntry, StaffForManagement, StaffStore, StaffUnitOfWork } from '@mfp/core';
import type { Prisma } from '../generated/prisma/client';
import { withTransaction, type PrismaClient, type TransactionClient } from '../client';

/**
 * Staff logins (crm-ux-blueprint §14; security-plan §3.1).
 *
 * A PIN reset also clears the lockout from wrong guesses, and signing someone out
 * revokes every live session they have — the session rows are what the cookie
 * resolves to, so a revoked row is a logged-out phone on its next request.
 */
export class PrismaStaffUnitOfWork implements StaffUnitOfWork {
  readonly #prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.#prisma = prisma;
  }

  transaction<T>(work: (store: StaffStore) => Promise<T>): Promise<T> {
    return withTransaction(this.#prisma, (tx) => work(staffStore(tx)));
  }
}

function staffStore(tx: TransactionClient): StaffStore {
  return {
    async findStaff(gymId: string, staffUserId: string): Promise<StaffForManagement | null> {
      return await tx.staffUser.findFirst({ where: { id: staffUserId, gymId }, select: { id: true, gymId: true, role: true, isActive: true } });
    },

    async mobileTaken(gymId: string, mobile: string): Promise<boolean> {
      return (await tx.staffUser.count({ where: { gymId, mobile } })) > 0;
    },

    async createStaff(record: NewStaffRecord): Promise<string> {
      const created = await tx.staffUser.create({ data: { ...record }, select: { id: true } });
      return created.id;
    },

    async setPin(staffUserId: string, pinHash: string): Promise<void> {
      await tx.staffUser.update({ where: { id: staffUserId }, data: { pinHash, failedPinCount: 0, lockedUntil: null } });
    },

    async setActive(staffUserId: string, isActive: boolean): Promise<void> {
      await tx.staffUser.update({ where: { id: staffUserId }, data: { isActive } });
    },

    async revokeSessions(staffUserId: string, at: Date): Promise<void> {
      await tx.session.updateMany({ where: { staffUserId, revokedAt: null }, data: { revokedAt: at } });
    },

    async writeAudit(entry: StaffAuditEntry): Promise<void> {
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

export interface StaffListItem {
  readonly id: string;
  readonly name: string;
  readonly mobile: string;
  readonly role: string;
  readonly isActive: boolean;
  readonly lastLoginAt: Date | null;
}

/** Who logs in at this gym, active first. */
export class PrismaStaffReader {
  readonly #prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.#prisma = prisma;
  }

  async list(gymId: string): Promise<StaffListItem[]> {
    return await this.#prisma.staffUser.findMany({
      where: { gymId },
      select: { id: true, name: true, mobile: true, role: true, isActive: true, lastLoginAt: true },
      orderBy: [{ isActive: 'desc' }, { role: 'asc' }, { name: 'asc' }],
    });
  }
}
