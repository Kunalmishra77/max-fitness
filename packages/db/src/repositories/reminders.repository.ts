import type { ReminderCandidate, ReminderRule } from '@mfp/core';
import type { E164Mobile, ISTDate, Language, ReminderRuleCode, WhatsAppTemplateName } from '@mfp/shared';
import type { PrismaClient } from '../client';
import { fromDbDate, toDbDate } from '../dates';

/**
 * Who a slot could message, asked of the database at the moment the slot runs
 * (database-design §4.2; whatsapp-automation-engine §5; ADR-002).
 *
 * The query narrows by the things SQL knows best — the fee read model, the member's
 * own switches, the rules' day windows — and the engine decides the rest. It does not
 * decide *what* to send: two overlapping rules come back as two rows and `planSlot`
 * picks one, so the choice is tested without a database.
 */

export interface CandidateRow extends ReminderCandidate {
  /** The rule whose window this row fell in; the engine re-derives it and may prefer another. */
  readonly ruleCode: ReminderRuleCode;
}

export class PrismaReminderRules {
  readonly #prisma: PrismaClient;
  constructor(prisma: PrismaClient) {
    this.#prisma = prisma;
  }

  /** Every rule of the gym, enabled or not; the engine skips the disabled ones. */
  async all(gymId: string): Promise<ReminderRule[]> {
    const rows = await this.#prisma.reminderRule.findMany({
      where: { gymId },
      orderBy: { offsetDays: 'asc' },
      select: { code: true, offsetDays: true, offsetDaysTo: true, slots: true, templateName: true, isEnabled: true },
    });
    return rows.map((row) => ({
      code: row.code as ReminderRuleCode,
      offsetDays: row.offsetDays,
      offsetDaysTo: row.offsetDaysTo,
      slots: row.slots,
      templateName: row.templateName as WhatsAppTemplateName,
      isEnabled: row.isEnabled,
    }));
  }

  /** The distinct slot times the worker has to register a cron for. */
  async slots(gymId: string): Promise<string[]> {
    const rules = await this.all(gymId);
    return [...new Set(rules.filter((rule) => rule.isEnabled).flatMap((rule) => rule.slots))].sort();
  }
}

export class PrismaReminderCandidates {
  readonly #prisma: PrismaClient;
  constructor(prisma: PrismaClient) {
    this.#prisma = prisma;
  }

  /**
   * Members whose membership sits inside an enabled rule's window at this slot.
   *
   * A member who left, opted out, unsubscribed or is paused never comes back, so a
   * bug in the engine cannot message them. An uncapped POST rule is capped here at a
   * hundred thousand days, which is the SQL's way of saying "no limit" without a
   * branch (database-design §4.2).
   */
  async forSlot(gymId: string, today: ISTDate, slot: string): Promise<CandidateRow[]> {
    const rows = await this.#prisma.$queryRaw<
      Array<{
        memberId: string;
        membershipId: string;
        firstName: string;
        mobile: string;
        language: string;
        endDate: Date;
        ruleCode: string;
      }>
    >`
      SELECT f."memberId"                                  AS "memberId",
             f."latestMembershipId"                        AS "membershipId",
             split_part(trim(mem."fullName"), ' ', 1)      AS "firstName",
             mem."mobile"                                  AS "mobile",
             mem."language"                                AS "language",
             f."effectiveEndDate"                          AS "endDate",
             r."code"                                      AS "ruleCode"
      FROM "member_fee_at"(${toDbDate(today)}::date) f
      JOIN "Member" mem ON mem."id" = f."memberId"
      JOIN "ReminderRule" r ON r."gymId" = f."gymId" AND r."isEnabled" AND ${slot} = ANY(r."slots")
      WHERE f."gymId" = ${gymId}
        AND mem."deletedAt" IS NULL
        AND mem."status" = 'ACTIVE'
        AND mem."whatsappOptIn" = true
        AND mem."remindersUnsubscribedAt" IS NULL
        AND (mem."remindersPausedUntil" IS NULL OR mem."remindersPausedUntil" < ${toDbDate(today)}::date)
        AND f."latestMembershipId" IS NOT NULL
        AND (${toDbDate(today)}::date - f."effectiveEndDate")
            BETWEEN r."offsetDays"
            AND COALESCE(r."offsetDaysTo", CASE WHEN r."code" = 'POST' THEN 100000 ELSE r."offsetDays" END)
      ORDER BY mem."mobile", mem."createdAt", f."memberId"
    `;

    return rows.map((row) => ({
      memberId: row.memberId,
      membershipId: row.membershipId,
      firstName: row.firstName,
      mobile: row.mobile as E164Mobile,
      language: row.language as Language,
      endDate: fromDbDate(row.endDate),
      ruleCode: row.ruleCode as ReminderRuleCode,
    }));
  }
}
