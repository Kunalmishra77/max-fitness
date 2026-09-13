import type { WhatsAppProvider, WhatsAppSendOutcome, WhatsAppSendRequest } from '@mfp/core/ports';

/**
 * Meta WhatsApp Cloud API adapter — TYPED STUB, implemented in Phase 6.
 *
 * Contract to implement (TRD §7, whatsapp-automation-engine.md, api-specification.md §4):
 * - Send: `POST https://graph.facebook.com/{version}/{phone-number-id}/messages`
 *   with a Bearer system-user token and a `template` payload carrying the approved
 *   template name, language code and the ordered body variables. Pin the Graph API
 *   version via WHATSAPP_GRAPH_API_VERSION — an unpinned version breaks silently
 *   when Meta deprecates one.
 * - The response's `messages[0].id` (`wamid...`) becomes `MessageLog.providerMessageId`.
 * - Retries: 3 attempts with backoff on 5xx and rate limits; a 4xx other than
 *   rate-limiting is permanent and must not be retried.
 * - Quality: pause sends automatically on a quality-rating downgrade notification
 *   and alert the owner (system-architecture.md §7).
 *
 * Inbound (a separate handler, not this class): verify `X-Hub-Signature-256` as
 * HMAC-SHA256 of the RAW body keyed with WHATSAPP_APP_SECRET, then handle
 * `statuses[]` and `messages[]` of type `button`, `interactive` and `text`.
 */

export interface MetaCloudConfig {
  readonly phoneNumberId: string;
  readonly accessToken: string;
  readonly graphApiVersion: string;
  readonly appSecret: string;
}

export class MetaCloudWhatsAppProvider implements WhatsAppProvider {
  readonly name = 'meta_cloud' as const;

  constructor(_config: MetaCloudConfig) {
    // TODO(Phase 6): retain config; no network client is built until first use.
  }

  send(_request: WhatsAppSendRequest): Promise<WhatsAppSendOutcome> {
    return Promise.reject(new Error('MetaCloudWhatsAppProvider.send is implemented in Phase 6'));
  }
}
