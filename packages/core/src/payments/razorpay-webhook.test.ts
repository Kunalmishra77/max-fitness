import { beforeEach, describe, expect, it } from 'vitest';
import { DomainError } from '../errors';
import { fakeClockAt } from '../testing/builders';
import { FakePaymentProvider, InMemoryPaymentStore, inMemoryUnitOfWork, seedPendingPayment } from '../testing/payments';
import { handleRazorpayWebhook, type WebhookEventRecord, type WebhookEventStore } from './razorpay-webhook';

class FakeWebhookStore implements WebhookEventStore {
  readonly events = new Map<string, WebhookEventRecord & { processed: boolean; error: string | null }>();
  readonly failedOrders: Array<{ providerOrderId: string; reason: string | null }> = [];

  recordEvent(record: WebhookEventRecord): Promise<'NEW' | 'DUPLICATE'> {
    if (this.events.has(record.externalId)) return Promise.resolve('DUPLICATE');
    this.events.set(record.externalId, { ...record, processed: false, error: null });
    return Promise.resolve('NEW');
  }
  markProcessed(externalId: string, error: string | null): Promise<void> {
    Object.assign(this.events.get(externalId)!, { processed: true, error });
    return Promise.resolve();
  }
  markPaymentFailed(providerOrderId: string, reason: string | null): Promise<void> {
    this.failedOrders.push({ providerOrderId, reason });
    return Promise.resolve();
  }
}

function body(event: string, entity: Record<string, unknown> = {}): string {
  return JSON.stringify({
    event,
    payload: {
      payment: {
        entity: {
          id: 'pay_rzp_1',
          order_id: 'order_1',
          amount: 400_000,
          status: event === 'payment.failed' ? 'failed' : 'captured',
          error_description: event === 'payment.failed' ? 'Card declined by bank' : null,
          ...entity,
        },
      },
    },
  });
}

describe('handleRazorpayWebhook', () => {
  let payments: InMemoryPaymentStore;
  let events: FakeWebhookStore;
  const provider = new FakePaymentProvider('razorpay');

  beforeEach(() => {
    payments = new InMemoryPaymentStore();
    seedPendingPayment(payments);
    events = new FakeWebhookStore();
  });

  const handle = (rawBody: string, eventId: string | null = 'evt_1', signature = FakePaymentProvider.VALID_WEBHOOK_SIGNATURE) =>
    handleRazorpayWebhook(
      { rawBody, signature, eventId },
      { provider, clock: fakeClockAt('2026-09-11T10:00'), uow: inMemoryUnitOfWork(payments), events },
    );

  it('rejects a body whose signature does not verify, and stores nothing', async () => {
    const error = await handle(body('payment.captured'), 'evt_1', 'forged').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe('INVALID_PAYMENT_SIGNATURE');
    expect(events.events.size).toBe(0);
    expect(payments.payments.get('pay_1')!.status).toBe('CREATED');
  });

  it('confirms the payment on payment.captured and records the event as processed', async () => {
    const result = await handle(body('payment.captured'));

    expect(result).toEqual({ outcome: 'CONFIRMED' });
    expect(payments.payments.get('pay_1')).toMatchObject({ status: 'PAID', signatureOk: false, method: 'RAZORPAY' });
    expect(events.events.get('evt_1')).toMatchObject({
      provider: 'razorpay',
      eventType: 'payment.captured',
      signatureOk: true,
      processed: true,
      error: null,
    });
  });

  it('ignores a repeated delivery of the same event', async () => {
    await handle(body('payment.captured'));
    expect(await handle(body('payment.captured'))).toEqual({ outcome: 'DUPLICATE' });
    expect(payments.counters.get('gym_1:receipt:2026-27')).toBe(1);
  });

  it('treats order.paid after payment.captured as already confirmed (case P1)', async () => {
    await handle(body('payment.captured'), 'evt_1');
    expect(await handle(body('order.paid'), 'evt_2')).toEqual({ outcome: 'ALREADY_CONFIRMED' });
    expect(payments.outbox).toHaveLength(3);
  });

  it('records a failed payment with its reason', async () => {
    expect(await handle(body('payment.failed'))).toEqual({ outcome: 'FAILED_RECORDED' });
    expect(events.failedOrders).toEqual([{ providerOrderId: 'order_1', reason: 'Card declined by bank' }]);
  });

  it('ignores events it does not act on', async () => {
    expect(await handle(body('refund.created'))).toEqual({ outcome: 'IGNORED' });
    expect(events.events.get('evt_1')).toMatchObject({ processed: true, error: null });
  });

  it('ignores a payment for an order this system did not create', async () => {
    expect(await handle(body('payment.captured', { order_id: 'order_elsewhere' }))).toEqual({ outcome: 'IGNORED' });
    expect(events.events.get('evt_1')).toMatchObject({ processed: true, error: 'PAYMENT_NOT_FOUND' });
  });

  it('builds a stable id from the event and payment when the event id header is missing', async () => {
    await handle(body('payment.captured'), null);
    expect(events.events.has('payment.captured:pay_rzp_1')).toBe(true);
  });

  it('rejects a signed body that is not a Razorpay event, and stores nothing', async () => {
    for (const rawBody of ['not json', JSON.stringify({ payload: {} })]) {
      const error = await handle(rawBody).catch((e: unknown) => e);
      expect((error as DomainError).code).toBe('VALIDATION_FAILED');
    }
    expect(events.events.size).toBe(0);
  });

  it('leaves the event unprocessed when confirming fails, so the retry is accepted', async () => {
    const failingUow = { transaction: () => Promise.reject(new Error('database unavailable')) };

    await expect(
      handleRazorpayWebhook(
        { rawBody: body('payment.captured'), signature: FakePaymentProvider.VALID_WEBHOOK_SIGNATURE, eventId: 'evt_1' },
        { provider, clock: fakeClockAt('2026-09-11T10:00'), uow: failingUow, events },
      ),
    ).rejects.toThrow('database unavailable');
    expect(events.events.get('evt_1')).toMatchObject({ processed: false });
  });

  it('does not activate when the captured amount differs from the order (case P4)', async () => {
    expect(await handle(body('payment.captured', { amount: 1 }))).toEqual({ outcome: 'AMOUNT_MISMATCH' });
    expect(payments.members.get('mem_1')!.status).toBe('PENDING_PAYMENT');
  });

  // Autopay (ADR-105). `subscription.charged` is money that has already left the member's
  // account; the rest of the `subscription.*` family is the mandate's own state.
  describe('subscription events', () => {
    const subscriptionBody = (event: string, subscription: Record<string, unknown> = {}, payment: Record<string, unknown> | null = null) =>
      JSON.stringify({
        event,
        payload: {
          subscription: { entity: { id: 'sub_rzp_1', status: event.replace('subscription.', ''), charge_at: 1_762_387_200, ...subscription } },
          ...(payment === null ? {} : { payment: { entity: { id: 'pay_rzp_9', amount: 150_000, order_id: 'order_rzp_9', ...payment } } }),
        },
      });

    const charges: unknown[] = [];
    const statuses: unknown[] = [];

    const withMandates = (rawBody: string, eventId = 'evt_sub_1') =>
      handleRazorpayWebhook(
        { rawBody, signature: FakePaymentProvider.VALID_WEBHOOK_SIGNATURE, eventId },
        {
          provider,
          clock: fakeClockAt('2026-11-01T06:30'),
          uow: inMemoryUnitOfWork(payments),
          events,
          mandates: {
            recordCharge: (input) => {
              charges.push(input);
              return Promise.resolve({ outcome: 'RENEWED' as const, paymentId: 'pay_new', membershipId: 'ms_new', receiptNo: 'MF/2026-27/000042', memberCode: 'MF-0007' });
            },
            updateStatus: (input) => {
              statuses.push(input);
              return Promise.resolve({ outcome: 'UPDATED' as const, mandateId: 'mandate_1', status: 'HALTED' as const });
            },
          },
        },
      );

    beforeEach(() => {
      charges.length = 0;
      statuses.length = 0;
    });

    it('turns a charge into a renewal, reading the amount from the payment entity', async () => {
      const result = await withMandates(subscriptionBody('subscription.charged', { status: 'active' }, {}));

      expect(result).toEqual({ outcome: 'MANDATE_RENEWED' });
      expect(charges[0]).toEqual({
        providerSubscriptionId: 'sub_rzp_1',
        providerPaymentId: 'pay_rzp_9',
        paidAmountPaise: 150_000,
        nextChargeAt: new Date('2025-11-06T00:00:00.000Z'),
      });
      // The charge path does its own status work; calling both would fight over the row.
      expect(statuses).toHaveLength(0);
    });

    it('passes a halt to the mandate state, with no payment entity to read', async () => {
      const result = await withMandates(subscriptionBody('subscription.halted'));

      expect(result).toEqual({ outcome: 'MANDATE_UPDATED' });
      expect(statuses[0]).toMatchObject({ providerSubscriptionId: 'sub_rzp_1', status: 'HALTED' });
      expect(charges).toHaveLength(0);
    });

    it('maps every subscription state Razorpay sends to the mandate enum', async () => {
      for (const [event, expected] of [
        ['subscription.authenticated', 'AUTHENTICATED'],
        ['subscription.activated', 'ACTIVE'],
        ['subscription.pending', 'PENDING'],
        ['subscription.cancelled', 'CANCELLED'],
        ['subscription.completed', 'COMPLETED'],
        ['subscription.paused', 'PAUSED'],
        ['subscription.resumed', 'ACTIVE'],
      ] as const) {
        statuses.length = 0;
        await withMandates(subscriptionBody(event, { status: expected.toLowerCase() === 'active' ? 'active' : undefined }), `evt_${event}`);
        expect(statuses[0]).toMatchObject({ status: expected });
      }
    });

    it('takes the halt reason from the failed payment when the event carries one', async () => {
      await withMandates(subscriptionBody('subscription.halted', {}, { error_description: 'insufficient funds' }));

      expect(statuses[0]).toMatchObject({ failureReason: 'insufficient funds' });
    });

    it('ignores a charge it cannot find a payment id in, rather than guessing', async () => {
      const result = await withMandates(subscriptionBody('subscription.charged', { status: 'active' }, null));

      expect(result).toEqual({ outcome: 'IGNORED' });
      expect(charges).toHaveLength(0);
    });

    it('ignores the whole family when the platform has no mandate support wired in', async () => {
      // DEMO_MODE has no subscription provider, so a subscription event cannot be acted on.
      // Answering 200 and archiving it is right; inventing a mandate is not.
      expect(await handle(subscriptionBody('subscription.halted'), 'evt_demo')).toEqual({ outcome: 'IGNORED' });
    });

    it('records the event once, so a re-delivery changes nothing', async () => {
      await withMandates(subscriptionBody('subscription.halted'), 'evt_dup');
      const second = await withMandates(subscriptionBody('subscription.halted'), 'evt_dup');

      expect(second).toEqual({ outcome: 'DUPLICATE' });
      expect(statuses).toHaveLength(1);
    });
  });
});
