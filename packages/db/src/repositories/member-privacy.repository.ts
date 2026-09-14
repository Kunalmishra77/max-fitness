import type { MemberErasureUnitOfWork, MemberExport, MemberForErasure, MemberPrivacyStore, PrivacyAuditEntry } from '@mfp/core';
import { Prisma } from '../generated/prisma/client';
import { withTransaction, type PrismaClient, type TransactionClient } from '../client';
import { fromDbDate } from '../dates';

/**
 * A member's data rights against the database (privacy-and-dpdp-compliance §6).
 *
 * Erasure keeps rows that the accounts and the law need — memberships, payments,
 * attendance, consents — and removes what identifies a person from everything else. The
 * member's mobile becomes a placeholder rather than an empty string because the column is
 * required; it cannot collide with a real number and matches no one.
 */

type Db = PrismaClient | TransactionClient;

/** What an erased member and their linked enquiries are called afterwards. */
export const ERASED_NAME = 'Erased member';

const iso = (date: Date | null) => (date === null ? null : date.toISOString());

export function memberPrivacyStore(db: Db): MemberPrivacyStore {
  return {
    async loadMemberExport(gymId: string, memberId: string): Promise<MemberExport | null> {
      const member = await db.member.findFirst({
        where: { id: memberId, gymId, deletedAt: null },
        select: {
          id: true,
          memberCode: true,
          fullName: true,
          mobile: true,
          email: true,
          dob: true,
          gender: true,
          language: true,
          status: true,
          source: true,
          createdAt: true,
          whatsappOptIn: true,
          faceConsent: true,
          photoMediaId: true,
        },
      });
      if (member === null) return null;

      const [memberships, payments, attendance, consents, messages, callTasks, faceTemplates] = await Promise.all([
        db.membership.findMany({
          where: { memberId },
          select: { startDate: true, endDate: true, durationMonths: true, pricePaise: true, status: true },
          orderBy: { endDate: 'asc' },
        }),
        db.payment.findMany({
          where: { memberId },
          select: { amountPaise: true, method: true, status: true, receiptNo: true, paidAt: true },
          orderBy: { createdAt: 'asc' },
        }),
        db.attendanceEvent.findMany({ where: { memberId, voidedAt: null }, select: { attendanceDate: true, method: true }, orderBy: { capturedAt: 'asc' } }),
        db.consent.findMany({
          where: { memberId },
          select: { type: true, granted: true, noticeVersion: true, channel: true, createdAt: true, withdrawnAt: true },
          orderBy: { createdAt: 'asc' },
        }),
        db.messageLog.findMany({ where: { memberId }, select: { purpose: true, status: true, sentAt: true, bodyPreview: true }, orderBy: { createdAt: 'asc' } }),
        db.callTask.findMany({ where: { memberId }, select: { reason: true, status: true, outcome: true, note: true, createdAt: true }, orderBy: { createdAt: 'asc' } }),
        db.faceTemplate.count({ where: { memberId } }),
      ]);

      return {
        member: {
          id: member.id,
          memberCode: member.memberCode,
          fullName: member.fullName,
          mobile: member.mobile,
          email: member.email,
          dob: member.dob === null ? null : fromDbDate(member.dob),
          gender: member.gender,
          language: member.language,
          status: member.status,
          source: member.source,
          createdAt: member.createdAt.toISOString(),
          whatsappOptIn: member.whatsappOptIn,
          faceConsent: member.faceConsent,
          hasPhoto: member.photoMediaId !== null,
        },
        memberships: memberships.map((row) => ({
          startDate: row.startDate === null ? null : fromDbDate(row.startDate),
          endDate: fromDbDate(row.endDate),
          durationMonths: row.durationMonths,
          pricePaise: row.pricePaise,
          status: row.status,
        })),
        payments: payments.map((row) => ({ amountPaise: row.amountPaise, method: row.method, status: row.status, receiptNo: row.receiptNo, paidAt: iso(row.paidAt) })),
        attendance: attendance.map((row) => ({ date: fromDbDate(row.attendanceDate), method: row.method })),
        consents: consents.map((row) => ({
          type: row.type,
          granted: row.granted,
          noticeVersion: row.noticeVersion,
          channel: row.channel,
          createdAt: row.createdAt.toISOString(),
          withdrawnAt: iso(row.withdrawnAt),
        })),
        messages: messages.map((row) => ({ purpose: row.purpose, status: row.status, sentAt: iso(row.sentAt), text: row.bodyPreview })),
        callTasks: callTasks.map((row) => ({ reason: row.reason, status: row.status, outcome: row.outcome, note: row.note, createdAt: row.createdAt.toISOString() })),
        faceTemplates: { count: faceTemplates },
      };
    },

    async findMemberForErasure(gymId: string, memberId: string): Promise<MemberForErasure | null> {
      return await db.member.findFirst({ where: { id: memberId, gymId }, select: { id: true, memberCode: true, deletedAt: true } });
    },

    async anonymiseMember(memberId: string, at: Date): Promise<void> {
      await db.member.update({
        where: { id: memberId },
        data: {
          fullName: ERASED_NAME,
          mobile: `erased-${memberId}`,
          email: null,
          dob: null,
          notes: null,
          photoMediaId: null,
          whatsappOptIn: false,
          faceConsent: false,
          remindersUnsubscribedAt: at,
          status: 'LEFT',
          leftReason: 'OTHER',
          leftNote: null,
          deletedAt: at,
        },
      });
    },

    async markMemberMediaDeleted(memberId: string, at: Date): Promise<readonly string[]> {
      // Their own media, plus the receipt PDFs on their payments: a receipt carries the name.
      const receiptIds = (await db.payment.findMany({ where: { memberId, receiptMediaId: { not: null } }, select: { receiptMediaId: true } }))
        .map((row) => row.receiptMediaId)
        .filter((id): id is string => id !== null);
      const media = await db.mediaFile.findMany({
        where: { deletedAt: null, OR: [{ memberId }, { id: { in: receiptIds } }] },
        select: { id: true, storageKey: true },
      });
      if (media.length > 0) {
        await db.mediaFile.updateMany({ where: { id: { in: media.map((row) => row.id) } }, data: { deletedAt: at } });
      }
      return media.map((row) => row.storageKey);
    },

    async deleteFaceData(memberId: string): Promise<number> {
      await db.enrollmentJob.deleteMany({ where: { memberId } });
      const { count } = await db.faceTemplate.deleteMany({ where: { memberId } });
      return count;
    },

    async scrubMessages(memberId: string): Promise<void> {
      await db.messageLog.updateMany({ where: { memberId }, data: { toNumber: null, fromNumber: null, bodyPreview: null, payload: Prisma.DbNull } });
    },

    async scrubAlerts(memberId: string): Promise<void> {
      await db.alert.updateMany({ where: { memberId }, data: { params: Prisma.DbNull } });
    },

    async closeCallTasks(memberId: string, at: Date): Promise<void> {
      await db.callTask.updateMany({ where: { memberId, status: 'OPEN' }, data: { status: 'AUTO_CLOSED', doneAt: at } });
      await db.callTask.updateMany({ where: { memberId }, data: { note: null } });
    },

    async anonymiseConvertedLeads(memberId: string): Promise<void> {
      await db.lead.updateMany({
        where: { convertedMemberId: memberId },
        data: { name: ERASED_NAME, mobile: `erased-${memberId}`, notes: null, utm: Prisma.DbNull },
      });
    },

    async writeAudit(entry: PrivacyAuditEntry): Promise<void> {
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

/** Export reads through `store`; erasure runs through `transaction`. */
export class PrismaMemberPrivacy implements MemberErasureUnitOfWork {
  readonly #prisma: PrismaClient;
  readonly store: MemberPrivacyStore;

  constructor(prisma: PrismaClient) {
    this.#prisma = prisma;
    this.store = memberPrivacyStore(prisma);
  }

  transaction<T>(work: (store: MemberPrivacyStore) => Promise<T>): Promise<T> {
    return withTransaction(this.#prisma, (tx) => work(memberPrivacyStore(tx)));
  }
}
