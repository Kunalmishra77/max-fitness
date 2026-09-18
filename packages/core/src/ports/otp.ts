import type { E164Mobile } from '@mfp/shared';

/** Delivers a one-time code: WhatsApp's authentication template, or nothing in DEMO_MODE (ADR-060). */
export interface OtpSender {
  send(to: E164Mobile, code: string, language: 'hi' | 'en'): Promise<void>;
}
