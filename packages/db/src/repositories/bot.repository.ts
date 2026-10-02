import type {
  BotConfigInput,
  BotConfigRecord,
  BotDocument,
  BotReplyLogEntry,
  BotSettingsAuditEntry,
  BotSettingsStore,
  BotSettingsUnitOfWork,
  BotStore,
} from '@mfp/core';
import type { Language } from '@mfp/shared';
import type { Prisma } from '../generated/prisma/client';
import { withTransaction, type PrismaClient, type TransactionClient } from '../client';

/**
 * The WhatsApp assistant against the database (ADR-090).
 *
 * A gym with no row has no bot: `loadConfig` returns null rather than a default that is
 * secretly switched on. Turning it on is always something the owner did.
 */

type Db = PrismaClient | TransactionClient;

const asLanguages = (values: readonly string[]): Language[] => values.flatMap((value) => (value === 'hi' || value === 'en' ? [value] : []));

export function botStore(db: Db): BotStore {
  return {
    async loadConfig(gymId: string): Promise<BotConfigRecord | null> {
      const row = await db.botConfig.findUnique({ where: { gymId } });
      if (row === null) return null;
      return {
        botName: row.name,
        isActive: row.isActive,
        autoReply: row.autoReply,
        persona: row.persona,
        languages: asLanguages(row.languages),
        escalationNote: row.escalationNote,
      };
    },

    async loadDocuments(gymId: string): Promise<readonly BotDocument[]> {
      // Oldest first, so the prompt is stable between messages and the cap bites predictably.
      const rows = await db.botDocument.findMany({ where: { gymId }, orderBy: { createdAt: 'asc' }, select: { title: true, body: true } });
      return rows;
    },

    async logReply(entry: BotReplyLogEntry): Promise<void> {
      await db.botReply.create({
        data: {
          gymId: entry.gymId,
          memberId: entry.memberId,
          mobile: entry.mobile,
          question: entry.question.slice(0, 2_000),
          answer: entry.answer === null ? null : entry.answer.slice(0, 4_000),
          status: entry.status,
          reason: entry.reason,
          isTest: entry.isTest,
        },
      });
    },
  };
}

export class PrismaBot implements BotSettingsUnitOfWork {
  readonly #prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.#prisma = prisma;
    this.store = botStore(prisma);
  }

  readonly store: BotStore;

  transaction<T>(work: (store: BotSettingsStore) => Promise<T>): Promise<T> {
    return withTransaction(this.#prisma, (tx) => work(botSettingsStore(tx)));
  }

  /** The config as the screen shows it, with the defaults a gym starts from. */
  async settings(gymId: string) {
    const row = await this.#prisma.botConfig.findUnique({ where: { gymId } });
    return {
      botName: row?.name ?? 'Max',
      isActive: row?.isActive ?? false,
      autoReply: row?.autoReply ?? false,
      persona: row?.persona ?? '',
      languages: asLanguages(row?.languages ?? ['hi', 'en']),
      escalationNote: row?.escalationNote ?? null,
    };
  }

  documents(gymId: string) {
    return this.#prisma.botDocument.findMany({
      where: { gymId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, title: true, body: true, sourceName: true, updatedAt: true },
    });
  }

  /** The log, newest first: what members asked and what the bot did about it. */
  replies(gymId: string, limit = 50) {
    return this.#prisma.botReply.findMany({
      where: { gymId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { id: true, question: true, answer: true, status: true, reason: true, isTest: true, createdAt: true, mobile: true, member: { select: { fullName: true } } },
    });
  }
}

export function botSettingsStore(db: Db): BotSettingsStore {
  return {
    async saveConfig(gymId: string, patch: BotConfigInput): Promise<void> {
      const data = {
        name: patch.botName,
        isActive: patch.isActive,
        autoReply: patch.autoReply,
        persona: patch.persona,
        languages: [...patch.languages],
        escalationNote: patch.escalationNote,
      };
      await db.botConfig.upsert({ where: { gymId }, create: { gymId, ...data }, update: data });
    },

    async upsertDocument(gymId: string, input): Promise<string> {
      if (input.id !== null) {
        const updated = await db.botDocument.update({
          where: { id: input.id },
          data: { title: input.title, body: input.body, sourceName: input.sourceName, updatedById: input.updatedById },
          select: { id: true },
        });
        return updated.id;
      }
      const created = await db.botDocument.create({
        data: { gymId, title: input.title, body: input.body, sourceName: input.sourceName, updatedById: input.updatedById },
        select: { id: true },
      });
      return created.id;
    },

    async findDocument(gymId: string, id: string) {
      return await db.botDocument.findFirst({ where: { id, gymId }, select: { id: true, title: true } });
    },

    async deleteDocument(gymId: string, id: string): Promise<void> {
      await db.botDocument.deleteMany({ where: { id, gymId } });
    },

    async writeAudit(entry: BotSettingsAuditEntry): Promise<void> {
      await db.auditLog.create({
        data: {
          gymId: entry.gymId,
          actorType: entry.actorType,
          actorId: entry.actorId,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId,
          before: entry.before as Prisma.InputJsonValue,
          after: entry.after as Prisma.InputJsonValue,
        },
      });
    },
  };
}
