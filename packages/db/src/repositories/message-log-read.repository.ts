import type { MessagePurpose, MessageStatus } from '@mfp/core/ports';
import type { PrismaClient } from '../client';

/**
 * The message log as the owner reads it (crm-module-spec §8; whatsapp-automation-engine §10).
 *
 * The owner's question is never "what did the provider return" but "did Anita get her
 * reminder, and if not, why" — so a row carries the member, the purpose, what the message
 * said, how far it got, and the reason it stopped.
 */

/** One member's thread, as the Messages screen lists it (ADR-091). */
export interface MessageConversation {
  readonly memberId: string;
  readonly memberName: string | null;
  readonly lastAt: Date;
  readonly lastPreview: string | null;
  readonly lastDirection: 'OUTBOUND' | 'INBOUND';
  readonly lastStatus: MessageStatus;
  readonly messages: number;
  /** True when the member has written back: that is where a person may be needed. */
  readonly hasInbound: boolean;
}

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

  /**
   * One line per member, newest first: who was last written to, what it said, and how many
   * messages that conversation holds (ADR-091).
   *
   * The log read as one long list answered "what went out today" and nothing about any one
   * person. A gym thinks in people — "what have we sent Suresh?" — so the screen opens on the
   * conversations and the full list is still a tap away.
   */
  async conversations(gymId: string, limit = 50): Promise<MessageConversation[]> {
    const rows = await this.#prisma.messageLog.findMany({
      where: { gymId, memberId: { not: null } },
      orderBy: { createdAt: 'desc' },
      // Enough recent messages to build a page of conversations without a second query.
      take: 600,
      select: { memberId: true, createdAt: true, direction: true, bodyPreview: true, status: true, member: { select: { fullName: true } } },
    });

    const byMember = new Map<string, MessageConversation>();
    for (const row of rows) {
      if (row.memberId === null) continue;
      const existing = byMember.get(row.memberId);
      if (existing === undefined) {
        byMember.set(row.memberId, {
          memberId: row.memberId,
          memberName: row.member?.fullName ?? null,
          lastAt: row.createdAt,
          lastPreview: row.bodyPreview,
          lastDirection: row.direction === 'INBOUND' ? 'INBOUND' : 'OUTBOUND',
          lastStatus: row.status as MessageStatus,
          messages: 1,
          // A member who wrote back is where a person is needed; that sorts to the top.
          hasInbound: row.direction === 'INBOUND',
        });
        continue;
      }
      byMember.set(row.memberId, { ...existing, messages: existing.messages + 1, hasInbound: existing.hasInbound || row.direction === 'INBOUND' });
    }

    return [...byMember.values()]
      .sort((a, b) => Number(b.hasInbound) - Number(a.hasInbound) || b.lastAt.getTime() - a.lastAt.getTime())
      .slice(0, limit);
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
