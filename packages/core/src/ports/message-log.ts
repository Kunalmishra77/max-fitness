import type { E164Mobile, ISTDate, Language, WhatsAppTemplateName } from '@mfp/shared';

/**
 * Writing to the WhatsApp message log.
 *
 * ADR-017: the simulator in `packages/integrations` is specified to record
 * `MessageLog` rows, but `folder-structure.md` forbids integrations from importing
 * `packages/db`. So the capability is a port: `packages/db` implements it, the app
 * boundary injects it, and the simulator depends only on this interface — which
 * also makes it testable with an in-memory array.
 */

export type MessageStatus = 'QUEUED' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED' | 'SKIPPED' | 'SIMULATED';

export type MessagePurpose =
  | 'REMINDER'
  | 'RECEIPT'
  | 'WELCOME'
  | 'VERIFICATION'
  | 'OTP'
  | 'OWNER_DIGEST'
  | 'OWNER_ALERT'
  | 'BIRTHDAY'
  | 'UNSUBSCRIBE_CONFIRM'
  | 'RESTART_CONFIRM'
  | 'OTHER';

export interface MessageLogEntry {
  readonly gymId: string;
  readonly memberId: string | null;
  readonly membershipId: string | null;
  readonly direction: 'OUTBOUND' | 'INBOUND';
  readonly purpose: MessagePurpose;
  readonly ruleCode: string | null;
  readonly templateName: WhatsAppTemplateName | null;
  readonly language: Language | null;
  readonly toNumber: E164Mobile | null;
  /** BR-5.4. The unique constraint on this column is what prevents double sends. */
  readonly idempotencyKey: string | null;
  readonly providerMessageId: string | null;
  readonly status: MessageStatus;
  /** Rendered text for the log and the simulator. Never contains a secret. */
  readonly bodyPreview: string | null;
  readonly payload: Readonly<Record<string, unknown>> | null;
  readonly errorCode?: string | null;
  readonly errorMessage?: string | null;
  readonly businessDate?: ISTDate | null;
}

export interface MessageLogWriter {
  /**
   * Insert a log row, ignoring a conflict on `idempotencyKey`.
   *
   * Returns `false` when a row with that key already existed — the caller must then
   * skip the send rather than treat it as an error (BR-5.3 rule 6, case R15).
   */
  record(entry: MessageLogEntry): Promise<boolean>;

  /** Update delivery state from a provider webhook, keyed by `providerMessageId`. */
  updateStatus(
    providerMessageId: string,
    status: MessageStatus,
    at: Date,
    error?: { code: string; message: string },
  ): Promise<void>;
}
