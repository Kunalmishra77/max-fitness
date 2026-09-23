import { describe, expect, it, vi } from 'vitest';
import type { OwnerDigestCounts, PendingOwnerAlert, TransactionalMessage } from '@mfp/core';
import type { Clock } from '@mfp/shared';
import { runOwnerAlerts, runOwnerDigest, type OwnerRecipientView } from './owner';

const clockAt = (iso: string): Clock => ({ now: () => new Date(iso) });

const OWNER: OwnerRecipientView = { staffUserId: 'staff_1', firstName: 'Ajay', mobile: '+919000000001', language: 'en' };

const BUSY: OwnerDigestCounts = { endingToday: 2, overdue: 5, dueThisWeek: 4, callsToday: 3, birthdays: 0, collectedYesterdayPaise: 120_000 };
const QUIET: OwnerDigestCounts = { endingToday: 0, overdue: 0, dueThisWeek: 0, callsToday: 0, birthdays: 0, collectedYesterdayPaise: 0 };

function digestDeps(overrides: Partial<Parameters<typeof runOwnerDigest>[0]> = {}) {
  const deliver = vi.fn<(message: TransactionalMessage, to: string) => Promise<void>>().mockResolvedValue();
  const counts = vi.fn().mockResolvedValue(BUSY);
  return {
    deliver,
    counts,
    deps: {
      // 08:30 IST on 23 September 2026.
      clock: clockAt('2026-09-23T03:00:00Z'),
      owner: () => Promise.resolve(OWNER),
      counts,
      deliver,
      claimRun: () => Promise.resolve(true),
      automaticPaused: () => Promise.resolve(false),
      ...overrides,
    },
  };
}

describe('runOwnerDigest', () => {
  it('sends the owner yesterday’s money and today’s work', async () => {
    const { deps, deliver, counts } = digestDeps();

    const result = await runOwnerDigest(deps);

    expect(result).toEqual({ sent: true });
    expect(counts).toHaveBeenCalledWith('2026-09-23', '2026-09-22');
    const [message, to] = deliver.mock.calls[0] ?? [];
    expect(to).toBe('+919000000001');
    expect(message?.templateName).toBe('mf_owner_daily_digest');
    expect(message?.variables['collectedYesterday']).toBe('₹1,200');
  });

  it('stays quiet on a day with nothing to report', async () => {
    const { deps, deliver } = digestDeps({ counts: vi.fn().mockResolvedValue(QUIET) });

    expect(await runOwnerDigest(deps)).toEqual({ sent: false, reason: 'NOTHING_TO_SAY' });
    expect(deliver).not.toHaveBeenCalled();
  });

  it('still reports a day whose only news is the money that came in', async () => {
    const { deps, deliver } = digestDeps({ counts: vi.fn().mockResolvedValue({ ...QUIET, collectedYesterdayPaise: 50_000 }) });

    expect(await runOwnerDigest(deps)).toEqual({ sent: true });
    expect(deliver).toHaveBeenCalledOnce();
  });

  it('does nothing when the gym has no owner to tell', async () => {
    const { deps, deliver } = digestDeps({ owner: () => Promise.resolve(null) });

    expect(await runOwnerDigest(deps)).toEqual({ sent: false, reason: 'NO_OWNER' });
    expect(deliver).not.toHaveBeenCalled();
  });

  it('says nothing while the owner has automatic messages switched off', async () => {
    const { deps, deliver } = digestDeps({ automaticPaused: () => Promise.resolve(true) });

    expect(await runOwnerDigest(deps)).toEqual({ sent: false, reason: 'PAUSED' });
    expect(deliver).not.toHaveBeenCalled();
  });

  it('does not send a second digest when the cron fires twice', async () => {
    const { deps, deliver } = digestDeps({ claimRun: () => Promise.resolve(false) });

    expect(await runOwnerDigest(deps)).toEqual({ sent: false, reason: 'ALREADY_RUN' });
    expect(deliver).not.toHaveBeenCalled();
  });
});

describe('runOwnerAlerts', () => {
  const at = (minutes: number) => new Date(Date.UTC(2026, 8, 23, 4, 0) + minutes * 60_000);
  const alert = (id: string, minutes: number): PendingOwnerAlert => ({
    id,
    at: at(minutes),
    alert: { kind: 'MEMBER_UNSUBSCRIBED', memberName: id },
  });

  function alertDeps(overrides: Partial<Parameters<typeof runOwnerAlerts>[0]> = {}) {
    const deliver = vi.fn<(message: TransactionalMessage, to: string) => Promise<void>>().mockResolvedValue();
    const markNotified = vi.fn<(ids: readonly string[], at: Date) => Promise<void>>().mockResolvedValue();
    return {
      deliver,
      markNotified,
      deps: {
        clock: clockAt('2026-09-23T04:10:00Z'),
        owner: () => Promise.resolve(OWNER),
        pending: () => Promise.resolve({ send: [alert('a', 0), alert('b', 1)], drop: [] }),
        sentInWindow: () => Promise.resolve(0),
        automaticPaused: () => Promise.resolve(false),
        deliver,
        markNotified,
        ...overrides,
      },
    };
  }

  it('sends each alert and marks it told', async () => {
    const { deps, deliver, markNotified } = alertDeps();

    expect(await runOwnerAlerts(deps)).toEqual({ sent: 2, covered: 2, dropped: 0 });
    expect(deliver).toHaveBeenCalledTimes(2);
    expect(markNotified.mock.calls.map((call) => call[0])).toEqual([['a'], ['b']]);
  });

  it('stamps the alerts it is too late to send without sending them', async () => {
    const { deps, deliver, markNotified } = alertDeps({
      pending: () => Promise.resolve({ send: [], drop: ['old_1', 'old_2'] }),
    });

    expect(await runOwnerAlerts(deps)).toEqual({ sent: 0, covered: 0, dropped: 2 });
    expect(deliver).not.toHaveBeenCalled();
    expect(markNotified).toHaveBeenCalledWith(['old_1', 'old_2'], new Date('2026-09-23T04:10:00Z'));
  });

  it('counts what already went out, so a fourth alert in five minutes is bundled', async () => {
    const { deps, deliver, markNotified } = alertDeps({ sentInWindow: () => Promise.resolve(3) });

    expect(await runOwnerAlerts(deps)).toEqual({ sent: 1, covered: 2, dropped: 0 });
    expect(deliver).toHaveBeenCalledOnce();
    expect(markNotified).toHaveBeenCalledWith(['a', 'b'], expect.any(Date));
  });

  it('leaves an alert unstamped when the send fails, so it is tried again', async () => {
    const deliver = vi
      .fn<(message: TransactionalMessage, to: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error('provider down'))
      .mockResolvedValue();
    const { deps, markNotified } = alertDeps({ deliver });

    expect(await runOwnerAlerts(deps)).toEqual({ sent: 1, covered: 1, dropped: 0 });
    expect(markNotified.mock.calls.map((call) => call[0])).toEqual([['b']]);
  });

  it('holds the alerts back while automatic messages are switched off', async () => {
    const { deps, deliver, markNotified } = alertDeps({ automaticPaused: () => Promise.resolve(true) });

    expect(await runOwnerAlerts(deps)).toEqual({ sent: 0, covered: 0, dropped: 0 });
    expect(deliver).not.toHaveBeenCalled();
    expect(markNotified).not.toHaveBeenCalled();
  });

  it('holds the alerts back until the gym has an owner to send them to', async () => {
    const { deps, deliver, markNotified } = alertDeps({ owner: () => Promise.resolve(null) });

    expect(await runOwnerAlerts(deps)).toEqual({ sent: 0, covered: 0, dropped: 0 });
    expect(deliver).not.toHaveBeenCalled();
    expect(markNotified).not.toHaveBeenCalled();
  });
});
