import type {
  AttendanceEventRecord,
  AttendanceStore,
  AttendanceUnitOfWork,
  CallTaskToRaise,
  MemberForAttendance,
  StoredAttendanceEvent,
} from '@mfp/core';
import { withTransaction, type PrismaClient, type TransactionClient } from '../client';
import { toDbDate } from '../dates';

/**
 * Attendance written from the desk (BR-9.4).
 *
 * `Member.lastAttendanceAt` is maintained here, in the same transaction as the event,
 * because it is what the cooldown is measured from (BR-9.1) and what "not coming" is
 * counted from. Undo rewinds it to the previous visit that still counts, so taking back
 * a mistaken tap does not leave the member looking like they were here.
 */
export class PrismaAttendanceUnitOfWork implements AttendanceUnitOfWork {
  readonly #prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.#prisma = prisma;
  }

  transaction<T>(work: (store: AttendanceStore) => Promise<T>): Promise<T> {
    return withTransaction(this.#prisma, (tx) => work(attendanceStore(tx)));
  }
}

function attendanceStore(tx: TransactionClient): AttendanceStore {
  return {
    async memberForAttendance(gymId: string, memberId: string): Promise<MemberForAttendance | null> {
      return await tx.member.findFirst({
        where: { id: memberId, gymId, deletedAt: null },
        select: { id: true, status: true, lastAttendanceAt: true },
      });
    },

    async hasEventId(clientEventId: string): Promise<boolean> {
      return (await tx.attendanceEvent.count({ where: { clientEventId } })) > 0;
    },

    async createEvent(record: AttendanceEventRecord): Promise<string> {
      const created = await tx.attendanceEvent.create({
        data: {
          gymId: record.gymId,
          memberId: record.memberId,
          clientEventId: record.clientEventId,
          method: record.method,
          capturedAt: record.capturedAt,
          attendanceDate: toDbDate(record.attendanceDate),
          recordedById: record.recordedById,
          feeStateAtCheckIn: record.feeStateAtCheckIn,
        },
        select: { id: true },
      });
      await tx.member.update({ where: { id: record.memberId }, data: { lastAttendanceAt: record.capturedAt } });
      return created.id;
    },

    async raiseCallTask(task: CallTaskToRaise): Promise<boolean> {
      // One OPEN task per member and reason is a partial unique index; `skipDuplicates`
      // turns a second walk-in (or a race) into a no-op rather than an error.
      const { count } = await tx.callTask.createMany({
        data: [
          {
            gymId: task.gymId,
            memberId: task.memberId,
            reason: task.reason,
            priority: task.priority,
            dueDate: toDbDate(task.dueDate),
            status: 'OPEN',
          },
        ],
        skipDuplicates: true,
      });
      return count === 1;
    },

    async loadEvent(gymId: string, eventId: string): Promise<StoredAttendanceEvent | null> {
      return await tx.attendanceEvent.findFirst({
        where: { id: eventId, gymId },
        select: { id: true, gymId: true, memberId: true, voidedAt: true },
      });
    },

    async voidEvent(eventId: string, at: Date): Promise<void> {
      const event = await tx.attendanceEvent.update({ where: { id: eventId }, data: { voidedAt: at }, select: { memberId: true } });

      // Back to the previous visit that still counts, or to "never came" if there is none.
      const previous = await tx.attendanceEvent.findFirst({
        where: { memberId: event.memberId, voidedAt: null },
        orderBy: { capturedAt: 'desc' },
        select: { capturedAt: true },
      });
      await tx.member.update({ where: { id: event.memberId }, data: { lastAttendanceAt: previous?.capturedAt ?? null } });
    },
  };
}
