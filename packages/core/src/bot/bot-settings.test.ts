import { beforeEach, describe, expect, it } from 'vitest';
import { fakeClockAt } from '../testing/builders';
import type { CrmActor } from '../crm/permissions';
import {
  deleteBotDocument,
  saveBotConfig,
  saveBotDocument,
  type BotConfigInput,
  type BotSettingsAuditEntry,
  type BotSettingsStore,
} from './bot-settings';

/**
 * Changing what the assistant is and knows (ADR-090).
 *
 * The owner's words become the bot's words, so this is the owner's screen behind the PIN —
 * the same bar as prices. Every change is audited, because "who told the bot that?" is a
 * question somebody will ask after it says something odd to a member.
 */

const clock = fakeClockAt('2026-11-03T11:00');
const owner: CrmActor = { staffUserId: 'staff_1', gymId: 'gym_1', role: 'OWNER', elevatedUntil: new Date(clock.now().getTime() + 60_000), receptionMayTakePayments: true };
const ownerWithoutPin: CrmActor = { ...owner, elevatedUntil: null };
const reception: CrmActor = { ...owner, staffUserId: 'staff_2', role: 'RECEPTION' };

class FakeStore implements BotSettingsStore {
  readonly configs: BotConfigInput[] = [];
  readonly documents = new Map<string, { title: string; body: string }>([['doc_1', { title: 'Timings', body: 'Morning 4:30 to 12.' }]]);
  readonly audit: BotSettingsAuditEntry[] = [];

  saveConfig(_gymId: string, patch: BotConfigInput) {
    this.configs.push(patch);
    return Promise.resolve();
  }
  upsertDocument(_gymId: string, input: { id: string | null; title: string; body: string; sourceName: string | null }) {
    const id = input.id ?? `doc_${this.documents.size + 1}`;
    this.documents.set(id, { title: input.title, body: input.body });
    return Promise.resolve(id);
  }
  findDocument(_gymId: string, id: string) {
    const found = this.documents.get(id);
    return Promise.resolve(found === undefined ? null : { id, title: found.title });
  }
  deleteDocument(_gymId: string, id: string) {
    this.documents.delete(id);
    return Promise.resolve();
  }
  writeAudit(entry: BotSettingsAuditEntry) {
    this.audit.push(entry);
    return Promise.resolve();
  }
}

const deps = (store: FakeStore, actor: CrmActor = owner) => ({ actor, clock, uow: { transaction: <T>(work: (s: BotSettingsStore) => Promise<T>) => work(store) } });

describe('saveBotConfig', () => {
  let store: FakeStore;
  beforeEach(() => {
    store = new FakeStore();
  });

  it('saves what the owner set, and records it', async () => {
    await saveBotConfig({ botName: 'Max', isActive: true, autoReply: false, persona: 'Warm and brief.', languages: ['hi'], escalationNote: 'Ring the desk.' }, deps(store));

    expect(store.configs[0]).toMatchObject({ botName: 'Max', isActive: true, autoReply: false, languages: ['hi'] });
    expect(store.audit[0]?.action).toBe('bot.config');
  });

  it('refuses a persona long enough to be a novel, or an empty name', async () => {
    await expect(saveBotConfig({ botName: 'Max', isActive: true, autoReply: true, persona: 'x'.repeat(4_001), languages: ['hi'], escalationNote: null }, deps(store))).rejects.toThrow(
      expect.objectContaining({ code: 'VALIDATION_FAILED' }) as Error,
    );
    await expect(saveBotConfig({ botName: '  ', isActive: true, autoReply: true, persona: '', languages: ['hi'], escalationNote: null }, deps(store))).rejects.toThrow(
      expect.objectContaining({ code: 'VALIDATION_FAILED' }) as Error,
    );
  });

  it('refuses a bot that serves no language at all', async () => {
    await expect(saveBotConfig({ botName: 'Max', isActive: true, autoReply: true, persona: '', languages: [], escalationNote: null }, deps(store))).rejects.toThrow(
      expect.objectContaining({ code: 'VALIDATION_FAILED' }) as Error,
    );
  });

  it('is the owner’s, behind the PIN', async () => {
    const config = { botName: 'Max', isActive: true, autoReply: true, persona: '', languages: ['hi' as const], escalationNote: null };
    await expect(saveBotConfig(config, deps(store, reception))).rejects.toThrow(expect.objectContaining({ code: 'FORBIDDEN' }) as Error);
    await expect(saveBotConfig(config, deps(store, ownerWithoutPin))).rejects.toThrow(expect.objectContaining({ code: 'FORBIDDEN' }) as Error);
  });
});

describe('saveBotDocument', () => {
  let store: FakeStore;
  beforeEach(() => {
    store = new FakeStore();
  });

  it('adds what the gym has written down, and records the title', async () => {
    const id = await saveBotDocument({ id: null, title: 'Locker rules', body: 'Lockers are free, bring your own lock.', sourceName: null }, deps(store));

    expect(store.documents.get(id)?.title).toBe('Locker rules');
    expect(store.audit[0]).toMatchObject({ action: 'bot.document' });
    // The title is auditable; the body is the gym's content and lives in the row.
    expect(JSON.stringify(store.audit[0])).not.toContain('bring your own lock');
  });

  it('replaces one in place when it is given an id', async () => {
    await saveBotDocument({ id: 'doc_1', title: 'Timings', body: 'Morning 4:30 to 12. Evening 5 to 10.', sourceName: null }, deps(store));
    expect(store.documents.size).toBe(1);
    expect(store.documents.get('doc_1')?.body).toContain('Evening');
  });

  it('refuses an empty one, and one too long to put in every prompt', async () => {
    await expect(saveBotDocument({ id: null, title: 'Empty', body: '   ', sourceName: null }, deps(store))).rejects.toThrow(
      expect.objectContaining({ code: 'VALIDATION_FAILED' }) as Error,
    );
    await expect(saveBotDocument({ id: null, title: 'Huge', body: 'x'.repeat(20_001), sourceName: null }, deps(store))).rejects.toThrow(
      expect.objectContaining({ code: 'VALIDATION_FAILED' }) as Error,
    );
  });
});

describe('deleteBotDocument', () => {
  it('removes it and records which one, by title', async () => {
    const store = new FakeStore();
    await deleteBotDocument({ id: 'doc_1' }, deps(store));

    expect(store.documents.has('doc_1')).toBe(false);
    expect(store.audit[0]).toMatchObject({ action: 'bot.document' });
    expect(JSON.stringify(store.audit[0])).toContain('Timings');
  });

  it('is quiet about a document that is already gone', async () => {
    const store = new FakeStore();
    await expect(deleteBotDocument({ id: 'doc_404' }, deps(store))).rejects.toThrow(expect.objectContaining({ code: 'NOT_FOUND' }) as Error);
  });
});
