import type { E164Mobile, Language, WhatsAppTemplateName } from '@mfp/shared';

/**
 * WhatsApp delivery.
 *
 * Implementations: `meta_cloud` (Graph API), `bsp`, and `simulator`. The simulator
 * is what runs in DEMO_MODE and in tests, writing to the in-app Message Simulator
 * instead of sending (CLAUDE.md §2.7).
 */

/** Template variables. Values are already rendered strings — the domain formats money and dates. */
export type TemplateVariables = Readonly<Record<string, string>>;

export interface WhatsAppSendRequest {
  readonly to: E164Mobile;
  readonly templateName: WhatsAppTemplateName;
  readonly language: Language;
  readonly variables: TemplateVariables;
  /**
   * Unique per intended send (BR-5.4: `rem:{memberId}:{membershipId}:{ruleCode}:{date}:{slot}`).
   * A unique constraint on `MessageLog.idempotencyKey` makes a repeat a no-op, so a
   * duplicate cron fire or a retry cannot message a member twice (CLAUDE.md §2.5).
   */
  readonly idempotencyKey: string;
  /** Quick-reply buttons, e.g. Unsubscribe / Restart, carrying a signed payload. */
  readonly buttons?: readonly WhatsAppButton[];
}

export interface WhatsAppButton {
  /** Payload the webhook receives back, e.g. `UNSUB.<signed token>` (BR-6.1). */
  readonly payload: string;
  readonly label: string;
}

export type WhatsAppSendOutcome =
  | {
      readonly status: 'SENT';
      /** Provider message id (`wamid...`), stored on `MessageLog.providerMessageId`. */
      readonly providerMessageId: string;
    }
  | {
      /** DEMO_MODE, or a real number that is not on `WHATSAPP_ALLOWLIST`. */
      readonly status: 'SIMULATED';
      readonly bodyPreview: string;
    }
  | {
      /** Eligibility failed at send time, or the same idempotency key already exists. */
      readonly status: 'SKIPPED';
      readonly reason: string;
    }
  | {
      readonly status: 'FAILED';
      readonly errorCode: string;
      readonly errorMessage: string;
      readonly retryable: boolean;
    };

export interface WhatsAppProvider {
  readonly name: 'meta_cloud' | 'bsp' | 'simulator';
  send(request: WhatsAppSendRequest): Promise<WhatsAppSendOutcome>;
}
