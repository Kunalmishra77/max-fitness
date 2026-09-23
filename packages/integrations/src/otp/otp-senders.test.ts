import { describe, expect, it } from 'vitest';
import type { E164Mobile, WhatsAppProvider, WhatsAppSendRequest } from '@mfp/core/ports';
import { renderTemplate } from '../whatsapp/templates';
import { SimulatedOtpSender, WhatsAppOtpSender } from './otp-senders';

const TO = '+919876543210' as E164Mobile;

describe('SimulatedOtpSender', () => {
  it('sends nothing and writes nothing: in DEMO_MODE the code is shown on screen instead', async () => {
    const sender = new SimulatedOtpSender();
    await expect(sender.send(TO, '482913', 'hi')).resolves.toBeUndefined();
  });
});

describe('WhatsAppOtpSender', () => {
  it('sends the authentication template with the code, a fresh key each time', async () => {
    const sent: WhatsAppSendRequest[] = [];
    const provider: WhatsAppProvider = {
      name: 'meta_cloud',
      sendText: () => Promise.reject(new Error('not used here')),
      send: (request) => {
        sent.push(request);
        return Promise.resolve({ status: 'SENT', providerMessageId: 'wamid.1' });
      },
    };
    const sender = new WhatsAppOtpSender(provider);

    await sender.send(TO, '482913', 'en');
    await sender.send(TO, '105577', 'en');

    expect(sent[0]).toMatchObject({ to: TO, templateName: 'mf_login_code', language: 'en', variables: { code: '482913' } });
    expect(sent[0]?.idempotencyKey).toMatch(/^otp:/);
    expect(sent[0]?.idempotencyKey).not.toContain('482913');
    expect(sent[1]?.idempotencyKey).not.toBe(sent[0]?.idempotencyKey);
  });

  it('fails loudly when WhatsApp refuses, so the member is not left waiting for nothing', async () => {
    const provider: WhatsAppProvider = {
      name: 'meta_cloud',
      sendText: () => Promise.reject(new Error('not used here')),
      send: () => Promise.resolve({ status: 'FAILED', errorCode: '131026', errorMessage: 'undeliverable', retryable: false }),
    };
    await expect(new WhatsAppOtpSender(provider).send(TO, '482913', 'en')).rejects.toThrow('OTP_SEND_FAILED');
  });
});

describe('mf_login_code', () => {
  it('reads as Meta authentication templates do, in both languages', () => {
    expect(renderTemplate('mf_login_code', 'en', { code: '482913' })).toContain('482913 is your verification code.');
    expect(renderTemplate('mf_login_code', 'hi', { code: '482913' })).toContain('482913 आपका वेरिफिकेशन कोड है।');
  });
});
