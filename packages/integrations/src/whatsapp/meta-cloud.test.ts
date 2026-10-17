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

function provider(fetchImpl: unknown, templateLanguages: ReadonlyArray<'en' | 'hi'> = ['en', 'hi']) {
  return new MetaCloudWhatsAppProvider({
    phoneNumberId: '100000000000001',
    accessToken: 'tok',
    graphApiVersion: 'v26.0',
    appSecret: 'secret',
    templateLanguages,
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
    expect(url).toBe('https://graph.facebook.com/v26.0/100000000000001/messages');
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

  /**
   * The reminders carry two buttons and they are not the same kind. "Renew now" is a URL
   * button whose template holds `https://…/r/{{1}}` and takes only the token; "Unsubscribe"
   * is a quick reply whose payload comes back on the webhook. Sending either as the other
   * is a component mismatch, and Meta refuses the whole message — so every reminder would
   * have failed on the first real send.
   */
  it('sends the renew button as a URL suffix and the unsubscribe as a payload', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(ok()));

    await provider(fetchImpl).send({
      to: TO,
      templateName: 'mf_renewal_due',
      language: 'en',
      variables: { firstName: 'Ravi', endDate: '15 Sep 2026', whenPhrase: 'in 7 days' },
      idempotencyKey: 'rem:3',
      buttons: [
        { payload: 'https://maxfitnessgym.co.in/r/sIgNeDtOkEn', label: 'renew' },
        { payload: 'UNSUB.tok', label: 'unsubscribe' },
      ],
    });

    const components = (bodyOf(fetchImpl.mock.calls[0])['template'] as { components: unknown[] }).components;
    expect(components).toContainEqual({
      type: 'button',
      sub_type: 'url',
      index: '0',
      // Only the tail: the template already holds everything before it.
      parameters: [{ type: 'text', text: 'sIgNeDtOkEn' }],
    });
    expect(components).toContainEqual({
      type: 'button',
      sub_type: 'quick_reply',
      index: '1',
      parameters: [{ type: 'payload', payload: 'UNSUB.tok' }],
    });
  });

  /**
   * The gym runs English-only templates for now (owner, 2026-10-15), while members'
   * records still say Hindi. Asking Meta for a Hindi template it has never approved
   * loses the message outright — and silently, because the refusal is a 4xx nobody at
   * the gym ever sees.
   */
  it('sends in a language Meta has approved, not the one the member happens to be on', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(ok()));

    await provider(fetchImpl, ['en']).send({
      to: TO,
      templateName: 'mf_renewal_due',
      language: 'hi',
      variables: { firstName: 'Ravi', endDate: '15 Sep 2026', whenPhrase: 'in 7 days' },
      idempotencyKey: 'rem:4',
    });

    expect((bodyOf(fetchImpl.mock.calls[0])['template'] as { language: unknown }).language).toEqual({ code: 'en' });
  });

  it('leaves a member on their own language once it is approved', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(ok()));

    await provider(fetchImpl, ['en', 'hi']).send({
      to: TO,
      templateName: 'mf_renewal_due',
      language: 'hi',
      variables: { firstName: 'Ravi', endDate: '15 Sep 2026', whenPhrase: 'in 7 days' },
      idempotencyKey: 'rem:5',
    });

    expect((bodyOf(fetchImpl.mock.calls[0])['template'] as { language: unknown }).language).toEqual({ code: 'hi' });
  });

  /**
   * A template Meta approved with no buttons must not be sent one (ADR-119).
   *
   * `mf_verification_approved` has a body and a footer and nothing else, and the worker
   * passed it an unsubscribe button anyway. Meta answered 132018 and dropped the message:
   * the first real send the gym ever attempted, refused for a component the template does
   * not have. The template knows its own shape, so it decides.
   */
  it('sends no button component to a template that has none', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(ok()));

    await provider(fetchImpl).send({
      to: TO,
      templateName: 'mf_verification_approved',
      language: 'en',
      variables: { firstName: 'Ramesh', endDate: '15 Oct 2026' },
      idempotencyKey: 'ver:1',
      buttons: [{ payload: 'UNSUB.tok', label: 'unsubscribe' }],
    });

    const components = (bodyOf(fetchImpl.mock.calls[0])['template'] as { components: Array<{ type: string }> }).components;
    expect(components.map((component) => component.type)).toEqual(['body']);
  });

  /** And the kind comes from the template too, not from whatever the caller guessed. */
  it('takes each button kind from the template rather than the caller', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(ok()));

    await provider(fetchImpl).send({
      to: TO,
      templateName: 'mf_renewal_due',
      language: 'en',
      variables: { firstName: 'Ravi', endDate: '15 Sep 2026', whenPhrase: 'in 7 days' },
      idempotencyKey: 'rem:6',
      // Both passed as plain payloads, with no kind: the template says the first is a URL.
      buttons: [
        { payload: 'https://maxfitnessgym.co.in/r/tok123', label: 'renew' },
        { payload: 'UNSUB.tok', label: 'unsubscribe' },
      ],
    });

    const components = (bodyOf(fetchImpl.mock.calls[0])['template'] as { components: unknown[] }).components;
    expect(components).toContainEqual({ type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: 'tok123' }] });
    expect(components).toContainEqual({ type: 'button', sub_type: 'quick_reply', index: '1', parameters: [{ type: 'payload', payload: 'UNSUB.tok' }] });
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
