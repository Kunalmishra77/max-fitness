import { randomUUID } from 'node:crypto';
import type { ImportAuditEntry, ImportedMemberRecord, MemberImportStore, MemberImportUnitOfWork } from '@mfp/core';
import type { E164Mobile } from '@mfp/shared';
import { withTransaction, type PrismaClient, type TransactionClient } from '../client';
import { toDbDate } from '../dates';

/**
 * The paper register, written in bulk (crm-module-spec §7; ADR-056).
 *
 * Up to 2,000 rows arrive at once, so each table is written with one `createMany`
 * rather than a round trip per member, and the member codes are reserved as one block
 * in a single statement. Ids are made here, so memberships and consents can point at
 * their members without reading anything back.
 */

type Db = PrismaClient | TransactionClient;

/** Long enough for the largest file over the transaction pooler (ADR-010). */
const IMPORT_TIMEOUT_MS = 60_000;

function memberImportStore(db: Db): MemberImportStore {
  return {
    async findMembersByMobile(gymId: string, mobiles: readonly E164Mobile[]) {
      const rows = await db.member.findMany({
        where: { gymId, mobile: { in: [...mobiles] }, deletedAt: null },
        select: { mobile: true, fullName: true },
      });
      return rows.map((row) => ({ mobile: row.mobile as E164Mobile, fullName: row.fullName }));
    },

    async reserveCounterBlock(gymId: string, key: string, count: number): Promise<number> {
      const rows = await db.$queryRaw<Array<{ value: number }>>`
        INSERT INTO "Counter" ("id", "gymId", "key", "value")
        VALUES (${randomUUID()}, ${gymId}, ${key}, ${count})
        ON CONFLICT ("gymId", "key") DO UPDATE SET "value" = "Counter"."value" + ${count}
        RETURNING "value"
      `;
      const last = rows[0]?.value;
      if (last === undefined) throw new Error('Counter upsert returned no row');
      return last - count + 1;
    },

    async insertImportedMembers(records: readonly ImportedMemberRecord[]): Promise<void> {
      const now = new Date();
      const withIds = records.map((record) => ({ record, memberId: randomUUID() }));

      await db.member.createMany({
        data: withIds.map(({ record, memberId }) => ({
          id: memberId,
          gymId: record.gymId,
          memberCode: record.memberCode,
          fullName: record.fullName,
          mobile: record.mobile,
          email: record.email,
          dob: record.dob === null ? null : toDbDate(record.dob),
          gender: record.gender,
          language: 'hi' as const,
          status: 'ACTIVE' as const,
          source: 'IMPORT' as const,
          isMinor: record.isMinor,
          whatsappOptIn: record.whatsappOptIn,
          faceConsent: false,
          notes: record.notes,
          createdById: record.createdById,
        })),
      });

      await db.membership.createMany({
        data: withIds.map(({ record, memberId }) => ({
          id: randomUUID(),
          gymId: record.gymId,
          memberId,
          durationMonths: record.membership.durationMonths,
          startDate: record.membership.startDate === null ? null : toDbDate(record.membership.startDate),
          endDate: toDbDate(record.membership.endDate),
          pricePaise: record.membership.pricePaise,
          status: 'CONFIRMED' as const,
          source: 'IMPORT' as const,
          isDeclared: true,
          declaredEndDate: toDbDate(record.membership.endDate),
          createdById: record.createdById,
          confirmedAt: now,
        })),
      });

      const consents = withIds.flatMap(({ record, memberId }) =>
        record.whatsappConsent === null
          ? []
          : [
              {
                id: randomUUID(),
                gymId: record.gymId,
                memberId,
                type: 'WHATSAPP_UPDATES' as const,
                granted: true,
                noticeVersion: record.whatsappConsent.noticeVersion,
                // The owner confirmed it for these members at the desk.
                channel: 'crm_desk',
                recordedById: record.createdById,
              },
            ],
      );
      if (consents.length > 0) await db.consent.createMany({ data: consents });
    },

    async writeAudit(entry: ImportAuditEntry): Promise<void> {
      await db.auditLog.create({
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

/** The preview reads through `reader`; the commit runs in `transaction`. */
export class PrismaMemberImport implements MemberImportUnitOfWork {
  readonly #prisma: PrismaClient;
  readonly reader: Pick<MemberImportStore, 'findMembersByMobile'>;

  constructor(prisma: PrismaClient) {
    this.#prisma = prisma;
    this.reader = memberImportStore(prisma);
  }

  transaction<T>(work: (store: MemberImportStore) => Promise<T>): Promise<T> {
    return withTransaction(this.#prisma, (tx) => work(memberImportStore(tx)), { timeoutMs: IMPORT_TIMEOUT_MS });
  }
}
