import { GymSettingsSchema, isISTTime, slotsOutsideQuietHours, type Clock } from '@mfp/shared';
import { DomainError } from '../errors';
import { assertCan, type CrmActor } from './permissions';
import type { SettingsStore } from './settings';

/**
 * Reminder times (crm-ux-blueprint §14; BR-5.1, BR-5.2; ADR-052).
 *
 * The owner decides when each reminder goes out, switches one off, and sets how many
 * days after expiry reminders keep coming. The times are on `ReminderRule`. The
 * post-expiry cap is in settings **and** on the POST rule's `offsetDaysTo`, which is what
 * the engine reads (ADR-015) — so both change in one transaction, and the settings
 * screen's general save refuses the cap on its own.
 *
 * A time outside quiet hours is refused here (case R18). The engine would skip it
 * anyway; refusing it at the screen means the owner learns now, not from silence.
 */

export interface ReminderRuleRow {
  readonly code: string;
  readonly offsetDays: number;
  readonly offsetDaysTo: number | null;
  readonly slots: readonly string[];
  readonly isEnabled: boolean;
}

export interface ReminderRuleUpdate {
  readonly code: string;
  readonly slots: readonly string[];
  readonly isEnabled: boolean;
}

export interface ReminderSettingsStore extends Pick<SettingsStore, 'loadSettings' | 'saveSettings' | 'writeAudit'> {
  loadReminderRules(gymId: string): Promise<readonly ReminderRuleRow[]>;
  saveReminderRule(
    gymId: string,
    code: string,
    values: { readonly slots: readonly string[]; readonly isEnabled: boolean; readonly offsetDaysTo: number | null },
  ): Promise<void>;
}

export interface ReminderSettingsUnitOfWork {
  transaction<T>(work: (store: ReminderSettingsStore) => Promise<T>): Promise<T>;
}

/** More than three a day is nagging, not reminding. */
export const MAX_REMINDER_SLOTS = 3;
/** BR-5.2. "No limit" is not offered on the screen: it keeps messaging people who left. */
export const MIN_POST_EXPIRY_DAYS = 1;
export const MAX_POST_EXPIRY_DAYS = 60;

const invalid = (message: string, field: string) => new DomainError('VALIDATION_FAILED', message, { field });

export async function updateReminderSettings(
  input: { readonly rules: readonly ReminderRuleUpdate[]; readonly postExpiryMaxDays: number },
  deps: { readonly actor: CrmActor; readonly clock: Clock; readonly uow: ReminderSettingsUnitOfWork },
): Promise<{ readonly changed: boolean }> {
  assertCan(deps.actor, 'settings.manage', deps.clock.now());

  const days = input.postExpiryMaxDays;
  if (!Number.isInteger(days) || days < MIN_POST_EXPIRY_DAYS || days > MAX_POST_EXPIRY_DAYS) {
    throw invalid(`Days after expiry are a whole number from ${MIN_POST_EXPIRY_DAYS} to ${MAX_POST_EXPIRY_DAYS}`, 'postExpiryMaxDays');
  }

  const updates = input.rules.map((rule) => {
    const field = `rules.${rule.code}.slots`;
    const slots = [...rule.slots].sort();
    if (slots.length === 0 || slots.length > MAX_REMINDER_SLOTS) throw invalid(`A reminder has one to ${MAX_REMINDER_SLOTS} times`, field);
    if (!slots.every(isISTTime)) throw invalid('A reminder time is HH:mm', field);
    if (new Set(slots).size !== slots.length) throw invalid('The same time is listed twice', field);
    return { ...rule, slots };
  });

  return deps.uow.transaction(async (store) => {
    const stored = GymSettingsSchema.safeParse(await store.loadSettings(deps.actor.gymId));
    if (!stored.success) throw new DomainError('CONFLICT', 'The stored settings are not valid; fix them before editing');
    const current = stored.data;

    for (const rule of updates) {
      if (slotsOutsideQuietHours(rule.slots, current.reminders.quietHours).length > 0) {
        throw invalid(`Reminder times must be between ${current.reminders.quietHours.start} and ${current.reminders.quietHours.end}`, `rules.${rule.code}.slots`);
      }
    }

    const rows = new Map((await store.loadReminderRules(deps.actor.gymId)).map((row) => [row.code, row]));
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    const writes: Array<{ code: string; slots: readonly string[]; isEnabled: boolean; offsetDaysTo: number | null }> = [];

    for (const rule of updates) {
      const row = rows.get(rule.code);
      if (row === undefined) throw new DomainError('NOT_FOUND', 'No such reminder', { code: rule.code });
      const offsetDaysTo = rule.code === 'POST' ? days : row.offsetDaysTo;
      const timesOrSwitchChanged = rule.isEnabled !== row.isEnabled || JSON.stringify(rule.slots) !== JSON.stringify([...row.slots].sort());
      if (timesOrSwitchChanged) {
        before[rule.code] = { slots: row.slots, isEnabled: row.isEnabled };
        after[rule.code] = { slots: rule.slots, isEnabled: rule.isEnabled };
      }
      if (timesOrSwitchChanged || offsetDaysTo !== row.offsetDaysTo) {
        writes.push({ code: rule.code, slots: rule.slots, isEnabled: rule.isEnabled, offsetDaysTo });
      }
    }

    const capChanged = current.reminders.postExpiryMaxDays !== days;
    if (writes.length === 0 && !capChanged) return { changed: false };

    for (const { code, ...values } of writes) await store.saveReminderRule(deps.actor.gymId, code, values);
    if (capChanged) {
      before['postExpiryMaxDays'] = current.reminders.postExpiryMaxDays;
      after['postExpiryMaxDays'] = days;
      await store.saveSettings(deps.actor.gymId, GymSettingsSchema.parse({ ...current, reminders: { ...current.reminders, postExpiryMaxDays: days } }));
    }
    await store.writeAudit({
      gymId: deps.actor.gymId,
      actorType: 'staff',
      actorId: deps.actor.staffUserId,
      action: 'reminders.update',
      entityType: 'ReminderRule',
      entityId: null,
      before,
      after,
    });
    return { changed: true };
  });
}
