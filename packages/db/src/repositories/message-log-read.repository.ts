import type { MessagePurpose, MessageStatus } from '@mfp/core/ports';
import type { PrismaClient } from '../client';

/**
 * The message log as the owner reads it (crm-module-spec §8; whatsapp-automation-engine §10).
 *
 * The owner's question is never "what did the provider return" but "did Anita get her
 * reminder, and if not, why" — so a row carries the member, the purpose, what the message
 * said, how far it got, and the reason it stopped.
 */

export interface MessageLogRow {
  readonly id: string;
  readonly memberId: string | null;
  readonly memberName: string | null;
  readonly direction: 'OUTBOUND' | 'INBOUND';
  readonly purpose: MessagePurpose;
  readonly status: MessageStatus;
  readonly templateName: string | null;
  readonly ruleCode: string | null;
  readonly bodyPreview: string | null;
  readonly errorCode: string | null;
  readonly createdAt: Date;
  readonly sentAt: Date | null;
  readonly deliveredAt: Date | null;
  readonly readAt: Date | null;
}

const SELECT = {
  id: true,
  memberId: true,
  direction: true,
  purpose: true,
  status: true,
  templateName: true,
  ruleCode: true,
  bodyPreview: true,
  errorCode: true,
  createdAt: true,
  sentAt: true,
  deliveredAt: true,
  readAt: true,
  member: { select: { fullName: true } },
} as const;

type Row = {
  id: string;
  memberId: string | null;
  direction: string;
  purpose: string;
  status: string;
  templateName: string | null;
  ruleCode: string | null;
  bodyPreview: string | null;
  errorCode: string | null;
  createdAt: Date;
  sentAt: Date | null;
  deliveredAt: Date | null;
  readAt: Date | null;
  member: { fullName: string } | null;
};

const view = (row: Row): MessageLogRow => ({
  id: row.id,
  memberId: row.memberId,
  memberName: row.member?.fullName ?? null,
  direction: row.direction as 'OUTBOUND' | 'INBOUND',
  purpose: row.purpose as MessagePurpose,
  status: row.status as MessageStatus,
  templateName: row.templateName,
  ruleCode: row.ruleCode,
  bodyPreview: row.bodyPreview,
  errorCode: row.errorCode,
  createdAt: row.createdAt,
  sentAt: row.sentAt,
  deliveredAt: row.deliveredAt,
  readAt: row.readAt,
});

export class PrismaMessageLogReader {
  readonly #prisma: PrismaClient;
  constructor(prisma: PrismaClient) {
    this.#prisma = prisma;
  }

  /** The gym's messages, newest first, optionally narrowed to one member or one state. */
  async list(gymId: string, filter: { memberId?: string; status?: MessageStatus; limit?: number } = {}): Promise<MessageLogRow[]> {
    const rows = await this.#prisma.messageLog.findMany({
      where: {
        gymId,
        ...(filter.memberId === undefined ? {} : { memberId: filter.memberId }),
        ...(filter.status === undefined ? {} : { status: filter.status }),
      },
      orderBy: { createdAt: 'desc' },
      take: filter.limit ?? 100,
      select: SELECT,
    });
    return rows.map((row) => view(row as Row));
  }

  /** How many of each state today, for the line above the list. */
  async countsToday(gymId: string, since: Date): Promise<Record<string, number>> {
    const rows = await this.#prisma.messageLog.groupBy({
      by: ['status'],
      where: { gymId, createdAt: { gte: since } },
      _count: { _all: true },
    });
    return Object.fromEntries(rows.map((row) => [row.status, row._count._all]));
  }
}
