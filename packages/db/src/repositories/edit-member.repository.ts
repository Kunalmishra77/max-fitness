import { isTrainingSlot } from '@mfp/shared';
import type { MemberEditAuditEntry, MemberEditStore, MemberEditUnitOfWork, MemberEditValues, MemberForEdit } from '@mfp/core';
import type { Prisma } from '../generated/prisma/client';
import { withTransaction, type PrismaClient, type TransactionClient } from '../client';
import { fromDbDate, toDbDate } from '../dates';

/**
 * Correcting a member's details against the database (crm-ux-blueprint §5).
 *
 * `trainingSlot` is a plain column rather than a Prisma enum, so a value written before the
 * list existed — or by hand — is read back as `null` rather than crashing the profile.
 */

type Db = PrismaClient | TransactionClient;

export function memberEditStore(db: Db): MemberEditStore {
  return {
    async findMemberForEdit(gymId: string, memberId: string): Promise<MemberForEdit | null> {
      const member = await db.member.findFirst({
        where: { id: memberId, gymId },
        select: {
          id: true,
          fullName: true,
          mobile: true,
          email: true,
          dob: true,
          gender: true,
          language: true,
          trainingSlot: true,
          joinedOn: true,
          notes: true,
          whatsappOptIn: true,
          deletedAt: true,
        },
      });
      if (member === null) return null;
      return {
        id: member.id,
        fullName: member.fullName,
        mobile: member.mobile,
        email: member.email,
        dob: member.dob === null ? null : fromDbDate(member.dob),
        gender: member.gender,
        language: member.language,
        trainingSlot: isTrainingSlot(member.trainingSlot) ? member.trainingSlot : null,
        joinedOn: member.joinedOn === null ? null : fromDbDate(member.joinedOn),
        notes: member.notes,
        whatsappOptIn: member.whatsappOptIn,
        deletedAt: member.deletedAt,
      };
    },

    countOtherMembersWithMobile(gymId: string, mobile: string, exceptMemberId: string): Promise<number> {
      return db.member.count({ where: { gymId, mobile, deletedAt: null, id: { not: exceptMemberId } } });
    },

    async updateMember(memberId: string, values: MemberEditValues): Promise<void> {
      await db.member.update({
        where: { id: memberId },
        data: {
          fullName: values.fullName,
          mobile: values.mobile,
          email: values.email,
          dob: values.dob === null ? null : toDbDate(values.dob),
          gender: values.gender,
          language: values.language,
          trainingSlot: values.trainingSlot,
          joinedOn: values.joinedOn === null ? null : toDbDate(values.joinedOn),
          notes: values.notes,
          whatsappOptIn: values.whatsappOptIn,
        },
      });
    },

    async writeAudit(entry: MemberEditAuditEntry): Promise<void> {
      await db.auditLog.create({
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

export class PrismaMemberEdit implements MemberEditUnitOfWork {
  readonly #prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.#prisma = prisma;
  }

  transaction<T>(work: (store: MemberEditStore) => Promise<T>): Promise<T> {
    return withTransaction(this.#prisma, (tx) => work(memberEditStore(tx)));
  }
}
