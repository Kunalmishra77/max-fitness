/**
 * Transactional outbox (system-architecture.md §5).
 *
 * A side effect must not fire if its transaction rolls back, and must not be lost if
 * the process dies after commit. So the state change and the intent to act are
 * written in the same transaction, and the worker dispatches afterwards.
 */

export type OutboxEventType =
  | 'whatsapp.receipt'
  | 'whatsapp.welcome'
  | 'whatsapp.reminder'
  | 'whatsapp.unsubscribe_confirm'
  | 'whatsapp.restart_confirm'
  | 'whatsapp.verification_approved'
  | 'whatsapp.birthday'
  | 'whatsapp.announcement'
  | 'kiosk.gallery_changed'
  | 'kiosk.enroll'
  | 'calltask.create'
  | 'receipt.pdf';

export interface OutboxEventInput {
  readonly type: OutboxEventType;
  readonly gymId: string;
  readonly payload: Readonly<Record<string, unknown>>;
  /** Unique; a repeated enqueue of the same intent is a no-op (CLAUDE.md §2.5). */
  readonly dedupeKey: string;
  /** Delay dispatch until this instant. Omit to dispatch as soon as possible. */
  readonly availableAt?: Date;
}

export interface Outbox {
  /** Must run inside the caller's transaction. */
  enqueue(event: OutboxEventInput): Promise<void>;
}
