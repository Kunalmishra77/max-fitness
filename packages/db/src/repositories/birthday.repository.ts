import { hasBirthdayToday, type BirthdayWishMember, type BirthdayWishStore } from '@mfp/core';
import type { ISTDate } from '@mfp/shared';
import type { PrismaClient } from '../client';
import { fromDbDate } from '../dates';
import { enqueueOutboxEvent } from './outbox';

/**
 * Today's birthdays, and the wish the desk sends (BR-8).
 *
 * The SQL narrows to the members whose day and month match, plus anyone born on
 * 29 February when today is the 28th; `hasBirthdayToday` then makes the final call,
 * so the leap-day rule has one implementation and the query is only a filter.
 */

export interface BirthdayListItem {
  readonly memberId: string;
  readonly fullName: string;
  readonly memberCode: string | null;
  /** False when the member never agreed to WhatsApp, unsubscribed, or has no number. */
  readonly canWish: boolean;
  /** True once this year's wish is in the message log. */
  readonly wished: boolean;
}

const SELECT = {
  id: true,
  gymId: true,
  fullName: true,
  memberCode: true,
  dob: true,
  status: true,
  language: true,
  whatsappOptIn: true,
  remindersUnsubscribedAt: true,
  mobile: true,
} as const;

export class PrismaBirthdays {
  readonly #prisma: PrismaClient;
  constructor(prisma: PrismaClient) {
    this.#prisma = prisma;
  }

  async today(gymId: string, today: ISTDate): Promise<BirthdayListItem[]> {
    const [year, month, day] = [today.slice(0, 4), Number(today.slice(5, 7)), Number(today.slice(8, 10))];

    const narrowed = await this.#prisma.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "Member"
      WHERE "gymId" = ${gymId} AND "deletedAt" IS NULL AND "status" = 'ACTIVE' AND "dob" IS NOT NULL
        AND (
          (EXTRACT(MONTH FROM "dob") = ${month} AND EXTRACT(DAY FROM "dob") = ${day})
          -- A leap-day member, when today is 28 February (BR-8.1).
          OR (${month} = 2 AND ${day} = 28 AND EXTRACT(MONTH FROM "dob") = 2 AND EXTRACT(DAY FROM "dob") = 29)
        )
    `;
    if (narrowed.length === 0) return [];

    const rows = await this.#prisma.member.findMany({
      where: { id: { in: narrowed.map((row) => row.id) } },
      orderBy: { fullName: 'asc' },
      select: SELECT,
    });
    const birthdays = rows.filter((row) => hasBirthdayToday({ dob: row.dob === null ? null : fromDbDate(row.dob), status: row.status }, today));
    if (birthdays.length === 0) return [];

    const keyFor = (memberId: string) => `birthday:${memberId}:${year}`;
    const sent = await this.#prisma.messageLog.findMany({
      where: { gymId, idempotencyKey: { in: birthdays.map((row) => keyFor(row.id)) } },
      select: { idempotencyKey: true },
    });
    const sentKeys = new Set(sent.map((row) => row.idempotencyKey));

    return birthdays.map((row) => ({
      memberId: row.id,
      fullName: row.fullName,
      memberCode: row.memberCode,
      canWish: row.whatsappOptIn && row.remindersUnsubscribedAt === null && row.mobile.length > 0,
      wished: sentKeys.has(keyFor(row.id)),
    }));
  }

  /** The store the `sendBirthdayWish` service writes through. */
  store(): BirthdayWishStore {
    const prisma = this.#prisma;
    return {
      async member(memberId: string): Promise<BirthdayWishMember | null> {
        const row = await prisma.member.findFirst({ where: { id: memberId, deletedAt: null }, select: SELECT });
        if (row === null) return null;
        return {
          memberId: row.id,
          gymId: row.gymId,
          fullName: row.fullName,
          dob: row.dob === null ? null : fromDbDate(row.dob),
          status: row.status,
          language: row.language,
          whatsappOptIn: row.whatsappOptIn,
          remindersUnsubscribedAt: row.remindersUnsubscribedAt,
          hasMobile: row.mobile.length > 0,
        };
      },

      async alreadySent(idempotencyKey: string): Promise<boolean> {
        return (await prisma.messageLog.count({ where: { idempotencyKey } })) > 0;
      },

      enqueueOutbox(event) {
        return enqueueOutboxEvent(prisma, event);
      },
    };
  }
}
