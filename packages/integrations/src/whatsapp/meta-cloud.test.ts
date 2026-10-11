import { describe, expect, it, vi } from 'vitest';
import type { E164Mobile } from '@mfp/shared';
import { MetaCloudWhatsAppProvider } from './meta-cloud';

/**
 * The Cloud API adapter (TRD §7; whatsapp-automation-engine.md).
 *
 * Meta renders the approved template from its own copy; we supply the variables, and we
 * supply them **positionally**. Everything the domain hands over is named, so the one
 * thing that can quietly ruin every message is the order — "Hi 15 Sep 2026, your
 * membership ends on Ravi" is a send that succeeds and reads as nonsense. That is what
 * most of these tests are about.
 */

const TO = '+919811426350' as E164Mobile;

const ok = (id = 'wamid.ABC123') => ({
  ok: true,
  status: 200,
  json: () => Promise.resolve({ messages: [{ id }] }),
});

const fail = (status: number, code: number, message = 'nope') => ({
  ok: false,
  status,
  json: () => Promise.resolve({ error: { code, message, type: 'OAuthException' } }),
});

function provider(fetchImpl: unknown) {
  return new MetaCloudWhatsAppProvider({
    phoneNumberId: '1394917043704455',
    accessToken: 'tok',
    graphApiVersion: 'v26.0',
    appSecret: 'secret',
    fetch: fetchImpl as typeof globalThis.fetch,
    // Tests must not actually wait out the backoff.
    sleep: () => Promise.resolve(),
  });
}

const sendRenewal = (p: MetaCloudWhatsAppProvider) =>
  p.send({
    to: TO,
    templateName: 'mf_renewal_due',
    language: 'en',
    variables: { endDate: '15 Sep 2026', firstName: 'Ravi', whenPhrase: 'in 7 days' },
    idempotencyKey: 'rem:1',
  });

const bodyOf = (call: unknown): Record<string, unknown> =>
  JSON.parse((call as [string, { body: string }])[1].body) as Record<string, unknown>;

describe('MetaCloudWhatsAppProvider', () => {
  it('posts to the pinned version and phone number, as that number', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(ok()));

    await sendRenewal(provider(fetchImpl));

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, { headers: Record<string, string> }];
    expect(url).toBe('https://graph.facebook.com/v26.0/1394917043704455/messages');
    expect(init.headers['Authorization']).toBe('Bearer tok');
  });

  /**
   * The variables arrive named and out of order on purpose: the template declares
   * firstName, endDate, whenPhrase, and that is the order Meta must receive.
   */
  it('orders the body parameters the way the template declares them, not the way they arrived', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(ok()));

    await sendRenewal(provider(fetchImpl));

    const body = bodyOf(fetchImpl.mock.calls[0]);
    expect(body['to']).toBe('919811426350');
    expect(body['template']).toMatchObject({
      name: 'mf_renewal_due',
      language: { code: 'en' },
      components: [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: 'Ravi' },
            { type: 'text', text: '15 Sep 2026' },
            { type: 'text', text: 'in 7 days' },
          ],
        },
      ],
    });
  });

  it('hands back the wamid, which is what a delivery status is matched on later', async () => {
    const result = await sendRenewal(provider(vi.fn(() => Promise.resolve(ok('wamid.XYZ')))));

    expect(result).toEqual({ status: 'SENT', providerMessageId: 'wamid.XYZ' });
  });

  it('carries quick-reply buttons as payloads, so a tap comes back identifiable', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(ok()));

    await provider(fetchImpl).send({
      to: TO,
      templateName: 'mf_renewal_due',
      language: 'en',
      variables: { firstName: 'Ravi', endDate: '15 Sep 2026', whenPhrase: 'in 7 days' },
      idempotencyKey: 'rem:2',
      buttons: [{ payload: 'UNSUB.tok', label: 'Unsubscribe' }],
    });

    const components = (bodyOf(fetchImpl.mock.calls[0])['template'] as { components: unknown[] }).components;
    expect(components).toContainEqual({
      type: 'button',
      sub_type: 'quick_reply',
      index: '0',
      parameters: [{ type: 'payload', payload: 'UNSUB.tok' }],
    });
  });

  it('sends a free-form reply as a plain text message, with no link preview', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(ok()));

    await provider(fetchImpl).sendText({ to: TO, body: 'Reminders are off.', idempotencyKey: 'u:1', purpose: 'OTHER' });

    expect(bodyOf(fetchImpl.mock.calls[0])).toMatchObject({
      messaging_product: 'whatsapp',
      to: '919811426350',
      type: 'text',
      text: { body: 'Reminders are off.', preview_url: false },
    });
  });

  describe('when Meta says no', () => {
    /**
     * A bad template name or a number that is not on WhatsApp will fail again in exactly
     * the same way. Retrying costs quota and delays every message behind it.
     */
    it('does not retry a plain 4xx, and says so', async () => {
      const fetchImpl = vi.fn(() => Promise.resolve(fail(400, 132001, 'Template name does not exist')));

      const result = await sendRenewal(provider(fetchImpl));

      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({ status: 'FAILED', errorCode: '132001', retryable: false });
    });

    it('retries a 5xx and reports the send that eventually worked', async () => {
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(fail(500, 1, 'oops'))
        .mockResolvedValueOnce(ok('wamid.SECOND'));

      const result = await sendRenewal(provider(fetchImpl));

      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ status: 'SENT', providerMessageId: 'wamid.SECOND' });
    });

    /** Rate limiting is the one 4xx worth waiting out. */
    it('retries a rate limit', async () => {
      const fetchImpl = vi.fn().mockResolvedValueOnce(fail(429, 130429, 'Rate limit hit')).mockResolvedValueOnce(ok());

      const result = await sendRenewal(provider(fetchImpl));

      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(result).toMatchObject({ status: 'SENT' });
    });

    it('gives up after three attempts rather than holding the queue', async () => {
      const fetchImpl = vi.fn(() => Promise.resolve(fail(503, 2, 'down')));

      const result = await sendRenewal(provider(fetchImpl));

      expect(fetchImpl).toHaveBeenCalledTimes(3);
      expect(result).toMatchObject({ status: 'FAILED', retryable: true });
    });

    /** The network never reached Meta: nothing was sent, so it is safe to try again. */
    it('treats a dead connection as retryable', async () => {
      const fetchImpl = vi.fn(() => Promise.reject(new Error('ECONNRESET')));

      const result = await sendRenewal(provider(fetchImpl));

      expect(result).toMatchObject({ status: 'FAILED', retryable: true });
    });
  });
});
