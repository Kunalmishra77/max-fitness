import { describe, expect, it, vi } from 'vitest';
import { istDate } from '@mfp/shared';
import type { SendIntent } from '@mfp/core';
import { guardSlotAfterFailure, slotRunKey, type SlotGuardDeps } from './safeguards';

/**
 * The slot failure guard (whatsapp-automation-engine §9).
 *
 * A slot that has started failing is almost never failing member by member: the
 * number is blocked, the token expired, the provider is down. So past a fifth of the
 * sends the whole slot stops and the owner is told, rather than the worker walking
 * cheerfully through another two hundred failures.
 */

const intent = (over: Partial<SendIntent> = {}): SendIntent =>
  ({
    idempotencyKey: 'rem:mem_1:ms_1:POST:2026-09-23:19:00',
    memberId: 'mem_1',
    membershipId: 'ms_1',
    ruleCode: 'POST',
    businessDate: istDate('2026-09-23'),
    slot: '19:00',
    templateName: 'mf_membership_expired',
    language: 'hi',
    to: '+919876543210',
    variables: {},
    buttons: { renewUrl: '#', unsubscribePayload: '#' },
    ...over,
  }) as SendIntent;

function deps(health: { attempted: number; failed: number }, over: Partial<SlotGuardDeps> = {}) {
  const stop = vi.fn<(runKey: string, reason: string) => Promise<void>>().mockResolvedValue();
  const alertOwner = vi.fn<(slot: string, failed: number, attempted: number) => Promise<void>>().mockResolvedValue();
  const impl: SlotGuardDeps = {
    health: () => Promise.resolve(health),
    stop,
    alertOwner,
    ...over,
  };
  return { stop, alertOwner, impl };
}

describe('slotRunKey', () => {
  it('names the run the way the slot job claimed it', () => {
    expect(slotRunKey(intent())).toBe('2026-09-23@19:00');
  });
});

describe('guardSlotAfterFailure', () => {
  it('stops the slot and tells the owner once a fifth has failed', async () => {
    const d = deps({ attempted: 20, failed: 5 });

    expect(await guardSlotAfterFailure(intent(), d.impl)).toEqual({ stopped: true, attempted: 20, failed: 5 });
    expect(d.stop).toHaveBeenCalledWith('2026-09-23@19:00', expect.stringContaining('5'));
    expect(d.alertOwner).toHaveBeenCalledWith('19:00', 5, 20);
  });

  it('lets a slot with the odd failure carry on', async () => {
    const d = deps({ attempted: 40, failed: 3 });

    expect(await guardSlotAfterFailure(intent(), d.impl)).toMatchObject({ stopped: false });
    expect(d.stop).not.toHaveBeenCalled();
    expect(d.alertOwner).not.toHaveBeenCalled();
  });

  it('does not condemn a slot on its first couple of sends', async () => {
    const d = deps({ attempted: 2, failed: 2 });

    expect(await guardSlotAfterFailure(intent(), d.impl)).toMatchObject({ stopped: false });
    expect(d.stop).not.toHaveBeenCalled();
  });

  it('still stops the slot when the owner cannot be told', async () => {
    // The alert is how the owner finds out, but stopping is what protects the number;
    // a failure to send the alert must not leave the slot running.
    const d = deps({ attempted: 20, failed: 10 }, { alertOwner: () => Promise.reject(new Error('alert failed')) });

    expect(await guardSlotAfterFailure(intent(), d.impl)).toMatchObject({ stopped: true });
    expect(d.stop).toHaveBeenCalledOnce();
  });
});
