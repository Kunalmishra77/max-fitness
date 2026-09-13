import type { Clock } from '@mfp/shared';
import { isDomainError } from '../errors';
import type { OutboxEventType } from '../ports/outbox';

/**
 * The outbox dispatcher (system-architecture.md §5).
 *
 * Side effects are written to the outbox in the transaction that caused them; this
 * turns committed rows into work. It claims only the event types it has handlers for,
 * so events whose phase has not landed yet (a WhatsApp receipt before the WhatsApp
 * engine) simply wait, rather than being marked done and lost. Handlers are idempotent,
 * so an event retried after a crash does its work once.
 *
 * A failure is retried with growing delays and then marked FAILED for someone to look
 * at. What is recorded is a code or an error class, never a message: a message can
 * carry a mobile number or a driver's connection details.
 */

export interface ClaimedOutboxEvent {
  readonly id: string;
  readonly gymId: string;
  readonly type: OutboxEventType;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly dedupeKey: string;
  /** Attempts made before this one. */
  readonly attempts: number;
}

export interface OutboxDispatchStore {
  /**
   * Due `PENDING` events of the given types, oldest first. Claiming must hide them from
   * other pollers for `leaseMs` (e.g. by moving `availableAt`), so two workers never
   * handle one event at the same time.
   */
  claimDue(types: readonly OutboxEventType[], now: Date, limit: number, leaseMs: number): Promise<ClaimedOutboxEvent[]>;
  markDispatched(id: string, at: Date): Promise<void>;
  scheduleRetry(id: string, attempts: number, error: string, availableAt: Date): Promise<void>;
  markFailed(id: string, attempts: number, error: string): Promise<void>;
}

export type OutboxHandler = (event: ClaimedOutboxEvent) => Promise<void>;
export type OutboxHandlers = Partial<Record<OutboxEventType, OutboxHandler>>;

/** 30 s, 2 min, 10 min, 1 h, 6 h — then the event is FAILED. */
export const OUTBOX_RETRY_DELAYS_MS: readonly number[] = [30_000, 120_000, 600_000, 3_600_000, 21_600_000];
export const OUTBOX_MAX_ATTEMPTS = OUTBOX_RETRY_DELAYS_MS.length + 1;
/** Longer than any handler should take; a crashed worker's claim expires after this. */
export const OUTBOX_LEASE_MS = 5 * 60_000;

export interface DispatchResult {
  readonly dispatched: number;
  readonly retried: number;
  readonly failed: number;
}

function errorCode(error: unknown): string {
  if (isDomainError(error)) return error.code;
  return error instanceof Error ? error.name : 'Error';
}

export async function dispatchOutbox(deps: {
  readonly store: OutboxDispatchStore;
  readonly handlers: OutboxHandlers;
  readonly clock: Clock;
  readonly batchSize?: number;
}): Promise<DispatchResult> {
  const types = Object.keys(deps.handlers) as OutboxEventType[];
  if (types.length === 0) return { dispatched: 0, retried: 0, failed: 0 };

  const events = await deps.store.claimDue(types, deps.clock.now(), deps.batchSize ?? 25, OUTBOX_LEASE_MS);
  let dispatched = 0;
  let retried = 0;
  let failed = 0;

  for (const event of events) {
    const handler = deps.handlers[event.type];
    if (handler === undefined) continue;
    try {
      await handler(event);
      await deps.store.markDispatched(event.id, deps.clock.now());
      dispatched += 1;
    } catch (error) {
      const attempts = event.attempts + 1;
      if (attempts >= OUTBOX_MAX_ATTEMPTS) {
        await deps.store.markFailed(event.id, attempts, errorCode(error));
        failed += 1;
      } else {
        const delay = OUTBOX_RETRY_DELAYS_MS[attempts - 1] ?? OUTBOX_LEASE_MS;
        await deps.store.scheduleRetry(event.id, attempts, errorCode(error), new Date(deps.clock.now().getTime() + delay));
        retried += 1;
      }
    }
  }

  return { dispatched, retried, failed };
}
