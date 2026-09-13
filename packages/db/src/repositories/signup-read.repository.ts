import type { ISTDate, Gender, MemberStatus } from '@mfp/shared';
import type { PaymentRecordStatus } from '@mfp/core';
import type { PrismaClient } from '../client';
import { fromDbDate } from '../dates';

/**
 * Read models for the public sign-up and renewal pages.
 *
 * Plain reads outside any transaction, shaped for what a member may see about their
 * own payment: a status, a receipt number and dates. Never another member's data, and
 * never the provider ids or failure details the CRM uses.
 */

/** What the confirmation page shows while it waits (api-specification.md `/checkout/status`). */
export type PublicPaymentStatus = 'PAID' | 'PENDING' | 'FAILED' | 'NEEDS_REVIEW';

export function publicPaymentStatus(status: PaymentRecordStatus, failureReason: string | null): PublicPaymentStatus {
  switch (status) {
    case 'PAID':
      return 'PAID';
    case 'CREATED':
      return failureReason === 'AMOUNT_MISMATCH' ? 'NEEDS_REVIEW' : 'PENDING';
    case 'FAILED':
    case 'VOIDED':
    case 'REFUNDED':
      return 'FAILED';
  }
}

export interface PaymentSummary {
  readonly paymentId: string;
  readonly memberId: string;
  readonly status: PublicPaymentStatus;
  readonly amountPaise: number;
  readonly receiptNo: string | null;
  readonly memberCode: string | null;
  readonly membership: { readonly startDate: ISTDate | null; readonly endDate: ISTDate; readonly durationMonths: number | null } | null;
}

export interface RenewalSubject {
  readonly id: string;
  readonly gymId: string;
  readonly firstName: string;
  readonly gender: Gender;
  readonly status: MemberStatus;
  readonly latestConfirmedEndDate: ISTDate | null;
  /** Storage key of the member's selfie, for a signed URL. */
  readonly photoKey: string | null;
}

const PAYMENT_SUMMARY_SELECT = {
  id: true,
  memberId: true,
  status: true,
  failureReason: true,
  amountPaise: true,
  receiptNo: true,
  member: { select: { memberCode: true } },
  membership: { select: { startDate: true, endDate: true, durationMonths: true } },
} as const;

export class PrismaSignupReader {
  readonly #prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.#prisma = prisma;
  }

  async paymentById(paymentId: string): Promise<PaymentSummary | null> {
    const row = await this.#prisma.payment.findUnique({ where: { id: paymentId }, select: PAYMENT_SUMMARY_SELECT });
    return row === null ? null : toSummary(row);
  }

  async paymentByOrderId(providerOrderId: string): Promise<PaymentSummary | null> {
    const row = await this.#prisma.payment.findUnique({ where: { providerOrderId }, select: PAYMENT_SUMMARY_SELECT });
    return row === null ? null : toSummary(row);
  }

  async renewalSubject(memberId: string): Promise<RenewalSubject | null> {
    const member = await this.#prisma.member.findFirst({
      where: { id: memberId, deletedAt: null },
      select: { id: true, gymId: true, fullName: true, gender: true, status: true, photo: { select: { storageKey: true, deletedAt: true } } },
    });
    if (member === null) return null;

    const latest = await this.#prisma.membership.aggregate({
      where: { memberId, status: 'CONFIRMED' },
      _max: { endDate: true },
    });
    return {
      id: member.id,
      gymId: member.gymId,
      // A renew page greets by first name only (privacy plan §2: show no more than needed).
      firstName: member.fullName.trim().split(/\s+/)[0] ?? member.fullName,
      gender: member.gender,
      status: member.status,
      photoKey: member.photo === null || member.photo.deletedAt !== null ? null : member.photo.storageKey,
      latestConfirmedEndDate: latest._max.endDate === null ? null : fromDbDate(latest._max.endDate),
    };
  }
}

function toSummary(row: {
  id: string;
  memberId: string;
  status: PaymentRecordStatus;
  failureReason: string | null;
  amountPaise: number;
  receiptNo: string | null;
  member: { memberCode: string | null };
  membership: { startDate: Date | null; endDate: Date; durationMonths: number | null } | null;
}): PaymentSummary {
  return {
    paymentId: row.id,
    memberId: row.memberId,
    status: publicPaymentStatus(row.status, row.failureReason),
    amountPaise: row.amountPaise,
    receiptNo: row.receiptNo,
    memberCode: row.member.memberCode,
    membership:
      row.membership === null
        ? null
        : {
            startDate: row.membership.startDate === null ? null : fromDbDate(row.membership.startDate),
            endDate: fromDbDate(row.membership.endDate),
            durationMonths: row.membership.durationMonths,
          },
  };
}
