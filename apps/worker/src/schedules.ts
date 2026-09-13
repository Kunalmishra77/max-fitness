import type { ReminderRuleCode } from '@mfp/shared';

/**
 * The worker's cron registrations (crm-module-spec.md §4).
 *
 * Every schedule is declared here in Phase 1 with a no-op handler, so the shape of
 * the system is visible and the cron plumbing is proven before any of the jobs
 * exist. Each entry names the phase that implements it.
 *
 * Times are IST. pg-boss takes an explicit `tz`, which matters: the server runs in
 * UTC (security-plan.md §3.3) and a 06:00 job that fires at 11:30 IST would ring
 * the owner's call list in the middle of the day.
 */

export const IST_TZ = 'Asia/Kolkata';

export interface ScheduleDefinition {
  /** Queue name; also the `JobRun.jobName` used for catch-up and audit. */
  readonly name: string;
  /** Standard 5-field cron, interpreted in IST. */
  readonly cron: string;
  readonly description: string;
  /** The phase that replaces the no-op with a real handler. */
  readonly implementedIn: number;
}

/**
 * Reminder slots (BR-5.1).
 *
 * ADR-002: one cron per distinct slot time, evaluating the rules against every
 * membership — not one scheduled job per member. A renewal or unsubscribe then
 * takes effect automatically, because the next evaluation simply finds nothing to
 * send. The slots here are the BR-5.1 defaults; Phase 6 reads them from
 * `ReminderRule` so the owner can change them.
 */
export const REMINDER_SLOTS: readonly string[] = ['09:30', '10:00', '14:00', '19:00'];

function slotCron(slot: string): string {
  const [hh, mm] = slot.split(':');
  return `${Number(mm)} ${Number(hh)} * * *`;
}

/**
 * pg-boss 12 accepts only letters, digits, `_`, `-`, `.` and `/` in queue names, so
 * the slot's colon is dropped: `09:30` becomes `reminder-slot-0930`.
 */
export function reminderQueueName(slot: string): string {
  return `reminder-slot-${slot.replace(':', '')}`;
}

export const REMINDER_SCHEDULES: readonly ScheduleDefinition[] = REMINDER_SLOTS.map((slot) => ({
  name: reminderQueueName(slot),
  cron: slotCron(slot),
  description: `Evaluate reminder rules for the ${slot} IST slot (BR-5.1)`,
  implementedIn: 6,
}));

export const SCHEDULES: readonly ScheduleDefinition[] = [
  ...REMINDER_SCHEDULES,
  {
    name: 'nightly-call-tasks',
    cron: '0 6 * * *',
    description: "Generate BR-7 call tasks and auto-close ones whose condition cleared",
    implementedIn: 4,
  },
  {
    name: 'nightly-lifecycle',
    cron: '30 2 * * *',
    description:
      'Auto-mark LEFT after the lapse window (BR-4.3), delete face templates and expired media (BR-6.6, retention §7)',
    implementedIn: 4,
  },
  {
    name: 'owner-digest',
    cron: '30 8 * * *',
    description: 'Build and send the owner digest, skipping days with nothing to report',
    implementedIn: 6,
  },
  {
    name: 'kiosk-offline-check',
    cron: '*/10 5-22 * * *',
    description: 'Alert when the kiosk has not been seen for longer than the configured window',
    implementedIn: 7,
  },
  {
    name: 'lead-followup',
    cron: '*/15 5-22 * * *',
    description: 'Raise NEW_LEAD call tasks for enquiries untouched for 2 gym hours (BR-7)',
    implementedIn: 4,
  },
  {
    name: 'outbox-dispatch',
    // Not a cron: polled every 2 seconds (system-architecture.md §5). Listed here
    // so the full set of background work is visible in one place.
    cron: '@every 2s',
    description: 'Dispatch committed side effects from the outbox',
    implementedIn: 3,
  },
];

/** Queues that exist but are triggered by an event rather than a clock. */
export const EVENT_QUEUES: readonly Omit<ScheduleDefinition, 'cron'>[] = [
  { name: 'whatsapp-send', description: 'Send one WhatsApp message, re-checking eligibility first (BR-5.3)', implementedIn: 6 },
  { name: 'whatsapp-inbound', description: 'Process an inbound webhook: statuses, button taps, text replies', implementedIn: 6 },
  { name: 'receipt-pdf', description: 'Render a receipt PDF and store it privately', implementedIn: 3 },
  { name: 'kiosk-enroll', description: 'Create an enrolment job so the kiosk can build a face template', implementedIn: 7 },
];

/** `JobRun.runKey` — `"2026-09-10@19:00"`. Unique per job, so a slot cannot run twice (R15, R16). */
export function runKeyFor(businessDate: string, slot?: string): string {
  return slot === undefined ? businessDate : `${businessDate}@${slot}`;
}

/** Which rule codes a slot can possibly fire, for logging what a run was for. */
export const SLOT_RULE_CODES: Readonly<Record<string, readonly ReminderRuleCode[]>> = {
  '09:30': ['POST'],
  '10:00': ['PRE_7', 'PRE_3', 'PRE_2', 'PRE_1', 'DUE_TODAY'],
  '14:00': ['POST'],
  '19:00': ['POST'],
};
