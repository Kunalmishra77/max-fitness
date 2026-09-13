import type {
  AuditEntry,
  CallOutcomeStore,
  CallOutcomeUnitOfWork,
  CallOutcomeUpdate,
  CallTaskForOutcome,
  MemberLeftUpdate,
  PaymentForVoid,
  VoidPaymentStore,
  VoidPaymentUnitOfWork,
  VoidUpdate,
} from '@mfp/core';
import type { Prisma } from '../generated/prisma/client';
import { withTransaction, type PrismaClient, type TransactionClient } from '../client';
import { toDbDate } from '../dates';

/**
 * The two CRM actions that change a record rather than create one: recording a call
 * outcome (BR-7) and voiding a payment (case P9).
 *
 * Voiding locks the payment row first, so two taps on "void" cannot both succeed and
 * subtract the same money twice from the day's total.
 */

export class PrismaCallOutcomeUnitOfWork implements CallOutcomeUnitOfWork {
  readonly #prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.#prisma = prisma;
  }

  transaction<T>(work: (store: CallOutcomeStore) => Promise<T>): Promise<T> {
    return withTransaction(this.#prisma, (tx) => work(callOutcomeStore(tx)));
  }
}

function callOutcomeStore(tx: TransactionClient): CallOutcomeStore {
  return {
    async loadTask(gymId: string, taskId: string): Promise<CallTaskForOutcome | null> {
      const task = await tx.callTask.findFirst({
        where: { id: taskId, gymId },
        select: { id: true, gymId: true, memberId: true, reason: true, attempts: true, status: true },
      });
      return task;
    },

    async recordOutcome(taskId: string, update: CallOutcomeUpdate): Promise<void> {
      await tx.callTask.update({
        where: { id: taskId },
        data: {
          outcome: update.outcome,
          attempts: update.attempts,
          status: update.status,
          snoozedUntil: update.snoozedUntil === null ? null : toDbDate(update.snoozedUntil),
          note: update.note,
          doneById: update.doneById,
          doneAt: update.doneAt,
        },
      });
    },

    async markMemberLeft(memberId: string, update: MemberLeftUpdate): Promise<void> {
      await tx.member.update({
        where: { id: memberId },
        data: { status: 'LEFT', leftAt: toDbDate(update.leftAt), leftReason: update.leftReason, leftNote: update.leftNote },
      });
    },
  };
}

export class PrismaVoidPaymentUnitOfWork implements VoidPaymentUnitOfWork {
  readonly #prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.#prisma = prisma;
  }

  transaction<T>(work: (store: VoidPaymentStore) => Promise<T>): Promise<T> {
    return withTransaction(this.#prisma, (tx) => work(voidPaymentStore(tx)));
  }
}

function voidPaymentStore(tx: TransactionClient): VoidPaymentStore {
  return {
    async lockPayment(gymId: string, paymentId: string): Promise<PaymentForVoid | null> {
      const rows = await tx.$queryRaw<PaymentForVoid[]>`
        SELECT "id", "gymId", "memberId", "membershipId", "amountPaise", "status"::text AS "status", "receiptNo", "method"::text AS "method"
        FROM "Payment"
        WHERE "id" = ${paymentId} AND "gymId" = ${gymId}
        FOR UPDATE
      `;
      return rows[0] ?? null;
    },

    async voidPayment(paymentId: string, update: VoidUpdate): Promise<void> {
      // The receipt number stays: a receipt that was handed over cannot be un-issued (BR-11.2).
      await tx.payment.update({
        where: { id: paymentId },
        data: { status: 'VOIDED', voidedById: update.voidedById, voidReason: update.voidReason },
      });
    },

    async revertMembership(membershipId: string, at: Date): Promise<void> {
      await tx.membership.update({
        where: { id: membershipId },
        data: { status: 'PENDING_PAYMENT', confirmedAt: null, cancelledAt: at },
      });
    },

    async writeAudit(entry: AuditEntry): Promise<void> {
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
