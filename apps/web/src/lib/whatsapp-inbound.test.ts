// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { FakeClock, toE164 } from '@mfp/shared';
import { issueToken } from '@mfp/core';
import { handleInboundWhatsApp, type InboundDeps } from './whatsapp-inbound';

/**
 * What the webhook does with a verified payload (whatsapp-automation-engine §7; BR-6.1).
 *
 * A tapped button carries a token we minted, so the member id comes from the signature,
 * never from the message. Typed words are matched to the same two actions. A status
 * update only moves the message log along.
 */

const SECRET = 's'.repeat(40);
const clock = new FakeClock(new Date('2026-09-23T05:30:00Z'));
const MOBILE = toE164('9000000001');

const token = (purpose: 'unsub' | 'restart', memberId: string) => issueToken({ purpose, subject: memberId, ttlSeconds: 3600, secret: SECRET, clock });

function deps(over: Partial<InboundDeps> = {}): InboundDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    clock,
    secret: SECRET,
    restartWindowDays: 7,
    unsubscribe: (memberId: string) => {
      calls.push(`unsub:${memberId}`);
      return Promise.resolve({ outcome: 'UNSUBSCRIBED' as const });
    },
    restart: (memberId: string) => {
      calls.push(`restart:${memberId}`);
      return Promise.resolve({ outcome: 'RESTARTED' as const });
    },
    membersOnNumber: () => Promise.resolve([{ id: 'mem_1', fullName: 'Anita Rao' }]),
    updateStatus: (providerMessageId: string, status: string) => {
      calls.push(`status:${providerMessageId}:${status}`);
      return Promise.resolve();
    },
    alertOwner: (kind: 'SHARED_NUMBER_STOP' | 'MEMBER_REPLIED' | 'WHATSAPP_QUALITY') => {
      calls.push(`alert:${kind}`);
      return Promise.resolve();
    },
    ...over,
  };
}

const reply = (value: string, kind: 'PAYLOAD' | 'TEXT' = 'PAYLOAD') => ({
  statuses: [],
  replies: [{ providerMessageId: 'wamid.1', from: MOBILE, kind, value, at: clock.now() }],
});

describe('handleInboundWhatsApp', () => {
  it('unsubscribes the member the signed payload names', async () => {
    const d = deps();
    await handleInboundWhatsApp(reply(`UNSUB.${token('unsub', 'mem_9')}`), d);
    expect(d.calls).toEqual(['unsub:mem_9']);
  });

  it('restarts from a signed restart payload', async () => {
    const d = deps();
    await handleInboundWhatsApp(reply(`RESTART.${token('restart', 'mem_9')}`), d);
    expect(d.calls).toEqual(['restart:mem_9']);
  });

  it('ignores a payload whose token was tampered with or is for another purpose', async () => {
    const d = deps();
    await handleInboundWhatsApp(reply('UNSUB.not-a-token'), d);
    await handleInboundWhatsApp(reply(`UNSUB.${token('restart', 'mem_9')}`), d);
    expect(d.calls).toEqual([]);
  });

  it('acts on a typed word when exactly one member uses that number', async () => {
    const d = deps();
    await handleInboundWhatsApp(reply('बंद', 'TEXT'), d);
    expect(d.calls).toEqual(['unsub:mem_1']);
  });

  it('asks the owner to help when a family shares the number', async () => {
    const d = deps({ membersOnNumber: () => Promise.resolve([{ id: 'mem_1', fullName: 'Anita Rao' }, { id: 'mem_2', fullName: 'Rohit Rao' }]) });
    await handleInboundWhatsApp(reply('STOP', 'TEXT'), d);
    expect(d.calls).toEqual(['alert:SHARED_NUMBER_STOP']);
  });

  it('tells the owner when a member writes something else', async () => {
    const d = deps();
    await handleInboundWhatsApp(reply('फीस कितनी है', 'TEXT'), d);
    expect(d.calls).toEqual(['alert:MEMBER_REPLIED']);
  });

  it('moves the message log along on a delivery status, and alerts on a quality failure', async () => {
    const d = deps();
    await handleInboundWhatsApp(
      {
        statuses: [
          { providerMessageId: 'wamid.1', status: 'DELIVERED', at: clock.now(), error: null },
          { providerMessageId: 'wamid.2', status: 'FAILED', at: clock.now(), error: { code: '131049', message: 'quality' } },
        ],
        replies: [],
      },
      d,
    );
    expect(d.calls).toEqual(['status:wamid.1:DELIVERED', 'status:wamid.2:FAILED', 'alert:WHATSAPP_QUALITY']);
  });

  it('does nothing at all for a member who cannot be found on the number', async () => {
    const d = deps({ membersOnNumber: () => Promise.resolve([]) });
    await handleInboundWhatsApp(reply('STOP', 'TEXT'), d);
    expect(d.calls).toEqual(['alert:MEMBER_REPLIED']);
  });

  it('keeps going when one reply fails, so the rest of a batch still lands', async () => {
    const failing = vi.fn().mockRejectedValue(new Error('db down'));
    const d = deps({ unsubscribe: failing });
    await expect(
      handleInboundWhatsApp(
        {
          statuses: [{ providerMessageId: 'wamid.9', status: 'READ', at: clock.now(), error: null }],
          replies: [{ providerMessageId: 'wamid.1', from: MOBILE, kind: 'PAYLOAD', value: `UNSUB.${token('unsub', 'mem_9')}`, at: clock.now() }],
        },
        d,
      ),
    ).resolves.toBeUndefined();
    expect(d.calls).toContain('status:wamid.9:READ');
  });
});
