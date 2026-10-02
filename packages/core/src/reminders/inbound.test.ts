import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { classifyInboundText, routeInboundReply, parseWhatsAppWebhook, verifyMetaSignature } from './inbound';

/**
 * What arrives back from WhatsApp (whatsapp-automation-engine §7; security-plan §3.1).
 *
 * Meta posts statuses, button taps and free text to one URL, batched, and signs the raw
 * bytes. Nothing is trusted before the signature checks out, and the parsing keeps only
 * what the handlers act on, so a shape we do not know cannot reach them.
 */

const SECRET = 'app-secret-value';
const sign = (body: string) => `sha256=${createHmac('sha256', SECRET).update(body).digest('hex')}`;

describe('verifyMetaSignature', () => {
  it('accepts the signature Meta would send over those exact bytes', () => {
    const body = '{"object":"whatsapp_business_account"}';
    expect(verifyMetaSignature(body, sign(body), SECRET)).toBe(true);
  });

  it('refuses a changed body, a wrong secret, a missing header and a malformed one', () => {
    const body = '{"a":1}';
    expect(verifyMetaSignature('{"a":2}', sign(body), SECRET)).toBe(false);
    expect(verifyMetaSignature(body, `sha256=${createHmac('sha256', 'other').update(body).digest('hex')}`, SECRET)).toBe(false);
    expect(verifyMetaSignature(body, '', SECRET)).toBe(false);
    expect(verifyMetaSignature(body, 'sha1=abc', SECRET)).toBe(false);
    expect(verifyMetaSignature(body, 'sha256=not-hex', SECRET)).toBe(false);
  });
});

describe('parseWhatsAppWebhook', () => {
  it('reads delivery statuses, keeping the id the message log is keyed by', () => {
    const body = {
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              value: {
                statuses: [
                  { id: 'wamid.1', status: 'delivered', timestamp: '1758600000', recipient_id: '919000000001' },
                  { id: 'wamid.2', status: 'failed', timestamp: '1758600060', recipient_id: '919000000002', errors: [{ code: 131026, title: 'Message undeliverable' }] },
                ],
              },
            },
          ],
        },
      ],
    };

    expect(parseWhatsAppWebhook(body)).toEqual({
      statuses: [
        { providerMessageId: 'wamid.1', status: 'DELIVERED', at: new Date('2025-09-23T04:00:00.000Z'), error: null },
        { providerMessageId: 'wamid.2', status: 'FAILED', at: new Date('2025-09-23T04:01:00.000Z'), error: { code: '131026', message: 'Message undeliverable' } },
      ],
      replies: [],
    });
  });

  it('reads a button tap as its payload, and an interactive reply as its id', () => {
    const body = {
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  { id: 'wamid.3', from: '919000000001', timestamp: '1758600000', type: 'button', button: { payload: 'UNSUB.token', text: 'Unsubscribe' } },
                  { id: 'wamid.4', from: '919000000002', timestamp: '1758600000', type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'RESTART.token', title: 'Restart' } } },
                ],
              },
            },
          ],
        },
      ],
    };

    expect(parseWhatsAppWebhook(body).replies).toEqual([
      { providerMessageId: 'wamid.3', from: '+919000000001', kind: 'PAYLOAD', value: 'UNSUB.token', at: new Date('2025-09-23T04:00:00.000Z') },
      { providerMessageId: 'wamid.4', from: '+919000000002', kind: 'PAYLOAD', value: 'RESTART.token', at: new Date('2025-09-23T04:00:00.000Z') },
    ]);
  });

  it('reads plain text, and ignores message kinds we do not act on', () => {
    const body = {
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  { id: 'wamid.5', from: '919000000001', timestamp: '1758600000', type: 'text', text: { body: ' बंद ' } },
                  { id: 'wamid.6', from: '919000000001', timestamp: '1758600000', type: 'image', image: { id: 'media_1' } },
                ],
              },
            },
          ],
        },
      ],
    };

    expect(parseWhatsAppWebhook(body).replies).toEqual([
      { providerMessageId: 'wamid.5', from: '+919000000001', kind: 'TEXT', value: 'बंद', at: new Date('2025-09-23T04:00:00.000Z') },
    ]);
  });

  it('survives a shape it has never seen without throwing', () => {
    expect(parseWhatsAppWebhook(null)).toEqual({ statuses: [], replies: [] });
    expect(parseWhatsAppWebhook({ entry: 'nonsense' })).toEqual({ statuses: [], replies: [] });
    expect(parseWhatsAppWebhook({ entry: [{ changes: [{ value: { statuses: [{ status: 'read' }] } }] }] })).toEqual({ statuses: [], replies: [] });
  });
});

describe('classifyInboundText', () => {
  it('knows the words a member actually types to stop or restart, in both languages', () => {
    for (const word of ['STOP', 'stop', 'Unsubscribe', 'बंद', 'band', 'BAND KARO', 'बंद करो']) {
      expect(classifyInboundText(word)).toBe('STOP');
    }
    for (const word of ['RESTART', 'restart', 'चालू', 'chalu karo']) {
      expect(classifyInboundText(word)).toBe('RESTART');
    }
    for (const word of ['thanks', 'फीस कितनी है', '']) {
      expect(classifyInboundText(word)).toBe('OTHER');
    }
  });
});

describe('routeInboundReply', () => {
  /**
   * Who gets a member's reply (ADR-089).
   *
   * The order is the point. "Stop" has to work mid-questionnaire — a member must always be
   * able to make the messages end, whatever conversation we think we are having with them.
   * After that, if we asked them a question, their reply is the answer to it. Everything
   * else is for a person to read.
   */
  it('lets a member stop even while a diet question is waiting on them', () => {
    expect(routeInboundReply({ text: 'STOP', pendingDietQuestion: 'weight' })).toEqual({ to: 'STOP' });
    expect(routeInboundReply({ text: 'band karo', pendingDietQuestion: 'goal' })).toEqual({ to: 'STOP' });
    expect(routeInboundReply({ text: 'chalu', pendingDietQuestion: 'goal' })).toEqual({ to: 'RESTART' });
  });

  it('treats a reply as the answer to the question we asked', () => {
    expect(routeInboundReply({ text: '72 kg', pendingDietQuestion: 'weight' })).toEqual({ to: 'DIET_ANSWER', question: 'weight' });
    // Even one that looks like nothing: refusing it is the questionnaire's job, not this.
    expect(routeInboundReply({ text: 'hmm', pendingDietQuestion: 'weight' })).toEqual({ to: 'DIET_ANSWER', question: 'weight' });
  });

  it('hands anything else to a person', () => {
    expect(routeInboundReply({ text: 'what time do you open', pendingDietQuestion: null })).toEqual({ to: 'HUMAN' });
    expect(routeInboundReply({ text: '', pendingDietQuestion: null })).toEqual({ to: 'HUMAN' });
  });
});

describe('routeInboundReply and the monthly check', () => {
  it('treats a reply as this month\u0027s answer when a check is open', () => {
    expect(routeInboundReply({ text: 'mostly', pendingDietQuestion: null, pendingFollowUpQuestion: 'following' })).toEqual({
      to: 'DIET_FOLLOW_UP',
      question: 'following',
    });
  });

  it('finishes the questionnaire first when both are somehow open', () => {
    // The questionnaire is what is blocking a plan from existing at all.
    expect(routeInboundReply({ text: '72', pendingDietQuestion: 'weight', pendingFollowUpQuestion: 'following' })).toEqual({
      to: 'DIET_ANSWER',
      question: 'weight',
    });
  });

  it('still lets them stop', () => {
    expect(routeInboundReply({ text: 'STOP', pendingDietQuestion: null, pendingFollowUpQuestion: 'following' })).toEqual({ to: 'STOP' });
  });
});
