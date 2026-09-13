import type { SignupNotPaidStore, UnpaidSignup } from '@mfp/core';
import type { PrismaClient } from '../client';
import { toDbDate } from '../dates';

/**
 * Call-task queries for the nightly job (BR-7), scoped to one gym.
 *
 * Creating a task relies on the partial unique index "one OPEN task per member and
 * reason" (database-design.md §3): `skipDuplicates` turns a lost race into a no-op
 * rather than an error.
 */
export class PrismaSignupNotPaidStore implements SignupNotPaidStore {
  readonly #prisma: PrismaClient;
  readonly #gymId: string;

  constructor(prisma: PrismaClient, gymId: string) {
    this.#prisma = prisma;
    this.#gymId = gymId;
  }

  async findUnpaidSignupsWithoutTask(window: { registeredAfter: Date; registeredBefore: Date }): Promise<UnpaidSignup[]> {
    const rows = await this.#prisma.member.findMany({
      where: {
        gymId: this.#gymId,
        status: 'PENDING_PAYMENT',
        source: { in: ['WEBSITE', 'QR_NEW'] },
        deletedAt: null,
        createdAt: { gt: window.registeredAfter, lte: window.registeredBefore },
        callTasks: { none: { reason: 'SIGNUP_NOT_PAID' } },
      },
      select: { id: true, gymId: true, status: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
      take: 500,
    });
    return rows.map((row) => ({ gymId: row.gymId, memberId: row.id, memberStatus: row.status, registeredAt: row.createdAt }));
  }

  async createCallTask(task: Parameters<SignupNotPaidStore['createCallTask']>[0]): Promise<boolean> {
    const { count } = await this.#prisma.callTask.createMany({
      data: [{ gymId: task.gymId, memberId: task.memberId, reason: task.reason, priority: task.priority, dueDate: toDbDate(task.dueDate), status: 'OPEN' }],
      skipDuplicates: true,
    });
    return count === 1;
  }
}
