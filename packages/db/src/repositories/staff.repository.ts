import type {
  NewStaffRecord,
  OwnPinAuditEntry,
  OwnPinStore,
  OwnPinUnitOfWork,
  StaffAuditEntry,
  StaffForManagement,
  StaffForPinChange,
  StaffStore,
  StaffUnitOfWork,
} from '@mfp/core';
import { sessionTokenHash } from '@mfp/core';
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

/**
 * Changing your own PIN. Every other session is revoked; the one the change was made from
 * is identified by its token's hash and kept.
 */
export class PrismaOwnPinUnitOfWork implements OwnPinUnitOfWork {
  readonly #prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.#prisma = prisma;
  }

  transaction<T>(work: (store: OwnPinStore) => Promise<T>): Promise<T> {
    return withTransaction(this.#prisma, (tx) => work(ownPinStore(tx)));
  }
}

function ownPinStore(tx: TransactionClient): OwnPinStore {
  return {
    async staffForPinChange(staffUserId: string): Promise<StaffForPinChange | null> {
      return await tx.staffUser.findUnique({
        where: { id: staffUserId },
        select: { pinHash: true, isActive: true, failedPinCount: true, lockedUntil: true },
      });
    },

    async recordFailedPin(staffUserId: string, failedCount: number, lockedUntil: Date | null): Promise<void> {
      await tx.staffUser.update({ where: { id: staffUserId }, data: { failedPinCount: failedCount, lockedUntil } });
    },

    async setPin(staffUserId: string, pinHash: string): Promise<void> {
      await tx.staffUser.update({ where: { id: staffUserId }, data: { pinHash, failedPinCount: 0, lockedUntil: null } });
    },

    async revokeOtherSessions(staffUserId: string, keepToken: string, at: Date): Promise<void> {
      await tx.session.updateMany({
        where: { staffUserId, revokedAt: null, tokenHash: { not: sessionTokenHash(keepToken) } },
        data: { revokedAt: at },
      });
    },

    async writeAudit(entry: OwnPinAuditEntry): Promise<void> {
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

/** A staff member's own preferences (ADR-062). Only the signed-in person changes their own. */
export class PrismaStaffPreferences {
  readonly #prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.#prisma = prisma;
  }

  /** The language Max Register opens in for this person, on every device they sign in on. */
  async setLanguage(gymId: string, staffUserId: string, language: 'hi' | 'en'): Promise<void> {
    await this.#prisma.staffUser.updateMany({ where: { id: staffUserId, gymId }, data: { language } });
  }
}
