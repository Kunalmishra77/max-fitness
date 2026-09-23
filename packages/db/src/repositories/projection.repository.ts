import type { ProjectionMember } from '@mfp/core';
import type { E164Mobile, ISTDate, Language, MemberStatus } from '@mfp/shared';
import type { PrismaClient } from '../client';
import { fromDbDate, toDbDate } from '../dates';

/**
 * Everyone the next month's forecast has to consider (whatsapp-automation-engine §10).
 *
 * One query, not one per day: a forecast assumes nothing changes, so each member's
 * latest membership and its end date are read once from the same `member_fee_at` read
 * model the live slot query uses, and the core walks the calendar from there.
 *
 * Unlike the live query this does **not** filter out members who cannot be messaged.
 * The forecast is a screen the owner reads, and "nobody at all on the 3rd" is a
 * different answer from "these four, but none of them agreed to WhatsApp".
 */

type Row = {
  memberId: string;
  membershipId: string;
  firstName: string;
  mobile: string;
  language: string;
  endDate: Date;
  status: string;
  whatsappOptIn: boolean;
  remindersUnsubscribedAt: Date | null;
  remindersPausedUntil: Date | null;
  latestMembershipId: string | null;
};

export class PrismaReminderProjection {
  readonly #prisma: PrismaClient;
  constructor(prisma: PrismaClient) {
    this.#prisma = prisma;
  }

  async members(gymId: string, today: ISTDate, limit = 2000): Promise<ProjectionMember[]> {
    const rows = await this.#prisma.$queryRaw<Row[]>`
      SELECT f."memberId"                             AS "memberId",
             f."latestMembershipId"                   AS "membershipId",
             split_part(trim(mem."fullName"), ' ', 1) AS "firstName",
             mem."mobile"                             AS "mobile",
             mem."language"                           AS "language",
             f."effectiveEndDate"                     AS "endDate",
             mem."status"                             AS "status",
             mem."whatsappOptIn"                      AS "whatsappOptIn",
             mem."remindersUnsubscribedAt"            AS "remindersUnsubscribedAt",
             mem."remindersPausedUntil"               AS "remindersPausedUntil",
             f."latestMembershipId"                   AS "latestMembershipId"
      FROM "member_fee_at"(${toDbDate(today)}::date) f
      JOIN "Member" mem ON mem."id" = f."memberId"
      WHERE f."gymId" = ${gymId}
        AND mem."deletedAt" IS NULL
        AND f."latestMembershipId" IS NOT NULL
        AND f."effectiveEndDate" IS NOT NULL
      ORDER BY f."effectiveEndDate", mem."mobile", mem."createdAt"
      LIMIT ${limit}
    `;

    return rows.map((row) => ({
      memberId: row.memberId,
      membershipId: row.membershipId,
      firstName: row.firstName,
      mobile: row.mobile as E164Mobile,
      language: row.language as Language,
      endDate: fromDbDate(row.endDate),
      status: row.status as MemberStatus,
      whatsappOptIn: row.whatsappOptIn,
      remindersUnsubscribedAt: row.remindersUnsubscribedAt,
      remindersPausedUntil: row.remindersPausedUntil === null ? null : fromDbDate(row.remindersPausedUntil),
      latestConfirmedMembershipId: row.latestMembershipId,
    }));
  }
}
