import { isPlanDuration, type CheckoutStore, type CheckoutUnitOfWork, type Plan } from '@mfp/core';
import type { E164Mobile, PricedGender } from '@mfp/shared';
import { withTransaction, type PrismaClient, type TransactionClient } from '../client';
import { fromDbDate, toDbDate } from '../dates';

/**
 * Prisma implementation of the checkout unit of work.
 *
 * The member row is locked first, so two order requests for the same member (a
 * double-tap, two tabs) run one after the other: the second then finds the first's
 * pending membership and reuses it instead of creating a twin.
 */
export class PrismaCheckoutUnitOfWork implements CheckoutUnitOfWork {
  readonly #prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.#prisma = prisma;
  }

  transaction<T>(work: (store: CheckoutStore) => Promise<T>): Promise<T> {
    return withTransaction(this.#prisma, (tx) => work(storeFor(tx)));
  }
}

function isPricedGender(gender: string): gender is PricedGender {
  return gender === 'MALE' || gender === 'FEMALE';
}

function storeFor(tx: TransactionClient): CheckoutStore {
  return {
    async getMemberForCheckout(memberId) {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "Member" WHERE "id" = ${memberId} AND "deletedAt" IS NULL FOR UPDATE
      `;
      if (locked.length === 0) return null;

      const member = await tx.member.findUniqueOrThrow({
        where: { id: memberId },
        select: { id: true, gymId: true, status: true, gender: true, fullName: true, mobile: true, email: true },
      });
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
      };
    },

    async getPlans(gymId) {
      const rows = await tx.plan.findMany({
        where: { gymId },
        select: { id: true, code: true, durationMonths: true, gender: true, pricePaise: true, isActive: true, sortOrder: true },
      });
      // A row outside the catalogue's shape cannot be sold online; skip it rather than guess.
      return rows.flatMap((row): Plan[] => {
        const { durationMonths, gender } = row;
        if (!isPlanDuration(durationMonths) || !isPricedGender(gender)) return [];
        return [{ ...row, code: row.code as Plan['code'], durationMonths, gender }];
      });
    },

    findReusablePendingMembership(query) {
      return tx.membership.findFirst({
        where: {
          memberId: query.memberId,
          planId: query.planId,
          durationMonths: query.durationMonths,
          startDate: toDbDate(query.startDate),
          endDate: toDbDate(query.endDate),
          pricePaise: query.pricePaise,
          admissionPaise: query.admissionPaise,
          source: query.source,
          status: 'PENDING_PAYMENT',
          createdAt: { gt: query.createdAfter },
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true, createdAt: true },
      });
    },

    createPendingMembership(record) {
      return tx.membership.create({
        data: {
          gymId: record.gymId,
          memberId: record.memberId,
          planId: record.planId,
          durationMonths: record.durationMonths,
          startDate: toDbDate(record.startDate),
          endDate: toDbDate(record.endDate),
          pricePaise: record.pricePaise,
          admissionPaise: record.admissionPaise,
          source: record.source,
          status: 'PENDING_PAYMENT',
        },
        select: { id: true, createdAt: true },
      });
    },

    async createPayment(record) {
      const created = await tx.payment.create({
        data: { ...record, status: 'CREATED' },
        select: { id: true },
      });
      return created.id;
    },

    async setProviderOrderId(paymentId, providerOrderId) {
      await tx.payment.update({ where: { id: paymentId }, data: { providerOrderId } });
    },
  };
}
