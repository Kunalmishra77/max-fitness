import type { ReceiptDocument, ReceiptPdfStore } from '@mfp/core';
import { withTransaction, type PrismaClient } from '../client';
import { fromDbDate } from '../dates';

/**
 * Everything a receipt shows (signup-and-payment-flow.md §7): the gym, the member, the
 * plan and dates, the amount and how it was paid. Used by the `/r/[token]` page and the
 * worker's receipt PDF, so the two can never disagree. Only a paid payment has one.
 */

/** The receipt record, as defined by the domain (core `ReceiptDocument`). */
export type ReceiptView = ReceiptDocument;

export class PrismaReceiptReader {
  readonly #prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.#prisma = prisma;
  }

  async receipt(paymentId: string): Promise<ReceiptView | null> {
    const row = await this.#prisma.payment.findUnique({
      where: { id: paymentId },
      select: {
        id: true,
        gymId: true,
        status: true,
        receiptNo: true,
        paidAt: true,
        amountPaise: true,
        method: true,
        receiptMediaId: true,
        gym: { select: { name: true, addressLine: true, city: true, state: true, pincode: true, phone: true } },
        member: { select: { id: true, fullName: true, memberCode: true, mobile: true, language: true } },
        membership: { select: { durationMonths: true, startDate: true, endDate: true, pricePaise: true, admissionPaise: true } },
      },
    });
    if (row?.status !== 'PAID' || row.receiptNo === null || row.paidAt === null) return null;

    const pdf =
      row.receiptMediaId === null
        ? null
        : await this.#prisma.mediaFile.findFirst({ where: { id: row.receiptMediaId, deletedAt: null }, select: { storageKey: true } });

    return {
      paymentId: row.id,
      gymId: row.gymId,
      receiptNo: row.receiptNo,
      paidAt: row.paidAt,
      amountPaise: row.amountPaise,
      method: row.method,
      gym: row.gym,
      member: row.member,
      membership:
        row.membership === null
          ? null
          : {
              durationMonths: row.membership.durationMonths,
              startDate: row.membership.startDate === null ? null : fromDbDate(row.membership.startDate),
              endDate: fromDbDate(row.membership.endDate),
              pricePaise: row.membership.pricePaise,
              admissionPaise: row.membership.admissionPaise,
            },
      receiptPdfKey: pdf?.storageKey ?? null,
    };
  }
}

/** Attaches a rendered receipt PDF to its payment, once (core `attachReceiptPdf`). */
export class PrismaReceiptPdfStore implements ReceiptPdfStore {
  readonly #prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.#prisma = prisma;
  }

  attachReceiptPdf(record: Parameters<ReceiptPdfStore['attachReceiptPdf']>[0]): Promise<boolean> {
    return withTransaction(this.#prisma, async (tx) => {
      const locked = await tx.$queryRaw<Array<{ receiptMediaId: string | null }>>`
        SELECT "receiptMediaId" FROM "Payment" WHERE "id" = ${record.paymentId} FOR UPDATE
      `;
      if (locked[0] === undefined || locked[0].receiptMediaId !== null) return false;

      const media = await tx.mediaFile.create({
        data: {
          gymId: record.gymId,
          memberId: record.memberId,
          kind: 'RECEIPT_PDF',
          storageKey: record.stored.key,
          mimeType: record.stored.mimeType,
          sizeBytes: record.stored.sizeBytes,
          sha256: record.stored.sha256,
        },
        select: { id: true },
      });
      await tx.payment.update({ where: { id: record.paymentId }, data: { receiptMediaId: media.id } });
      return true;
    });
  }
}
