import { beforeEach, describe, expect, it } from 'vitest';
import { defaultGymSettings, type GymSettings } from '@mfp/shared';
import { fakeClockAt } from '../testing/builders';
import type { CrmActor } from './permissions';
import { updateReminderSettings, type ReminderRuleRow, type ReminderRuleUpdate, type ReminderSettingsStore } from './reminder-settings';
import type { SettingsAuditEntry } from './settings';

/**
 * Reminder times (crm-ux-blueprint §14; BR-5.1, BR-5.2; ADR-052).
 *
 * The owner picks when each reminder goes out, switches a reminder off, and sets how
 * many days after expiry reminders keep coming. The times live on `ReminderRule`; the
 * post-expiry cap lives in settings **and** on the POST rule, which is the one the engine
 * reads (ADR-015), so both are written in one transaction. A time outside quiet hours is
 * refused here rather than silently skipped by the engine later (case R18).
 */

const clock = fakeClockAt('2026-09-15T11:00');
const owner: CrmActor = {
  staffUserId: 'staff_1',
  gymId: 'gym_1',
  role: 'OWNER',
  elevatedUntil: new Date(clock.now().getTime() + 60_000),
  receptionMayTakePayments: true,
};
const ownerWithoutPin: CrmActor = { ...owner, elevatedUntil: null };
const reception: CrmActor = { ...owner, staffUserId: 'staff_2', role: 'RECEPTION' };

class FakeStore implements ReminderSettingsStore {
  settings: unknown = defaultGymSettings();
  rules: ReminderRuleRow[] = [
    { code: 'PRE_7', offsetDays: -7, offsetDaysTo: -7, slots: ['10:00'], isEnabled: true },
    { code: 'DUE_TODAY', offsetDays: 0, offsetDaysTo: 0, slots: ['10:00', '18:00'], isEnabled: true },
    { code: 'POST', offsetDays: 1, offsetDaysTo: 7, slots: ['10:00', '19:00'], isEnabled: true },
  ];
  readonly saved: GymSettings[] = [];
  readonly ruleWrites: Array<{ code: string; slots: readonly string[]; isEnabled: boolean; offsetDaysTo: number | null }> = [];
  readonly audit: SettingsAuditEntry[] = [];

  loadSettings() {
    return Promise.resolve(this.settings);
  }
  saveSettings(_gymId: string, settings: GymSettings) {
    this.saved.push(settings);
    return Promise.resolve();
  }
  loadReminderRules() {
    return Promise.resolve(this.rules);
  }
  saveReminderRule(_gymId: string, code: string, values: { slots: readonly string[]; isEnabled: boolean; offsetDaysTo: number | null }) {
    this.ruleWrites.push({ code, ...values });
    return Promise.resolve();
  }
  writeAudit(entry: SettingsAuditEntry) {
    this.audit.push(entry);
    return Promise.resolve();
  }
}

const unchanged: ReminderRuleUpdate[] = [
  { code: 'PRE_7', slots: ['10:00'], isEnabled: true },
  { code: 'DUE_TODAY', slots: ['10:00', '18:00'], isEnabled: true },
  { code: 'POST', slots: ['10:00', '19:00'], isEnabled: true },
];

describe('updateReminderSettings', () => {
  let store: FakeStore;
  beforeEach(() => {
    store = new FakeStore();
  });
  const save = (rules: ReminderRuleUpdate[], postExpiryMaxDays = 7, actor = owner) =>
    updateReminderSettings({ rules, postExpiryMaxDays }, { actor, clock, uow: { transaction: (work) => work(store) } });

  it('moves a reminder time and switches a reminder off, writing only the rules that changed', async () => {
    const result = await save([
      { code: 'PRE_7', slots: ['11:30'], isEnabled: true },
      { code: 'DUE_TODAY', slots: ['18:00', '10:00'], isEnabled: false },
      { code: 'POST', slots: ['10:00', '19:00'], isEnabled: true },
    ]);

    expect(result).toEqual({ changed: true });
    // Times are kept in order, so "18:00, 10:00" and "10:00, 18:00" are the same setting.
    expect(store.ruleWrites).toEqual([
      { code: 'PRE_7', slots: ['11:30'], isEnabled: true, offsetDaysTo: -7 },
      { code: 'DUE_TODAY', slots: ['10:00', '18:00'], isEnabled: false, offsetDaysTo: 0 },
    ]);
    expect(store.saved).toHaveLength(0);
    expect(store.audit).toEqual([
      {
        gymId: 'gym_1',
        actorType: 'staff',
        actorId: 'staff_1',
        action: 'reminders.update',
        entityType: 'ReminderRule',
        entityId: null,
        before: { PRE_7: { slots: ['10:00'], isEnabled: true }, DUE_TODAY: { slots: ['10:00', '18:00'], isEnabled: true } },
        after: { PRE_7: { slots: ['11:30'], isEnabled: true }, DUE_TODAY: { slots: ['10:00', '18:00'], isEnabled: false } },
      },
    ]);
  });

  it('sets the days after expiry in settings and on the POST rule together (ADR-015)', async () => {
    await save(unchanged, 10);

    expect(store.saved).toHaveLength(1);
    expect(store.saved[0]?.reminders.postExpiryMaxDays).toBe(10);
    expect(store.ruleWrites).toEqual([{ code: 'POST', slots: ['10:00', '19:00'], isEnabled: true, offsetDaysTo: 10 }]);
    expect(store.audit[0]).toMatchObject({ before: { postExpiryMaxDays: 7 }, after: { postExpiryMaxDays: 10 } });
  });

  it('refuses a time outside quiet hours, naming the rule, and writes nothing (case R18)', async () => {
    await expect(save([{ code: 'PRE_7', slots: ['22:00'], isEnabled: true }, ...unchanged.slice(1)])).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      meta: { field: 'rules.PRE_7.slots' },
    });
    expect(store.ruleWrites).toHaveLength(0);
    expect(store.audit).toHaveLength(0);
  });

  it('refuses a time that is not a time, a reminder with no time, more than three times, and the same time twice', async () => {
    for (const slots of [['25:00'], [], ['09:00', '12:00', '15:00', '18:00'], ['10:00', '10:00']]) {
      await expect(save([{ code: 'PRE_7', slots, isEnabled: true }, ...unchanged.slice(1)])).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
        meta: { field: 'rules.PRE_7.slots' },
      });
    }
    expect(store.ruleWrites).toHaveLength(0);
  });

  it('refuses days after expiry outside 1 to 60', async () => {
    for (const days of [0, 61, 2.5]) {
      await expect(save(unchanged, days)).rejects.toMatchObject({ code: 'VALIDATION_FAILED', meta: { field: 'postExpiryMaxDays' } });
    }
    expect(store.saved).toHaveLength(0);
  });

  it('refuses a reminder the gym does not have', async () => {
    await expect(save([{ code: 'PRE_30', slots: ['10:00'], isEnabled: true }])).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(store.ruleWrites).toHaveLength(0);
  });

  it('writes and records nothing when nothing changed', async () => {
    expect(await save(unchanged, 7)).toEqual({ changed: false });
    expect(store.ruleWrites).toHaveLength(0);
    expect(store.saved).toHaveLength(0);
    expect(store.audit).toHaveLength(0);
  });

  it('needs the owner, with a PIN entered a moment ago', async () => {
    await expect(save(unchanged, 10, ownerWithoutPin)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(save(unchanged, 10, reception)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(store.saved).toHaveLength(0);
  });
});
