import type { E164Mobile, ISTDate, Language } from '@mfp/shared';
import type { PrismaClient } from '../client';
import { fromDbDate } from '../dates';

/**
 * What the transactional messages need to say (whatsapp-automation-engine §8).
 *
 * One read per message: the worker loads a row, the core builds the words, the provider
 * sends. Nothing here decides whether to send — that is the outbox's and the message
 * log's job.
 */

export interface ReceiptData {
  readonly memberId: string;
  readonly firstName: string;
  readonly language: Language;
  readonly mobile: E164Mobile;
  readonly amountPaise: number;
  readonly durationMonths: number;
  readonly startDate: ISTDate;
  readonly endDate: ISTDate;
  readonly receiptNo: string;
  readonly membershipId: string;
}

export interface MemberMessageData {
  readonly memberId: string;
  readonly firstName: string;
  readonly language: Language;
  readonly mobile: E164Mobile;
  readonly memberCode: string | null;
  readonly endDate: ISTDate | null;
}

const firstNameOf = (fullName: string) => fullName.trim().split(/\s+/)[0] ?? fullName;

export class PrismaMessageData {
  readonly #prisma: PrismaClient;
  constructor(prisma: PrismaClient) {
    this.#prisma = prisma;
  }

  /** A paid payment with its membership and member; `null` when it is not payable news. */
  async receipt(paymentId: string): Promise<ReceiptData | null> {
    const payment = await this.#prisma.payment.findUnique({
      where: { id: paymentId },
      select: {
        amountPaise: true,
        receiptNo: true,
        status: true,
        membership: { select: { id: true, durationMonths: true, startDate: true, endDate: true } },
        member: { select: { id: true, fullName: true, language: true, mobile: true, deletedAt: true } },
      },
    });
    if (payment === null || payment.status !== 'PAID' || payment.receiptNo === null) return null;
    if (payment.member === null || payment.member.deletedAt !== null || payment.membership === null || payment.membership.startDate === null) return null;
    // A membership without a duration is a declared one from the paper register; a receipt
    // is only ever sent for a plan the desk or the website sold.
    if (payment.membership.durationMonths === null) return null;

    return {
      memberId: payment.member.id,
      firstName: firstNameOf(payment.member.fullName),
      language: payment.member.language as Language,
      mobile: payment.member.mobile as E164Mobile,
      amountPaise: payment.amountPaise,
      durationMonths: payment.membership.durationMonths,
      startDate: fromDbDate(payment.membership.startDate),
      endDate: fromDbDate(payment.membership.endDate),
      receiptNo: payment.receiptNo,
      membershipId: payment.membership.id,
    };
  }

  /** A member and the end date of their latest confirmed membership. */
  async member(memberId: string): Promise<MemberMessageData | null> {
    const member = await this.#prisma.member.findFirst({
      where: { id: memberId, deletedAt: null },
      select: {
        id: true,
        fullName: true,
        language: true,
        mobile: true,
        memberCode: true,
        memberships: { where: { status: 'CONFIRMED' }, orderBy: { endDate: 'desc' }, take: 1, select: { endDate: true } },
      },
    });
    if (member === null) return null;

    return {
      memberId: member.id,
      firstName: firstNameOf(member.fullName),
      language: member.language as Language,
      mobile: member.mobile as E164Mobile,
      memberCode: member.memberCode,
      endDate: member.memberships[0] === undefined ? null : fromDbDate(member.memberships[0].endDate),
    };
  }

  /** Whether this is the member's first confirmed membership — the welcome goes only then. */
  async isFirstMembership(memberId: string, membershipId: string): Promise<boolean> {
    const older = await this.#prisma.membership.count({
      where: { memberId, status: 'CONFIRMED', id: { not: membershipId } },
    });
    return older === 0;
  }

  /** The verification request behind an approval, for the confirmation message. */
  async verification(verificationId: string): Promise<{ memberId: string } | null> {
    return this.#prisma.verificationRequest.findUnique({ where: { id: verificationId }, select: { memberId: true } });
  }
}
