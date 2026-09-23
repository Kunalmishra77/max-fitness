import type { MessageStatus } from '@mfp/core/ports';
import type { ISTDate } from '@mfp/shared';
import type { PrismaClient } from '../client';
import { fromDbDate, toDbDate } from '../dates';

/**
 * What the reminder jobs need from the database besides the candidates (ADR-062 follows
 * whatsapp-automation-engine §5): the once-per-slot claim, the member's state at the
 * moment of sending, and the status updates that follow a send.
 */

export class PrismaJobRuns {
  readonly #prisma: PrismaClient;
  constructor(prisma: PrismaClient) {
    this.#prisma = prisma;
  }

  /**
   * Claim a run of `jobName` for `runKey`, e.g. `2026-09-23@10:00`.
   *
   * The unique index does the work: a second cron fire, or a catch-up on boot after the
   * slot already ran, finds the row taken and sends nothing (R15, R16).
   */
  async claim(jobName: string, runKey: string, gymId: string | null = null): Promise<boolean> {
    try {
      await this.#prisma.jobRun.create({ data: { jobName, runKey, gymId, status: 'RUNNING' } });
      return true;
    } catch {
      return false;
    }
  }

  async finish(
    jobName: string,
    runKey: string,
    counts: { planned: number; sent: number; skipped: number; failed: number },
    error?: string,
  ): Promise<void> {
    await this.#prisma.jobRun.updateMany({
      where: { jobName, runKey },
      data: {
        status: error === undefined ? 'DONE' : 'FAILED',
        itemsPlanned: counts.planned,
        itemsSent: counts.sent,
        itemsSkipped: counts.skipped,
        itemsFailed: counts.failed,
        finishedAt: new Date(),
        ...(error === undefined ? {} : { error }),
      },
    });
  }

  /** Slots of `today` that have not run yet — what a worker catches up on when it boots. */
  async missingSlots(jobNames: readonly string[], today: ISTDate): Promise<string[]> {
    const rows = await this.#prisma.jobRun.findMany({
      where: { jobName: { in: [...jobNames] }, runKey: { startsWith: `${today}@` } },
      select: { jobName: true },
    });
    const done = new Set(rows.map((row) => row.jobName));
    return jobNames.filter((name) => !done.has(name));
  }
}

/** The member's state in the second before a send (BR-5.3). */
export interface SendContextRow {
  readonly memberStatus: string;
  readonly whatsappOptIn: boolean;
  readonly remindersUnsubscribedAt: Date | null;
  readonly remindersPausedUntil: ISTDate | null;
  readonly hasMobile: boolean;
  readonly latestConfirmedMembershipId: string | null;
  readonly messagesToNumberToday: number;
}

export class PrismaSendContext {
  readonly #prisma: PrismaClient;
  constructor(prisma: PrismaClient) {
    this.#prisma = prisma;
  }

  async load(memberId: string, today: ISTDate): Promise<SendContextRow | null> {
    const member = await this.#prisma.member.findUnique({
      where: { id: memberId },
      select: {
        status: true,
        mobile: true,
        whatsappOptIn: true,
        remindersUnsubscribedAt: true,
        remindersPausedUntil: true,
        deletedAt: true,
        memberships: {
          where: { status: 'CONFIRMED' },
          orderBy: { endDate: 'desc' },
          take: 1,
          select: { id: true },
        },
      },
    });
    if (member === null || member.deletedAt !== null) return null;

    // The day's count for this number, families included (BR-5.6).
    const messagesToNumberToday = await this.#prisma.messageLog.count({
      where: { toNumber: member.mobile, direction: 'OUTBOUND', purpose: 'REMINDER', businessDate: toDbDate(today), status: { in: ['QUEUED', 'SENT', 'DELIVERED', 'READ', 'SIMULATED'] } },
    });

    return {
      memberStatus: member.status,
      whatsappOptIn: member.whatsappOptIn,
      remindersUnsubscribedAt: member.remindersUnsubscribedAt,
      remindersPausedUntil: member.remindersPausedUntil === null ? null : fromDbDate(member.remindersPausedUntil),
      hasMobile: member.mobile.length > 0,
      latestConfirmedMembershipId: member.memberships[0]?.id ?? null,
      messagesToNumberToday,
    };
  }
}

/** Status updates keyed by the send's own idempotency key, before any provider id exists. */
export class PrismaMessageLogUpdates {
  readonly #prisma: PrismaClient;
  constructor(prisma: PrismaClient) {
    this.#prisma = prisma;
  }

  async updateByIdempotencyKey(
    idempotencyKey: string,
    status: MessageStatus,
    fields: { providerMessageId?: string | null; errorCode?: string | null; errorMessage?: string | null; bodyPreview?: string | null } = {},
  ): Promise<void> {
    await this.#prisma.messageLog.updateMany({
      where: { idempotencyKey },
      data: {
        status,
        ...(status === 'SENT' ? { sentAt: new Date() } : {}),
        ...(fields.providerMessageId === undefined ? {} : { providerMessageId: fields.providerMessageId }),
        ...(fields.errorCode === undefined ? {} : { errorCode: fields.errorCode }),
        ...(fields.errorMessage === undefined ? {} : { errorMessage: fields.errorMessage }),
        ...(fields.bodyPreview === undefined ? {} : { bodyPreview: fields.bodyPreview }),
      },
    });
  }
}
