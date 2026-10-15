import type { WhatsAppProvider, WhatsAppSendOutcome, WhatsAppSendRequest, WhatsAppTextRequest } from '@mfp/core/ports';
import type { Language } from '@mfp/shared';
import { approvedLanguage } from './language';
import { templateDefinition } from './templates';

/**
 * Meta WhatsApp Cloud API adapter (TRD §7; whatsapp-automation-engine.md; api-spec §4).
 *
 * Meta holds the approved template and renders it; we supply the variables. The domain
 * names them — `firstName`, `endDate` — and Meta takes them **positionally**, so the one
 * mistake that ruins every message without failing is the order. It is read from the
 * template's own declaration rather than from the order the caller happened to build the
 * object in, because "Hi 15 Sep 2026, your membership ends on Ravi" is a 200 OK.
 *
 * **What is retried, and what is not.** A 5xx or a dead connection is Meta or the network
 * having a bad minute: nothing was delivered and the same request will work later. A 4xx
 * is a request that is wrong — a template that does not exist, a number that is not on
 * WhatsApp — and sending it again produces the same refusal while holding up everything
 * behind it. Rate limiting is the exception, because it is a 4xx that means "later".
 *
 * **It never throws.** Every path returns an outcome, because the caller writes that
 * outcome to `MessageLog` and a thrown error would lose which member it was about.
 */

export interface MetaCloudConfig {
  readonly phoneNumberId: string;
  readonly accessToken: string;
  /** Pinned: an unpinned version breaks silently the day Meta deprecates one. */
  readonly graphApiVersion: string;
  readonly appSecret: string;
  /**
   * The languages Meta has actually approved. A member's own language is used when it is
   * among them, and the first listed otherwise — because asking Meta for a template in a
   * language it has never seen loses the message entirely.
   */
  readonly templateLanguages?: readonly Language[];
  /** Injected in tests. */
  readonly fetch?: typeof globalThis.fetch;
  readonly sleep?: (ms: number) => Promise<void>;
}

/** Three attempts, then the message is left for the next run rather than blocking it. */
const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [500, 2_000];
/** Meta's own rate-limit codes: a 4xx that means "later" rather than "no". */
const RATE_LIMIT_CODES = new Set([4, 80007, 130429, 131048, 131056]);

interface MetaError {
  readonly code: number;
  readonly message: string;
}

interface Attempt {
  readonly ok: boolean;
  readonly status: number;
  readonly messageId?: string;
  readonly error?: MetaError;
}

/** Meta takes the number without a `+`. */
const digits = (mobile: string) => mobile.replace(/\D/g, '');

/**
 * What a dynamic URL button actually takes.
 *
 * The approved template holds `https://maxfitnessgym.co.in/r/{{1}}`, so the send supplies
 * only the token. Passing the whole link would produce `…/r/https://…/r/token`.
 */
const urlSuffix = (link: string) => link.split('/').filter((part) => part !== '').pop() ?? link;

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class MetaCloudWhatsAppProvider implements WhatsAppProvider {
  readonly name = 'meta_cloud' as const;
  readonly #config: MetaCloudConfig;

  constructor(config: MetaCloudConfig) {
    this.#config = config;
  }

  send(request: WhatsAppSendRequest): Promise<WhatsAppSendOutcome> {
    const definition = templateDefinition(request.templateName);

    // The template's own order, not the caller's. A variable the caller did not supply
    // becomes an empty string rather than the literal "undefined" in a member's message.
    const parameters = definition.variables.map((key) => ({ type: 'text' as const, text: request.variables[key] ?? '' }));

    const components: unknown[] = [{ type: 'body', parameters }];

    /**
     * **The template decides which buttons exist, and of what kind** (ADR-119).
     *
     * Meta refuses the whole message for a component the approved template does not have
     * — `mf_verification_approved` has a body and a footer and nothing else, and the
     * worker sent it an unsubscribe button. That was 132018 on the first real send the
     * gym ever attempted. The caller supplies values; what they fill is not its business.
     *
     * The two kinds are not interchangeable either: a URL button takes the tail of the
     * link, a quick reply takes a payload that comes back on the webhook (BR-6.1).
     */
    (definition.buttons ?? []).forEach((button, index) => {
      const supplied = request.buttons?.[index];
      if (supplied === undefined) return;
      components.push(
        button.kind === 'url'
          ? { type: 'button', sub_type: 'url', index: String(index), parameters: [{ type: 'text', text: urlSuffix(supplied.payload) }] }
          : { type: 'button', sub_type: 'quick_reply', index: String(index), parameters: [{ type: 'payload', payload: supplied.payload }] },
      );
    });

    return this.#post({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: digits(request.to),
      type: 'template',
      template: { name: request.templateName, language: { code: approvedLanguage(request.language, this.#config.templateLanguages ?? []) }, components },
    });
  }

  sendText(request: WhatsAppTextRequest): Promise<WhatsAppSendOutcome> {
    return this.#post({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: digits(request.to),
      type: 'text',
      // These are the unsubscribe and restart confirmations (BR-6.3). A preview would
      // expand whatever a member happened to quote back at us.
      text: { body: request.body, preview_url: false },
    });
  }

  async #post(payload: Record<string, unknown>): Promise<WhatsAppSendOutcome> {
    const url = `https://graph.facebook.com/${this.#config.graphApiVersion}/${this.#config.phoneNumberId}/messages`;
    const send = this.#config.fetch ?? globalThis.fetch;
    const sleep = this.#config.sleep ?? defaultSleep;

    let last: Attempt = { ok: false, status: 0, error: { code: 0, message: 'not attempted' } };

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      last = await this.#attempt(send, url, payload);
      if (last.ok && last.messageId !== undefined) {
        return { status: 'SENT', providerMessageId: last.messageId };
      }
      if (!isRetryable(last)) break;
      if (attempt < MAX_ATTEMPTS - 1) await sleep(BACKOFF_MS[attempt] ?? 2_000);
    }

    return {
      status: 'FAILED',
      errorCode: String(last.error?.code ?? last.status),
      errorMessage: last.error?.message ?? `HTTP ${last.status}`,
      retryable: isRetryable(last),
    };
  }

  async #attempt(send: typeof globalThis.fetch, url: string, payload: Record<string, unknown>): Promise<Attempt> {
    try {
      const response = await send(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.#config.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const body = (await response.json().catch(() => ({}))) as {
        messages?: ReadonlyArray<{ id?: string }>;
        error?: { code?: number; message?: string };
      };

      if (response.ok) {
        const id = body.messages?.[0]?.id;
        // A 200 with no id is not a send. Treating it as one would log a message that
        // never arrives and can never be matched to a delivery status.
        return id === undefined
          ? { ok: false, status: response.status, error: { code: 0, message: 'no message id in the reply' } }
          : { ok: true, status: response.status, messageId: id };
      }

      return {
        ok: false,
        status: response.status,
        error: { code: body.error?.code ?? response.status, message: body.error?.message ?? `HTTP ${response.status}` },
      };
    } catch (error) {
      // The request never reached Meta, so nothing was sent and trying again is safe.
      // The message itself is never logged here: a member's number is not an error.
      return { ok: false, status: 0, error: { code: 0, message: error instanceof Error ? error.name : 'network error' } };
    }
  }
}

function isRetryable(attempt: Attempt): boolean {
  if (attempt.ok) return false;
  // Nothing left the machine.
  if (attempt.status === 0) return true;
  if (attempt.status >= 500) return true;
  if (attempt.status === 429) return true;
  return RATE_LIMIT_CODES.has(attempt.error?.code ?? -1);
}
