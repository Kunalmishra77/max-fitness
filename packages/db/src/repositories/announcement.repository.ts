import type { AnnouncementAudience, AnnouncementMember, AnnouncementRecord, AnnouncementStore, OutboxEventInput } from '@mfp/core';
import type { Language } from '@mfp/shared';
import { withTransaction, type PrismaClient, type TransactionClient } from '../client';
import type { Prisma } from '../generated/prisma/client';

/**
 * The owner's announcements (ADR-079).
 *
 * The audience is read inside the same transaction that queues the messages, so a member
 * who joins mid-send is either in it or not in it, never half of both. Eligibility is
 * checked again when each message is actually sent (CLAUDE.md §2.6) — somebody can
 * unsubscribe in the seconds between.
 */

export interface AnnouncementListItem {
  readonly id: string;
  readonly textEn: string;
  readonly textHi: string;
  readonly audience: string;
  readonly recipientCount: number;
  readonly sentAt: Date;
  readonly byName: string;
  /** How many of those messages have actually left, from the message log. */
  readonly sent: number;
}

/** What one member needs for the message, read when the worker sends it. */
export interface AnnouncementForMember {
  readonly textEn: string;
  readonly textHi: string;
  readonly member: { readonly firstName: string; readonly language: Language; readonly mobile: string } | null;
  /** False when the member has since unsubscribed, opted out, or lost their number. */
  readonly stillEligible: boolean;
}

const AUDIENCE_WHERE: Record<AnnouncementAudience, Prisma.MemberWhereInput> = {
  ACTIVE: { status: 'ACTIVE' },
  // Everyone on the register who is still a member of it — not the erased.
  EVERYONE: { status: { notIn: ['LEFT'] } },
};

function storeFor(tx: TransactionClient): AnnouncementStore {
  return {
    async audience(gymId: string, audience: AnnouncementAudience): Promise<readonly AnnouncementMember[]> {
      const rows = await tx.member.findMany({
        where: { gymId, deletedAt: null, ...AUDIENCE_WHERE[audience] },
        orderBy: { createdAt: 'asc' },
        select: { id: true, language: true, whatsappOptIn: true, remindersUnsubscribedAt: true, mobile: true },
      });
      return rows.map((row) => ({
        memberId: row.id,
        language: row.language,
        whatsappOptIn: row.whatsappOptIn,
        remindersUnsubscribedAt: row.remindersUnsubscribedAt,
        hasMobile: row.mobile.length > 0,
      }));
    },

    async create(record: AnnouncementRecord): Promise<string> {
      const created = await tx.announcement.create({
        data: {
          gymId: record.gymId,
          textEn: record.textEn,
          textHi: record.textHi,
          audience: record.audience,
          createdById: record.createdById,
          recipientCount: record.recipientCount,
          sentAt: record.sentAt,
        },
        select: { id: true },
      });
      return created.id;
    },

    async enqueueOutbox(events: readonly OutboxEventInput[]): Promise<void> {
      if (events.length === 0) return;
      await tx.outboxEvent.createMany({
        data: events.map((event) => ({
          gymId: event.gymId,
          type: event.type,
          payload: event.payload as Prisma.InputJsonValue,
          dedupeKey: event.dedupeKey,
        })),
        skipDuplicates: true,
      });
    },
  };
}

export class PrismaAnnouncementUnitOfWork {
  readonly #prisma: PrismaClient;
  constructor(prisma: PrismaClient) {
    this.#prisma = prisma;
  }
  /** Generous, because one announcement writes a row per member (ADR-079). */
  transaction<T>(work: (store: AnnouncementStore) => Promise<T>): Promise<T> {
    return withTransaction(this.#prisma, (tx) => work(storeFor(tx)), { timeoutMs: 30_000 });
  }
}

export class PrismaAnnouncements {
  readonly #prisma: PrismaClient;
  constructor(prisma: PrismaClient) {
    this.#prisma = prisma;
  }

  /** How many members would get one right now, for the count shown before sending. */
  async reachableCount(gymId: string, audience: AnnouncementAudience): Promise<{ reachable: number; total: number }> {
    const where = { gymId, deletedAt: null, ...AUDIENCE_WHERE[audience] };
    const [total, reachable] = await Promise.all([
      this.#prisma.member.count({ where }),
      this.#prisma.member.count({ where: { ...where, whatsappOptIn: true, remindersUnsubscribedAt: null, mobile: { not: '' } } }),
    ]);
    return { reachable, total };
  }

  async recent(gymId: string, limit = 20): Promise<AnnouncementListItem[]> {
    const rows = await this.#prisma.announcement.findMany({
      where: { gymId },
      orderBy: { sentAt: 'desc' },
      take: limit,
      select: { id: true, textEn: true, textHi: true, audience: true, recipientCount: true, sentAt: true, createdBy: { select: { name: true } } },
    });
    if (rows.length === 0) return [];

    // How many actually left, counted from the log rather than assumed from the plan.
    const sent = await this.#prisma.messageLog.groupBy({
      by: ['idempotencyKey'],
      where: { gymId, purpose: 'ANNOUNCEMENT', status: { in: ['SENT', 'DELIVERED', 'READ', 'SIMULATED'] } },
      _count: { idempotencyKey: true },
    });
    const sentPerAnnouncement = new Map<string, number>();
    for (const row of sent) {
      // "announcement:<announcementId>:<memberId>" — the middle part is the one we want.
      const id = row.idempotencyKey?.split(':')[1];
      if (id !== undefined) sentPerAnnouncement.set(id, (sentPerAnnouncement.get(id) ?? 0) + 1);
    }

    return rows.map((row) => ({
      id: row.id,
      textEn: row.textEn,
      textHi: row.textHi,
      audience: row.audience,
      recipientCount: row.recipientCount,
      sentAt: row.sentAt,
      byName: row.createdBy.name,
      sent: sentPerAnnouncement.get(row.id) ?? 0,
    }));
  }

  /** The latest one, for the line every member of staff sees when they sign in. */
  async latest(gymId: string): Promise<AnnouncementListItem | null> {
    return (await this.recent(gymId, 1))[0] ?? null;
  }

  /** What the worker needs to send one member their copy, checked again at send time. */
  async forMember(announcementId: string, memberId: string): Promise<AnnouncementForMember | null> {
    const announcement = await this.#prisma.announcement.findUnique({
      where: { id: announcementId },
      select: { textEn: true, textHi: true },
    });
    if (announcement === null) return null;

    const member = await this.#prisma.member.findFirst({
      where: { id: memberId, deletedAt: null },
      select: { fullName: true, language: true, mobile: true, whatsappOptIn: true, remindersUnsubscribedAt: true },
    });
    if (member === null) return { ...announcement, member: null, stillEligible: false };

    return {
      ...announcement,
      member: { firstName: member.fullName.split(' ')[0] ?? member.fullName, language: member.language, mobile: member.mobile },
      stillEligible: member.whatsappOptIn && member.remindersUnsubscribedAt === null && member.mobile.length > 0,
    };
  }
}
