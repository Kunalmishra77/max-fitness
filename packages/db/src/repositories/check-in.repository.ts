import type { CheckInStore, LookupMember } from '@mfp/core';
import type { FeeState, ISTDate } from '@mfp/shared';
import type { PrismaClient } from '../client';
import { toDbDate } from '../dates';

/**
 * The reception tablet's two questions (BR-9).
 *
 * "Who is this number?" and "mark them in". Both read fee state from the same
 * `member_fee_at` read model the CRM reads, so the tablet and the desk can never
 * disagree about whether somebody's fees have run out.
 */

type Row = {
  memberId: string;
  fullName: string;
  memberCode: string | null;
  mobile: string;
  status: string;
  photoKey: string | null;
  feeState: string;
  daysLeft: number | null;
};

const view = (row: Row): LookupMember => ({
  memberId: row.memberId,
  fullName: row.fullName,
  memberCode: row.memberCode,
  mobile: row.mobile,
  status: row.status as LookupMember['status'],
  photoKey: row.photoKey,
  feeState: row.feeState as FeeState,
  daysLeft: row.daysLeft,
});

export class PrismaCheckIn {
  readonly #prisma: PrismaClient;
  constructor(prisma: PrismaClient) {
    this.#prisma = prisma;
  }

  /**
   * Members on a whole mobile number, or one member code.
   *
   * The narrowing is done in SQL by exact match — never a prefix — so the query
   * itself cannot be turned into a way of listing the gym's members.
   */
  async lookup(gymId: string, today: ISTDate, query: { mobile?: string; memberCode?: string }): Promise<LookupMember[]> {
    const mobile = query.mobile ?? '';
    const memberCode = query.memberCode ?? '';
    if (mobile === '' && memberCode === '') return [];

    const rows = await this.#prisma.$queryRaw<Row[]>`
      SELECT m."id"            AS "memberId",
             m."fullName"      AS "fullName",
             m."memberCode"    AS "memberCode",
             m."mobile"        AS "mobile",
             m."status"        AS "status",
             media."storageKey" AS "photoKey",
             f."feeState"      AS "feeState",
             f."daysLeft"      AS "daysLeft"
      FROM "Member" m
      LEFT JOIN "MediaFile" media ON media."id" = m."photoMediaId" AND media."deletedAt" IS NULL
      LEFT JOIN "member_fee_at"(${toDbDate(today)}::date) f ON f."memberId" = m."id"
      WHERE m."gymId" = ${gymId}
        AND m."deletedAt" IS NULL
        AND (
          (${mobile} <> '' AND m."mobile" = ${mobile})
          OR (${memberCode} <> '' AND upper(m."memberCode") = upper(${memberCode}))
        )
      ORDER BY m."createdAt"
      LIMIT 8
    `;
    return rows.map(view);
  }

  /** The store `selfCheckIn` writes through, in one transaction. */
  unitOfWork(today: ISTDate) {
    const prisma = this.#prisma;
    return {
      transaction<T>(work: (store: CheckInStore) => Promise<T>): Promise<T> {
        return prisma.$transaction(async (tx) => {
          const store: CheckInStore = {
            async memberForCheckIn(gymId, memberId) {
              const rows = await tx.$queryRaw<Array<Row & { lastAttendanceAt: Date | null }>>`
                SELECT m."id"             AS "memberId",
                       m."fullName"       AS "fullName",
                       m."memberCode"     AS "memberCode",
                       m."mobile"         AS "mobile",
                       m."status"         AS "status",
                       NULL               AS "photoKey",
                       f."feeState"       AS "feeState",
                       f."daysLeft"       AS "daysLeft",
                       m."lastAttendanceAt" AS "lastAttendanceAt"
                FROM "Member" m
                LEFT JOIN "member_fee_at"(${toDbDate(today)}::date) f ON f."memberId" = m."id"
                WHERE m."id" = ${memberId} AND m."gymId" = ${gymId} AND m."deletedAt" IS NULL
                LIMIT 1
              `;
              const row = rows[0];
              return row === undefined ? null : { ...view(row), lastAttendanceAt: row.lastAttendanceAt };
            },

            async hasEventId(clientEventId) {
              return (await tx.attendanceEvent.count({ where: { clientEventId } })) > 0;
            },

            async createEvent(record) {
              const created = await tx.attendanceEvent.create({
                data: {
                  gymId: record.gymId,
                  memberId: record.memberId,
                  clientEventId: record.clientEventId,
                  method: record.method,
                  capturedAt: record.capturedAt,
                  attendanceDate: toDbDate(record.attendanceDate),
                  feeStateAtCheckIn: record.feeStateAtCheckIn,
                },
                select: { id: true },
              });
              // The member's own row is what the cooldown reads next time.
              await tx.member.update({ where: { id: record.memberId }, data: { lastAttendanceAt: record.capturedAt } });
              return created.id;
            },

            async raiseCallTask(task) {
              // One open task per member and reason; a second visit adds nothing.
              const open = await tx.callTask.count({ where: { memberId: task.memberId, reason: task.reason, status: 'OPEN' } });
              if (open > 0) return false;
              await tx.callTask.create({
                data: { gymId: task.gymId, memberId: task.memberId, reason: task.reason, priority: task.priority, status: 'OPEN', dueDate: toDbDate(task.dueDate) },
              });
              return true;
            },
          };

          return work(store);
        });
      },
    };
  }
}
