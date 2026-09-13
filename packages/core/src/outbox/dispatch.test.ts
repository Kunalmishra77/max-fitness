import { beforeEach, describe, expect, it } from 'vitest';
import { DomainError } from '../errors';
import type { OutboxEventType } from '../ports/outbox';
import { fakeClockAt } from '../testing/builders';
import { OUTBOX_MAX_ATTEMPTS, OUTBOX_RETRY_DELAYS_MS, dispatchOutbox, type ClaimedOutboxEvent, type OutboxDispatchStore } from './dispatch';

class FakeOutboxStore implements OutboxDispatchStore {
  events: ClaimedOutboxEvent[] = [];
  readonly claims: Array<{ types: readonly OutboxEventType[]; limit: number }> = [];
  readonly dispatched: string[] = [];
  readonly retries: Array<{ id: string; attempts: number; error: string; availableAt: Date }> = [];
  readonly failed: Array<{ id: string; attempts: number; error: string }> = [];

  claimDue(types: readonly OutboxEventType[], _now: Date, limit: number): Promise<ClaimedOutboxEvent[]> {
    this.claims.push({ types, limit });
    return Promise.resolve(this.events.filter((e) => types.includes(e.type)).slice(0, limit));
  }
  markDispatched(id: string): Promise<void> {
    this.dispatched.push(id);
    return Promise.resolve();
  }
  scheduleRetry(id: string, attempts: number, error: string, availableAt: Date): Promise<void> {
    this.retries.push({ id, attempts, error, availableAt });
    return Promise.resolve();
  }
  markFailed(id: string, attempts: number, error: string): Promise<void> {
    this.failed.push({ id, attempts, error });
    return Promise.resolve();
  }
}

const event = (id: string, type: OutboxEventType, attempts = 0): ClaimedOutboxEvent => ({
  id,
  gymId: 'gym_1',
  type,
  payload: { paymentId: `pay_${id}` },
  dedupeKey: `${type}:${id}`,
  attempts,
});

describe('dispatchOutbox', () => {
  let store: FakeOutboxStore;
  const clock = fakeClockAt('2026-09-11T10:00');

  beforeEach(() => {
    store = new FakeOutboxStore();
  });

  it('claims only the event types it has handlers for, and marks each handled event dispatched', async () => {
    store.events = [event('1', 'receipt.pdf'), event('2', 'whatsapp.receipt'), event('3', 'receipt.pdf')];
    const handled: string[] = [];

    const result = await dispatchOutbox({
      store,
      clock,
      handlers: { 'receipt.pdf': (e) => (handled.push(e.id), Promise.resolve()) },
    });

    expect(store.claims).toEqual([{ types: ['receipt.pdf'], limit: 25 }]);
    expect(handled).toEqual(['1', '3']);
    expect(store.dispatched).toEqual(['1', '3']);
    expect(result).toEqual({ dispatched: 2, retried: 0, failed: 0 });
  });

  it('does nothing without handlers', async () => {
    store.events = [event('1', 'kiosk.enroll')];
    expect(await dispatchOutbox({ store, clock, handlers: {} })).toEqual({ dispatched: 0, retried: 0, failed: 0 });
    expect(store.claims).toHaveLength(0);
  });

  it('retries a failed event later with growing delays, and keeps going with the rest', async () => {
    store.events = [event('1', 'receipt.pdf', 0), event('2', 'receipt.pdf', 2)];

    const result = await dispatchOutbox({
      store,
      clock,
      handlers: { 'receipt.pdf': (e) => (e.id === '1' ? Promise.reject(new Error('storage offline')) : Promise.resolve()) },
    });

    expect(result).toEqual({ dispatched: 1, retried: 1, failed: 0 });
    expect(store.retries).toEqual([
      { id: '1', attempts: 1, error: 'Error', availableAt: new Date(clock.now().getTime() + (OUTBOX_RETRY_DELAYS_MS[0] ?? 0)) },
    ]);
    expect(OUTBOX_RETRY_DELAYS_MS[2]).toBeGreaterThan(OUTBOX_RETRY_DELAYS_MS[1] ?? 0);
  });

  it('gives up after the last attempt, recording a code rather than a message', async () => {
    store.events = [event('1', 'receipt.pdf', OUTBOX_MAX_ATTEMPTS - 1)];

    const result = await dispatchOutbox({
      store,
      clock,
      handlers: { 'receipt.pdf': () => Promise.reject(new DomainError('PAYMENT_NOT_FOUND', 'No payment for pay_1 (+919876543210)')) },
    });

    expect(result).toEqual({ dispatched: 0, retried: 0, failed: 1 });
    expect(store.failed).toEqual([{ id: '1', attempts: OUTBOX_MAX_ATTEMPTS, error: 'PAYMENT_NOT_FOUND' }]);
  });
});
