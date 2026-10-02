import type { Clock, Language } from '@mfp/shared';
import { DomainError } from '../errors';
import { assertCan, type CrmActor } from '../crm/permissions';

/**
 * Changing what the assistant is and what it knows (ADR-090).
 *
 * The owner's words become the bot's words — to a member, the bot *is* the gym — so this sits
 * behind the PIN at the same bar as prices, and every change is audited. "Who told the bot
 * that?" is a question somebody will ask the first time it says something odd.
 *
 * The audit records **titles, never bodies**: the body is the gym's own content and lives in
 * its row where it can be read and corrected, and copying it into the audit log would only
 * spread it.
 *
 * The limits are not arbitrary. The persona and every document go into the prompt on every
 * single message, so length here is a cost the gym pays per member question.
 */

export interface BotConfigInput {
  readonly botName: string;
  readonly isActive: boolean;
  readonly autoReply: boolean;
  readonly persona: string;
  readonly languages: readonly Language[];
  readonly escalationNote: string | null;
}

export interface BotDocumentInput {
  /** `null` adds one; an id replaces that one in place. */
  readonly id: string | null;
  readonly title: string;
  readonly body: string;
  readonly sourceName: string | null;
}

export interface BotSettingsAuditEntry {
  readonly gymId: string;
  readonly actorType: 'staff';
  readonly actorId: string;
  readonly action: 'bot.config' | 'bot.document';
  readonly entityType: 'BotConfig' | 'BotDocument';
  readonly entityId: string | null;
  readonly before: Readonly<Record<string, unknown>>;
  readonly after: Readonly<Record<string, unknown>>;
}

export interface BotSettingsStore {
  saveConfig(gymId: string, patch: BotConfigInput): Promise<void>;
  upsertDocument(gymId: string, input: BotDocumentInput & { readonly updatedById: string }): Promise<string>;
  findDocument(gymId: string, id: string): Promise<{ readonly id: string; readonly title: string } | null>;
  deleteDocument(gymId: string, id: string): Promise<void>;
  writeAudit(entry: BotSettingsAuditEntry): Promise<void>;
}

export interface BotSettingsUnitOfWork {
  transaction<T>(work: (store: BotSettingsStore) => Promise<T>): Promise<T>;
}

export interface BotSettingsDeps {
  readonly actor: CrmActor;
  readonly clock: Clock;
  readonly uow: BotSettingsUnitOfWork;
}

const MAX_PERSONA = 4_000;
const MAX_DOCUMENT = 20_000;
const MAX_TITLE = 80;

const refuse = (message: string, field: string): never => {
  throw new DomainError('VALIDATION_FAILED', message, { field });
};

export async function saveBotConfig(input: BotConfigInput, deps: BotSettingsDeps): Promise<void> {
  assertCan(deps.actor, 'settings.manage', deps.clock.now());

  const botName = input.botName.trim();
  if (botName === '' || botName.length > 40) refuse('The assistant needs a name, up to 40 characters', 'botName');
  if (input.persona.length > MAX_PERSONA) refuse('That persona is too long to send with every message', 'persona');
  if (input.languages.length === 0) refuse('Choose at least one language', 'languages');
  if ((input.escalationNote ?? '').length > 300) refuse('That escalation note is too long', 'escalationNote');

  await deps.uow.transaction(async (store) => {
    await store.saveConfig(deps.actor.gymId, { ...input, botName });
    await store.writeAudit({
      gymId: deps.actor.gymId,
      actorType: 'staff',
      actorId: deps.actor.staffUserId,
      action: 'bot.config',
      entityType: 'BotConfig',
      entityId: null,
      before: {},
      // The switches and the name, which are the facts somebody will ask about later. The
      // persona itself lives in the row.
      after: { botName, isActive: input.isActive, autoReply: input.autoReply, languages: [...input.languages] },
    });
  });
}

export async function saveBotDocument(input: BotDocumentInput, deps: BotSettingsDeps): Promise<string> {
  assertCan(deps.actor, 'settings.manage', deps.clock.now());

  const title = input.title.trim();
  const body = input.body.trim();
  if (title === '' || title.length > MAX_TITLE) refuse('Give it a short title', 'title');
  if (body === '') refuse('There is nothing written in it', 'body');
  if (body.length > MAX_DOCUMENT) refuse('That is too long to send with every message — split it up', 'body');

  return deps.uow.transaction(async (store) => {
    const id = await store.upsertDocument(deps.actor.gymId, { ...input, title, body, updatedById: deps.actor.staffUserId });
    await store.writeAudit({
      gymId: deps.actor.gymId,
      actorType: 'staff',
      actorId: deps.actor.staffUserId,
      action: 'bot.document',
      entityType: 'BotDocument',
      entityId: id,
      before: {},
      // Title and size only: the body is the gym's content, not an audit record.
      after: { title, characters: body.length, replaced: input.id !== null },
    });
    return id;
  });
}

export async function deleteBotDocument(input: { readonly id: string }, deps: BotSettingsDeps): Promise<void> {
  assertCan(deps.actor, 'settings.manage', deps.clock.now());

  await deps.uow.transaction(async (store) => {
    const found = await store.findDocument(deps.actor.gymId, input.id);
    if (found === null) throw new DomainError('NOT_FOUND', 'No such document');

    await store.deleteDocument(deps.actor.gymId, input.id);
    await store.writeAudit({
      gymId: deps.actor.gymId,
      actorType: 'staff',
      actorId: deps.actor.staffUserId,
      action: 'bot.document',
      entityType: 'BotDocument',
      entityId: input.id,
      before: { title: found.title },
      after: { deleted: true },
    });
  });
}
