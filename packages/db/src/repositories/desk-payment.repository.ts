import { randomUUID } from 'node:crypto';
import type { DeskPaymentStore, DeskPaymentUnitOfWork, MemberForCheckout, Plan } from '@mfp/core';
import type { E164Mobile } from '@mfp/shared';
import { withTransaction, type PrismaClient, type TransactionClient } from '../client';
import { fromDbDate, toDbDate } from '../dates';
import { enqueueOutboxEvent } from './outbox';

/**
 * Taking fees at the desk, in one transaction (crm-ux-blueprint §6).
 *
 * The same counter lock as an online payment, so the receipt series stays one gapless
 * series whether the money came through Razorpay or across the counter (BR-11.2).
 */
export class PrismaDeskPaymentUnitOfWork implements DeskPaymentUnitOfWork {
  readonly #prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.#prisma = prisma;
  }

  transaction<T>(work: (store: DeskPaymentStore) => Promise<T>): Promise<T> {
    return withTransaction(this.#prisma, (tx) => work(storeFor(tx)));
  }
}

function isPricedGender(gender: string): gender is 'MALE' | 'FEMALE' {
  return gender === 'MALE' || gender === 'FEMALE';
}

function storeFor(tx: TransactionClient): DeskPaymentStore {
  return {
    async getMemberForDesk(memberId) {
      const member = await tx.member.findFirst({
        where: { id: memberId, deletedAt: null },
        select: { id: true, gymId: true, status: true, gender: true, fullName: true, mobile: true, email: true },
      });
      if (member === null) return null;

      const confirmed = await tx.membership.aggregate({
        where: { memberId, status: 'CONFIRMED' },
        _count: { _all: true },
        _max: { endDate: true },
      });
      return {
        ...member,
        mobile: member.mobile as E164Mobile,
        hasConfirmedMembership: confirmed._count._all > 0,
        latestConfirmedEndDate: confirmed._max.endDate === null ? null : fromDbDate(confirmed._max.endDate),
      } satisfies MemberForCheckout;
    },

    async getPlans(gymId) {
      const rows = await tx.plan.findMany({
        where: { gymId },
        select: { id: true, code: true, durationMonths: true, gender: true, pricePaise: true, isActive: true, sortOrder: true },
      });
      return rows.flatMap((row): Plan[] =>
        isPricedGender(row.gender) && [1, 3, 6, 12].includes(row.durationMonths)
          ? [{ ...row, code: row.code as Plan['code'], durationMonths: row.durationMonths as Plan['durationMonths'], gender: row.gender }]
          : [],
      );
    },

    async nextCounterValue(gymId, key) {
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

    async createConfirmedMembership(record) {
      const created = await tx.membership.create({
        data: {
          gymId: record.gymId,
          memberId: record.memberId,
          planId: record.planId,
          durationMonths: record.durationMonths,
          startDate: toDbDate(record.startDate),
          endDate: toDbDate(record.endDate),
          pricePaise: record.pricePaise,
          admissionPaise: record.admissionPaise,
          discountPaise: record.discountPaise,
          discountReason: record.discountReason,
          status: 'CONFIRMED',
          source: record.source,
          createdById: record.createdById,
          confirmedAt: record.confirmedAt,
        },
        select: { id: true },
      });
      return created.id;
    },

    async createPaidPayment(record) {
      const created = await tx.payment.create({
        data: {
          gymId: record.gymId,
          memberId: record.memberId,
          membershipId: record.membershipId,
          amountPaise: record.amountPaise,
          method: record.method,
          status: 'PAID',
          receiptNo: record.receiptNo,
          paidAt: record.paidAt,
          recordedById: record.recordedById,
        },
        select: { id: true },
      });
      return created.id;
    },

    getMember(memberId) {
      return tx.member.findUniqueOrThrow({ where: { id: memberId }, select: { id: true, memberCode: true } });
    },

    async activateMember(memberId, memberCode) {
      await tx.member.update({
        where: { id: memberId },
        data: { status: 'ACTIVE', memberCode, leftAt: null, leftReason: null },
      });
    },

    async closeOpenCallTasks(memberId, reasons, closedAt) {
      await tx.callTask.updateMany({
        where: { memberId, status: 'OPEN', reason: { in: [...reasons] as never } },
        data: { status: 'AUTO_CLOSED', doneAt: closedAt },
      });
    },

    enqueueOutbox(event) {
      return enqueueOutboxEvent(tx, event);
    },
  };
}
