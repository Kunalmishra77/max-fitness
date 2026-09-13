import type {
  MessageLogEntry,
  MessageLogWriter,
  WhatsAppProvider,
  WhatsAppSendOutcome,
  WhatsAppSendRequest,
} from '@mfp/core/ports';
import { renderTemplate } from './templates';

/**
 * The WhatsApp simulator.
 *
 * CLAUDE.md §2.7: with `DEMO_MODE=true`, messages go to the in-app Message
 * Simulator instead of Meta, and a real send is allowed only to a number on
 * `WHATSAPP_ALLOWLIST`. This is what makes the whole product demonstrable before
 * Meta approval, and what stops a seeded demo member — whose number is fake but
 * syntactically real — from being messaged by accident (seed spec §1).
 *
 * ADR-017: it records `MessageLog` rows through the injected `MessageLogWriter`
 * port rather than importing `packages/db`, which keeps the ESLint dependency
 * boundary intact and makes the simulator unit-testable with an in-memory writer.
 */

export interface SimulatorOptions {
  readonly gymId: string;
  readonly log: MessageLogWriter;
  /** Numbers that may receive a genuine send even in demo mode. */
  readonly allowlist: readonly string[];
  /**
   * The real provider, used only for allowlisted numbers. Omit and even an
   * allowlisted number is simulated — which is the right default for tests.
   */
  readonly realProvider?: WhatsAppProvider;
  /** Correlates the log row with the member and membership the message is about. */
  readonly resolveContext?: (
    request: WhatsAppSendRequest,
  ) => Pick<MessageLogEntry, 'memberId' | 'membershipId' | 'purpose' | 'ruleCode'>;
}

const DEFAULT_CONTEXT = {
  memberId: null,
  membershipId: null,
  purpose: 'OTHER',
  ruleCode: null,
} as const satisfies Pick<MessageLogEntry, 'memberId' | 'membershipId' | 'purpose' | 'ruleCode'>;

export class SimulatorWhatsAppProvider implements WhatsAppProvider {
  readonly name = 'simulator' as const;
  readonly #options: SimulatorOptions;

  constructor(options: SimulatorOptions) {
    this.#options = options;
  }

  async send(request: WhatsAppSendRequest): Promise<WhatsAppSendOutcome> {
    const bodyPreview = renderTemplate(request.templateName, request.language, request.variables);
    const context = this.#options.resolveContext?.(request) ?? DEFAULT_CONTEXT;
    const allowlisted = this.#options.allowlist.includes(request.to);

    // The unique constraint on idempotencyKey is the real guard against a double
    // send; `record` returning false means a row already existed (BR-5.3 rule 6).
    const inserted = await this.#options.log.record({
      gymId: this.#options.gymId,
      ...context,
      direction: 'OUTBOUND',
      templateName: request.templateName,
      language: request.language,
      toNumber: request.to,
      idempotencyKey: request.idempotencyKey,
      providerMessageId: null,
      status: allowlisted && this.#options.realProvider !== undefined ? 'QUEUED' : 'SIMULATED',
      bodyPreview,
      payload: { variables: request.variables, buttons: request.buttons ?? [] },
    });

    if (!inserted) {
      return { status: 'SKIPPED', reason: 'ALREADY_SENT' };
    }

    // Allowlisted numbers get a genuine send even in demo mode, so the owner can
    // see a real message arrive on their own phone during a demo.
    const real = this.#options.realProvider;
    if (allowlisted && real !== undefined) {
      const outcome = await real.send(request);
      if (outcome.status === 'SENT') {
        await this.#options.log.updateStatus(outcome.providerMessageId, 'SENT', new Date());
      }
      return outcome;
    }

    return { status: 'SIMULATED', bodyPreview };
  }
}

/**
 * An in-memory `MessageLogWriter` for tests and for the standalone simulator page.
 *
 * It enforces the same idempotency-key uniqueness the database does, so a test that
 * passes here is testing the same behaviour production relies on.
 */
export class InMemoryMessageLog implements MessageLogWriter {
  readonly entries: MessageLogEntry[] = [];
  readonly #keys = new Set<string>();

  record(entry: MessageLogEntry): Promise<boolean> {
    if (entry.idempotencyKey !== null) {
      if (this.#keys.has(entry.idempotencyKey)) {
        return Promise.resolve(false);
      }
      this.#keys.add(entry.idempotencyKey);
    }
    this.entries.push(entry);
    return Promise.resolve(true);
  }

  updateStatus(providerMessageId: string, status: MessageLogEntry['status'], _at: Date): Promise<void> {
    const index = this.entries.findIndex((e) => e.providerMessageId === providerMessageId);
    const existing = this.entries[index];
    if (existing !== undefined) {
      this.entries[index] = { ...existing, status };
    }
    return Promise.resolve();
  }

  clear(): void {
    this.entries.length = 0;
    this.#keys.clear();
  }
}
