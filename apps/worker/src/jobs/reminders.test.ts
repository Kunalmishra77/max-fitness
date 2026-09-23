import { describe, expect, it, vi } from 'vitest';
import { FakeClock, istDate, type E164Mobile } from '@mfp/shared';
import type { MessageLogEntry, WhatsAppSendOutcome, WhatsAppSendRequest } from '@mfp/core/ports';
import type { ReminderCandidate, ReminderRule, SendIntent } from '@mfp/core';
import { runReminderSlot, sendReminder, type SendContext } from './reminders';

/**
 * The two reminder jobs (whatsapp-automation-engine §5; BR-5.3, BR-5.4).
 *
 * The slot job asks who qualifies now and queues one message each; the send job checks
 * eligibility again in the moment before it sends, because a member can renew or
 * unsubscribe between the two. Everything either job decides ends up in the message log,
 * including the messages it decided not to send.
 */

const clock = new FakeClock(new Date('2026-09-23T04:30:00Z')); // 10:00 IST
const TODAY = istDate('2026-09-23');
const MOBILE = '+919000000001' as E164Mobile;

const rules: ReminderRule[] = [
  { code: 'PRE_7', offsetDays: -7, offsetDaysTo: -7, slots: ['10:00'], templateName: 'mf_renewal_due', isEnabled: true },
];

const candidate: ReminderCandidate = {
  memberId: 'mem_1',
  membershipId: 'mship_1',
  firstName: 'Anita',
  mobile: MOBILE,
  language: 'en',
  endDate: istDate('2026-09-30'),
};

const settings = {
  automaticPaused: false,
  quietHours: { start: '08:00', end: '21:00' },
  maxMessagesPerNumberPerDay: 4,
} as const;

function slotDeps(over: Partial<Parameters<typeof runReminderSlot>[1]> = {}) {
  const log: MessageLogEntry[] = [];
  const queued: SendIntent[] = [];
  return {
    log,
    queued,
    deps: {
      clock,
      gymId: 'gym_1',
      settings: () => Promise.resolve(settings),
      rules: () => Promise.resolve(rules),
      candidates: () => Promise.resolve([candidate]),
      tokens: { renewUrl: (id: string) => `https://max.test/r/${id}`, unsubscribePayload: (id: string) => `UNSUB.${id}` },
      enqueue: (intent: SendIntent) => {
        queued.push(intent);
        return Promise.resolve();
      },
      messageLog: {
        record: (entry: MessageLogEntry) => {
          log.push(entry);
          return Promise.resolve(true);
        },
      },
      claimRun: () => Promise.resolve(true),
      ...over,
    },
  };
}

describe('runReminderSlot', () => {
  it('queues one message per member and records nothing else', async () => {
    const { deps, queued, log } = slotDeps();

    const result = await runReminderSlot({ slot: '10:00', today: TODAY }, deps);

    expect(result).toEqual({ ran: true, planned: 1, queued: 1, skipped: 0 });
    expect(queued.map((intent) => intent.idempotencyKey)).toEqual(['rem:mem_1:mship_1:PRE_7:2026-09-23:10:00']);
    expect(log).toEqual([]);
  });

  it('does not run twice for the same day and slot', async () => {
    const { deps, queued } = slotDeps({ claimRun: () => Promise.resolve(false) });

    expect(await runReminderSlot({ slot: '10:00', today: TODAY }, deps)).toEqual({ ran: false, planned: 0, queued: 0, skipped: 0 });
    expect(queued).toEqual([]);
  });

  it('sends nothing at all while the owner has automatic messages stopped', async () => {
    const { deps, queued } = slotDeps({ settings: () => Promise.resolve({ ...settings, automaticPaused: true }) });

    expect(await runReminderSlot({ slot: '10:00', today: TODAY }, deps)).toEqual({ ran: true, planned: 0, queued: 0, skipped: 0 });
    expect(queued).toEqual([]);
  });

  it('logs the ones dropped by the family cap, so the owner can see why', async () => {
    const family = [candidate, { ...candidate, memberId: 'mem_2', membershipId: 'mship_2' }];
    const { deps, queued, log } = slotDeps({
      candidates: () => Promise.resolve(family),
      settings: () => Promise.resolve({ ...settings, maxMessagesPerNumberPerDay: 1 }),
    });

    const result = await runReminderSlot({ slot: '10:00', today: TODAY }, deps);

    expect(result).toEqual({ ran: true, planned: 2, queued: 1, skipped: 1 });
    expect(queued).toHaveLength(1);
    expect(log).toEqual([expect.objectContaining({ status: 'SKIPPED', errorCode: 'NUMBER_CAP', memberId: 'mem_2', purpose: 'REMINDER' })]);
  });
});

const intent: SendIntent = {
  idempotencyKey: 'rem:mem_1:mship_1:PRE_7:2026-09-23:10:00',
  memberId: 'mem_1',
  membershipId: 'mship_1',
  ruleCode: 'PRE_7',
  businessDate: istDate('2026-09-23'),
  slot: '10:00',
  templateName: 'mf_renewal_due',
  language: 'en',
  to: MOBILE,
  variables: { firstName: 'Anita', endDate: '30 Sep 2026', whenPhrase: 'in 7 days' },
  buttons: { renewUrl: 'https://max.test/r/mem_1', unsubscribePayload: 'UNSUB.mem_1' },
};

const context: SendContext = {
  memberStatus: 'ACTIVE',
  whatsappOptIn: true,
  remindersUnsubscribedAt: null,
  remindersPausedUntil: null,
  hasMobile: true,
  latestConfirmedMembershipId: 'mship_1',
  messagesToNumberToday: 0,
};

function sendDeps(over: { context?: Partial<SendContext>; send?: (request: WhatsAppSendRequest) => Promise<WhatsAppSendOutcome>; recorded?: boolean } = {}) {
  const log: MessageLogEntry[] = [];
  const updates: Array<{ key: string; status: string; error?: string | null }> = [];
  const sent: WhatsAppSendRequest[] = [];
  return {
    log,
    updates,
    sent,
    deps: {
      clock,
      gymId: 'gym_1',
      settings: () => Promise.resolve(settings),
      loadContext: () => Promise.resolve({ ...context, ...over.context }),
      messageLog: {
        record: (entry: MessageLogEntry) => {
          log.push(entry);
          return Promise.resolve(over.recorded ?? true);
        },
        updateByIdempotencyKey: (key: string, status: string, fields: { providerMessageId?: string | null; errorCode?: string | null }) => {
          updates.push({ key, status, error: fields.errorCode ?? null });
          return Promise.resolve();
        },
      },
      whatsapp: {
        send:
          over.send ??
          ((request: WhatsAppSendRequest) => {
            sent.push(request);
            return Promise.resolve<WhatsAppSendOutcome>({ status: 'SENT', providerMessageId: 'wamid.1' });
          }),
      },
    },
  };
}

describe('sendReminder', () => {
  it('logs the message, sends it, and records the provider id', async () => {
    const { deps, log, sent, updates } = sendDeps();

    expect(await sendReminder(intent, deps)).toEqual({ outcome: 'SENT' });

    expect(log).toEqual([expect.objectContaining({ status: 'QUEUED', idempotencyKey: intent.idempotencyKey, purpose: 'REMINDER', ruleCode: 'PRE_7' })]);
    expect(sent[0]).toMatchObject({ to: MOBILE, templateName: 'mf_renewal_due', language: 'en', idempotencyKey: intent.idempotencyKey });
    expect(sent[0]?.buttons).toEqual([
      { payload: 'https://max.test/r/mem_1', label: 'renew' },
      { payload: 'UNSUB.mem_1', label: 'unsubscribe' },
    ]);
    expect(updates).toEqual([{ key: intent.idempotencyKey, status: 'SENT', error: null }]);
  });

  it('checks again in the moment before sending: a member who renewed gets nothing', async () => {
    const { deps, log, sent } = sendDeps({ context: { latestConfirmedMembershipId: 'mship_2' } });

    expect(await sendReminder(intent, deps)).toEqual({ outcome: 'SKIPPED', reason: 'SUPERSEDED_BY_NEWER_MEMBERSHIP' });
    expect(log).toEqual([expect.objectContaining({ status: 'SKIPPED', errorCode: 'SUPERSEDED_BY_NEWER_MEMBERSHIP' })]);
    expect(sent).toEqual([]);
  });

  it('never sends to someone who unsubscribed between the slot and the send', async () => {
    const { deps, sent } = sendDeps({ context: { remindersUnsubscribedAt: new Date('2026-09-23T04:29:00Z') } });

    expect(await sendReminder(intent, deps)).toMatchObject({ outcome: 'SKIPPED' });
    expect(sent).toEqual([]);
  });

  it('treats an already-logged key as done, so a repeated job sends nothing', async () => {
    const { deps, sent } = sendDeps({ recorded: false });

    expect(await sendReminder(intent, deps)).toEqual({ outcome: 'DUPLICATE' });
    expect(sent).toEqual([]);
  });

  it('records a failure and asks for a retry only when the failure could pass later', async () => {
    const retryable = sendDeps({
      send: () => Promise.resolve<WhatsAppSendOutcome>({ status: 'FAILED', errorCode: '131026', errorMessage: 'undeliverable', retryable: true }),
    });
    await expect(sendReminder(intent, retryable.deps)).rejects.toThrow();
    expect(retryable.updates).toEqual([{ key: intent.idempotencyKey, status: 'FAILED', error: '131026' }]);

    const permanent = sendDeps({
      send: () => Promise.resolve<WhatsAppSendOutcome>({ status: 'FAILED', errorCode: '131047', errorMessage: 'no', retryable: false }),
    });
    expect(await sendReminder(intent, permanent.deps)).toEqual({ outcome: 'FAILED', errorCode: '131047' });
  });

  it('records a simulated send as its own state, with the text the member would have seen', async () => {
    const { deps, updates } = sendDeps({
      send: () => Promise.resolve<WhatsAppSendOutcome>({ status: 'SIMULATED', bodyPreview: 'Hi Anita…' }),
    });

    expect(await sendReminder(intent, deps)).toEqual({ outcome: 'SIMULATED' });
    expect(updates).toEqual([{ key: intent.idempotencyKey, status: 'SIMULATED', error: null }]);
  });
});

/** The quiet-hours guard lives in core; this is the worker's use of it. */
describe('runReminderSlot outside quiet hours', () => {
  it('refuses to run a slot the owner has moved outside quiet hours', async () => {
    const { deps, queued } = slotDeps({ settings: () => Promise.resolve({ ...settings, quietHours: { start: '08:00', end: '09:00' } }) });
    const warn = vi.fn();

    expect(await runReminderSlot({ slot: '10:00', today: TODAY }, { ...deps, onWarning: warn })).toEqual({ ran: false, planned: 0, queued: 0, skipped: 0 });
    expect(queued).toEqual([]);
    expect(warn).toHaveBeenCalledWith('QUIET_HOURS');
  });
});
