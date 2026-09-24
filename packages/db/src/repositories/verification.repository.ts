import { randomUUID } from 'node:crypto';
import type {
  ExistingMemberStore,
  ExistingMemberUnitOfWork,
  LockedVerification,
  VerificationStore,
  VerificationUnitOfWork,
} from '@mfp/core';
import type { E164Mobile, ISTDate, PlanDurationMonths } from '@mfp/shared';
import type { Prisma } from '../generated/prisma/client';
import { withTransaction, type PrismaClient, type TransactionClient } from '../client';
import { fromDbDate, toDbDate } from '../dates';

/**
 * QR submissions from existing members, and the CRM's verify queue (qr-onboarding-flow; ADR-058).
 *
 * A person is matched on mobile and name with case and spacing ignored, the same way
 * the register import decides who is already a member.
 */

const personName = (fullName: string) => fullName.trim().replace(/\s+/g, ' ').toLowerCase();

function existingMemberStore(tx: TransactionClient): ExistingMemberStore {
  return {
    async findImportedMember(gymId: string, mobile: E164Mobile, fullName: string) {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "Member"
        WHERE "gymId" = ${gymId} AND "mobile" = ${mobile} AND "source" = 'IMPORT' AND "deletedAt" IS NULL
          AND lower(regexp_replace(trim("fullName"), '\\s+', ' ', 'g')) = ${personName(fullName)}
        ORDER BY "createdAt" ASC
        LIMIT 1
      `;
      return rows[0] ?? null;
    },

    async findImportedMemberById(gymId: string, mobile: E164Mobile, memberId: string) {
      return tx.member.findFirst({
        where: { id: memberId, gymId, mobile, source: 'IMPORT', deletedAt: null },
        select: { id: true },
      });
    },

    async findPendingRequest(gymId: string, mobile: E164Mobile, fullName: string) {
      const rows = await tx.$queryRaw<Array<{ referenceCode: string }>>`
        SELECT v."referenceCode" FROM "VerificationRequest" v
        JOIN "Member" m ON m."id" = v."memberId"
        WHERE v."gymId" = ${gymId} AND v."status" = 'PENDING' AND m."mobile" = ${mobile} AND m."deletedAt" IS NULL
          AND lower(regexp_replace(trim(m."fullName"), '\\s+', ' ', 'g')) = ${personName(fullName)}
        ORDER BY v."createdAt" DESC
        LIMIT 1
      `;
      return rows[0] ?? null;
    },

    async referenceCodeTaken(gymId: string, code: string) {
      return (await tx.verificationRequest.count({ where: { gymId, referenceCode: code } })) > 0;
    },

    async createMember(record) {
      const created = await tx.member.create({
        data: {
          gymId: record.gymId,
          fullName: record.fullName,
          mobile: record.mobile,
          email: record.email,
          ...(record.joinedOn === null ? {} : { joinedOn: toDbDate(record.joinedOn) }),
          dob: toDbDate(record.dob),
          gender: record.gender,
          language: record.language,
          status: record.status,
          source: record.source,
          isMinor: record.isMinor,
          whatsappOptIn: record.whatsappOptIn,
          faceConsent: record.faceConsent,
        },
        select: { id: true },
      });
      return created.id;
    },

    async confirmImportedMember(memberId, values) {
      await tx.member.update({ where: { id: memberId }, data: { whatsappOptIn: values.whatsappOptIn, faceConsent: values.faceConsent } });
    },

    async createSelfieMedia(record) {
      const created = await tx.mediaFile.create({
        data: {
          gymId: record.gymId,
          memberId: record.memberId,
          kind: 'SELFIE',
          storageKey: record.stored.key,
          mimeType: record.stored.mimeType,
          sizeBytes: record.stored.sizeBytes,
          sha256: record.stored.sha256,
          width: record.width,
          height: record.height,
        },
        select: { id: true },
      });
      return created.id;
    },

    /**
     * A photograph of one side of a government ID (ADR-074).
     *
     * `label` is what tells the desk which side it is looking at; the number is
     * neither asked for nor stored, so the picture is the whole record.
     */
    async createGovIdMedia(record) {
      const created = await tx.mediaFile.create({
        data: {
          gymId: record.gymId,
          memberId: record.memberId,
          kind: 'GOV_ID',
          label: record.label,
          storageKey: record.stored.key,
          mimeType: record.stored.mimeType,
          sizeBytes: record.stored.sizeBytes,
          sha256: record.stored.sha256,
          width: record.width,
          height: record.height,
        },
        select: { id: true },
      });
      return created.id;
    },

    async setMemberPhoto(memberId, mediaId) {
      await tx.member.update({ where: { id: memberId }, data: { photoMediaId: mediaId } });
    },

    async createConsents(records) {
      await tx.consent.createMany({
        data: records.map((r) => ({
          gymId: r.gymId,
          memberId: r.memberId,
          type: r.type,
          granted: r.granted,
          noticeVersion: r.noticeVersion,
          channel: r.channel,
          recordedById: r.recordedById,
          ipHash: r.ipHash,
          userAgent: r.userAgent,
        })),
      });
    },

    async createVerificationRequest(record) {
      const created = await tx.verificationRequest.create({
        data: {
          gymId: record.gymId,
          memberId: record.memberId,
          referenceCode: record.referenceCode,
          declaredPlanMonths: record.declaredPlanMonths,
          declaredEndDate: toDbDate(record.declaredEndDate),
          declaredAmountPaise: record.declaredAmountPaise,
          govIdType: record.govIdType,
          matchedImportMemberId: record.matchedImportMemberId,
        },
        select: { id: true },
      });
      return created.id;
    },

    async createAlert(alert) {
      await tx.alert.create({
        data: { gymId: alert.gymId, memberId: alert.memberId, type: 'VERIFICATION_PENDING', title: 'alert.verifyPending', params: alert.params },
      });
    },
  };
}

function verificationStore(tx: TransactionClient): VerificationStore {
  return {
    async lockRequest(gymId: string, verificationId: string): Promise<LockedVerification | null> {
      const rows = await tx.$queryRaw<
        Array<{
          id: string;
          memberId: string;
          status: LockedVerification['status'];
          declaredPlanMonths: number | null;
          declaredEndDate: Date;
          declaredAmountPaise: number | null;
          matchedImportMemberId: string | null;
        }>
      >`
        SELECT "id", "memberId", "status", "declaredPlanMonths", "declaredEndDate", "declaredAmountPaise", "matchedImportMemberId"
        FROM "VerificationRequest" WHERE "id" = ${verificationId} AND "gymId" = ${gymId}
        FOR UPDATE
      `;
      const row = rows[0];
      if (row === undefined) return null;
      return {
        ...row,
        declaredPlanMonths: row.declaredPlanMonths as PlanDurationMonths | null,
        declaredEndDate: fromDbDate(row.declaredEndDate),
      };
    },

    async getMember(memberId: string) {
      return await tx.member.findUniqueOrThrow({ where: { id: memberId }, select: { id: true, memberCode: true, status: true } });
    },

    async findDeclaredImportMembership(memberId: string) {
      const row = await tx.membership.findFirst({
        where: { memberId, source: 'IMPORT', isDeclared: true, status: 'CONFIRMED' },
        orderBy: { endDate: 'desc' },
        select: { id: true, endDate: true },
      });
      return row === null ? null : { id: row.id, endDate: fromDbDate(row.endDate) };
    },

    async updateDeclaredMembership(membershipId, values) {
      await tx.membership.update({
        where: { id: membershipId },
        data: {
          startDate: values.startDate === null ? null : toDbDate(values.startDate),
          endDate: toDbDate(values.endDate),
          durationMonths: values.durationMonths,
        },
      });
    },

    async createDeclaredMembership(record) {
      const created = await tx.membership.create({
        data: {
          gymId: record.gymId,
          memberId: record.memberId,
          durationMonths: record.durationMonths,
          startDate: record.startDate === null ? null : toDbDate(record.startDate),
          endDate: toDbDate(record.endDate),
          pricePaise: record.pricePaise,
          status: 'CONFIRMED',
          source: 'QR_EXISTING',
          isDeclared: true,
          declaredEndDate: toDbDate(record.declaredEndDate),
          createdById: record.createdById,
          confirmedAt: new Date(),
        },
        select: { id: true },
      });
      return created.id;
    },

    async nextCounterValue(gymId: string, key: string) {
      const rows = await tx.$queryRaw<Array<{ value: number }>>`
        INSERT INTO "Counter" ("id", "gymId", "key", "value")
        VALUES (${randomUUID()}, ${gymId}, ${key}, 1)
        ON CONFLICT ("gymId", "key") DO UPDATE SET "value" = "Counter"."value" + 1
        RETURNING "value"
      `;
      const value = rows[0]?.value;
      if (value === undefined) throw new Error('Counter upsert returned no row');
      return value;
    },

    async activateMember(memberId: string, memberCode: string) {
      await tx.member.update({ where: { id: memberId }, data: { status: 'ACTIVE', memberCode, leftAt: null, leftReason: null } });
    },

    async decide(verificationId, values) {
      await tx.verificationRequest.update({
        where: { id: verificationId },
        data:
          values.status === 'APPROVED'
            ? { status: 'APPROVED', decidedById: values.decidedById, decidedAt: values.decidedAt, approvedEndDate: toDbDate(values.approvedEndDate) }
            : { status: 'REJECTED', decidedById: values.decidedById, decidedAt: values.decidedAt, rejectReason: values.rejectReason },
      });
    },

    async closeVerificationCalls(memberId: string, at: Date) {
      await tx.callTask.updateMany({
        where: { memberId, reason: 'VERIFICATION_PENDING', status: 'OPEN' },
        data: { status: 'AUTO_CLOSED', doneAt: at },
      });
    },

    async enqueueOutbox(event) {
      await tx.outboxEvent.create({
        data: { gymId: event.gymId, type: event.type, dedupeKey: event.dedupeKey, payload: event.payload as Prisma.InputJsonValue },
      });
    },

    async writeAudit(entry) {
      await tx.auditLog.create({
        data: {
          gymId: entry.gymId,
          actorType: entry.actorType,
          actorId: entry.actorId,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId,
          after: { ...entry.after },
        },
      });
    },
  };
}

export class PrismaExistingMemberUnitOfWork implements ExistingMemberUnitOfWork {
  readonly #prisma: PrismaClient;
  constructor(prisma: PrismaClient) {
    this.#prisma = prisma;
  }
  transaction<T>(work: (store: ExistingMemberStore) => Promise<T>): Promise<T> {
    return withTransaction(this.#prisma, (tx) => work(existingMemberStore(tx)));
  }
}

export class PrismaVerificationUnitOfWork implements VerificationUnitOfWork {
  readonly #prisma: PrismaClient;
  constructor(prisma: PrismaClient) {
    this.#prisma = prisma;
  }
  transaction<T>(work: (store: VerificationStore) => Promise<T>): Promise<T> {
    return withTransaction(this.#prisma, (tx) => work(verificationStore(tx)));
  }
}

export interface PendingVerification {
  readonly id: string;
  readonly referenceCode: string;
  readonly submittedAt: Date;
  readonly declaredPlanMonths: number | null;
  readonly declaredEndDate: ISTDate;
  readonly declaredAmountPaise: number | null;
  readonly member: { readonly id: string; readonly fullName: string; readonly mobile: string; readonly photoKey: string | null };
  /** What the paper register says, when the member was found in it. */
  readonly register: { readonly endDate: ISTDate; readonly planMonths: number | null; readonly memberCode: string | null } | null;
}

/** The verify queue, oldest first so nobody waits behind a newer scan. */
export class PrismaVerificationQueue {
  readonly #prisma: PrismaClient;
  constructor(prisma: PrismaClient) {
    this.#prisma = prisma;
  }

  async pending(gymId: string, limit = 50): Promise<PendingVerification[]> {
    const rows = await this.#prisma.verificationRequest.findMany({
      where: { gymId, status: 'PENDING', member: { deletedAt: null } },
      orderBy: { createdAt: 'asc' },
      take: limit,
      select: {
        id: true,
        referenceCode: true,
        createdAt: true,
        declaredPlanMonths: true,
        declaredEndDate: true,
        declaredAmountPaise: true,
        matchedImportMemberId: true,
        member: {
          select: {
            id: true,
            fullName: true,
            mobile: true,
            memberCode: true,
            photo: { select: { storageKey: true, deletedAt: true } },
            memberships: {
              where: { source: 'IMPORT', isDeclared: true, status: 'CONFIRMED' },
              orderBy: { endDate: 'desc' },
              take: 1,
              select: { endDate: true, durationMonths: true },
            },
          },
        },
      },
    });

    return rows.map((row) => {
      const registerMembership = row.matchedImportMemberId === null ? undefined : row.member.memberships[0];
      return {
        id: row.id,
        referenceCode: row.referenceCode,
        submittedAt: row.createdAt,
        declaredPlanMonths: row.declaredPlanMonths,
        declaredEndDate: fromDbDate(row.declaredEndDate),
        declaredAmountPaise: row.declaredAmountPaise,
        member: {
          id: row.member.id,
          fullName: row.member.fullName,
          mobile: row.member.mobile,
          photoKey: row.member.photo === null || row.member.photo.deletedAt !== null ? null : row.member.photo.storageKey,
        },
        register:
          registerMembership === undefined
            ? null
            : { endDate: fromDbDate(registerMembership.endDate), planMonths: registerMembership.durationMonths, memberCode: row.member.memberCode },
      };
    });
  }

  async count(gymId: string): Promise<number> {
    return this.#prisma.verificationRequest.count({ where: { gymId, status: 'PENDING', member: { deletedAt: null } } });
  }
}
