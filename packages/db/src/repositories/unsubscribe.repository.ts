import type { UnsubscribeStore } from '@mfp/core';
import type { ISTDate } from '@mfp/shared';
import type { Prisma } from '../generated/prisma/client';
import { withTransaction, type PrismaClient, type TransactionClient } from '../client';
import { toDbDate } from '../dates';

/**
 * The unsubscribe and restart transaction (BR-6.2; whatsapp-automation-engine §7).
 *
 * Everything the tap causes happens in one transaction, and the member update is
 * conditional — `remindersUnsubscribedAt IS NULL` — so two taps arriving together
 * produce one call task, one alert and one audit row.
 */
function store(tx: TransactionClient, gymId: string): UnsubscribeStore {
  return {
    async findMember(forGym: string, memberId: string) {
      const row = await tx.member.findFirst({
        where: { id: memberId, gymId: forGym, deletedAt: null },
        select: { id: true, status: true, remindersUnsubscribedAt: true, leftAt: true },
      });
      return row === null ? null : { id: row.id, status: row.status, remindersUnsubscribedAt: row.remindersUnsubscribedAt, leftAt: row.leftAt === null ? null : row.leftAt.toISOString().slice(0, 10) };
    },

    async markUnsubscribed(memberId: string, at: Date, leftOn: ISTDate) {
      const { count } = await tx.member.updateMany({
        where: { id: memberId, gymId, remindersUnsubscribedAt: null },
        data: { remindersUnsubscribedAt: at, status: 'LEFT', leftReason: 'WHATSAPP_UNSUBSCRIBE', leftAt: toDbDate(leftOn) },
      });
      return count === 1;
    },

    async markResubscribed(memberId: string) {
      const { count } = await tx.member.updateMany({
        where: { id: memberId, gymId, remindersUnsubscribedAt: { not: null } },
        data: { remindersUnsubscribedAt: null, status: 'ACTIVE', leftReason: null, leftAt: null },
      });
      return count === 1;
    },

    async createCallTask(task) {
      // BR-7: at most one open task per member and reason.
      const open = await tx.callTask.count({ where: { gymId, memberId: task.memberId, reason: task.reason, status: 'OPEN' } });
      if (open > 0) return;
      await tx.callTask.create({
        data: { gymId, memberId: task.memberId, reason: task.reason, priority: task.priority, dueDate: toDbDate(task.dueDate), status: 'OPEN' },
      });
    },

    async createAlert(type, memberId) {
      await tx.alert.create({ data: { gymId, memberId, type, title: 'alert.memberUnsubscribed', params: { memberId } } });
    },

    async writeAudit(entry) {
      await tx.auditLog.create({
        data: { gymId, actorType: entry.actorType, actorId: null, action: entry.action, entityType: 'Member', entityId: entry.memberId },
      });
    },

    async enqueueOutbox(event) {
      await tx.outboxEvent.createMany({
        data: [{ gymId, type: event.type, dedupeKey: event.dedupeKey, payload: event.payload as Prisma.InputJsonValue, status: 'PENDING' }],
        skipDuplicates: true,
      });
    },
  };
}

export class PrismaUnsubscribeUnitOfWork {
  readonly #prisma: PrismaClient;
  readonly #gymId: string;

  constructor(prisma: PrismaClient, gymId: string) {
    this.#prisma = prisma;
    this.#gymId = gymId;
  }

  transaction<T>(work: (store: UnsubscribeStore) => Promise<T>): Promise<T> {
    return withTransaction(this.#prisma, (tx) => work(store(tx, this.#gymId)));
  }
}
