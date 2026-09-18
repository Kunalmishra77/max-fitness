import { randomUUID } from 'node:crypto';
import type { E164Mobile, OtpSender, WhatsAppProvider } from '@mfp/core/ports';

/**
 * Delivering one-time codes (ADR-060).
 *
 * In DEMO_MODE nothing is sent and nothing is stored: the route shows the code on the
 * screen, marked as a demo. That keeps a live code out of the message log, which holds
 * rendered text. Live, the code goes as Meta's authentication template (T8), which Meta
 * renders from its own approved copy; approval and the copy-code button are Phase 6.
 */

export class SimulatedOtpSender implements OtpSender {
  send(_to: E164Mobile, _code: string, _language: 'hi' | 'en'): Promise<void> {
    return Promise.resolve();
  }
}

export class WhatsAppOtpSender implements OtpSender {
  readonly #provider: WhatsAppProvider;
  constructor(provider: WhatsAppProvider) {
    this.#provider = provider;
  }

  async send(to: E164Mobile, code: string, language: 'hi' | 'en'): Promise<void> {
    const outcome = await this.#provider.send({
      to,
      templateName: 'mf_login_code',
      language,
      variables: { code },
      // Every code is its own message; the key must never carry the code itself.
      idempotencyKey: `otp:${randomUUID()}`,
    });
    if (outcome.status === 'FAILED') throw new Error('OTP_SEND_FAILED');
  }
}
