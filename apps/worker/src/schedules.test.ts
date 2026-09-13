import { describe, expect, it } from 'vitest';
import { ALL_REMINDER_SLOTS } from '@mfp/shared';
import { EVENT_QUEUES, REMINDER_SLOTS, SCHEDULES, reminderQueueName, runKeyFor } from './schedules';

/**
 * pg-boss 12 refuses any queue name outside this character set, at boot. The worker
 * once crashed on `reminder-slot:09:30`; this catches that class of mistake in CI.
 */
const PG_BOSS_NAME = /^[A-Za-z0-9_./-]+$/;
const CRON_FIELDS = /^(\S+\s+){4}\S+$/;

const allNames = [...SCHEDULES, ...EVENT_QUEUES].map((s) => s.name);

describe('worker schedules', () => {
  it('uses only queue names pg-boss accepts', () => {
    for (const name of allNames) {
      expect(name, name).toMatch(PG_BOSS_NAME);
    }
  });

  it('never registers two queues under the same name', () => {
    expect(new Set(allNames).size).toBe(allNames.length);
  });

  it('turns a slot into a valid queue name', () => {
    expect(reminderQueueName('09:30')).toBe('reminder-slot-0930');
    expect(reminderQueueName('19:00')).toBe('reminder-slot-1900');
  });

  it('schedules one reminder evaluation per BR-5.1 slot, at that IST time', () => {
    const reminders = SCHEDULES.filter((s) => s.name.startsWith('reminder-slot-'));
    expect(reminders.map((s) => s.cron)).toEqual(['30 9 * * *', '0 10 * * *', '0 14 * * *', '0 19 * * *']);
    // The worker's slots must be exactly the slots the default rules use.
    expect([...REMINDER_SLOTS]).toEqual([...ALL_REMINDER_SLOTS]);
  });

  it('gives every cron schedule a five-field expression', () => {
    for (const s of SCHEDULES.filter((x) => !x.cron.startsWith('@every'))) {
      expect(s.cron, s.name).toMatch(CRON_FIELDS);
    }
  });

  it('covers every background job named in crm-module-spec.md §4', () => {
    for (const name of [
      'nightly-call-tasks',
      'nightly-lifecycle',
      'owner-digest',
      'kiosk-offline-check',
      'lead-followup',
      'outbox-dispatch',
    ]) {
      expect(allNames, name).toContain(name);
    }
  });

  it('builds JobRun keys that make a slot run unique per business day', () => {
    expect(runKeyFor('2026-09-10', '19:00')).toBe('2026-09-10@19:00');
    expect(runKeyFor('2026-09-10')).toBe('2026-09-10');
  });
});
