import { beforeEach, describe, expect, it } from 'vitest';
import { DomainError } from '../errors';
import { fakeClockAt } from '../testing/builders';
import { FakePaymentProvider, InMemoryPaymentStore, inMemoryUnitOfWork, seedPendingPayment } from '../testing/payments';
import { verifyCheckout } from './verify-checkout';

describe('verifyCheckout', () => {
  let store: InMemoryPaymentStore;
  let provider: FakePaymentProvider;

  beforeEach(() => {
    store = new InMemoryPaymentStore();
    seedPendingPayment(store);
    provider = new FakePaymentProvider('razorpay');
  });

  const verify = (signature = FakePaymentProvider.VALID_SIGNATURE, providerOrderId = 'order_1') =>
    verifyCheckout(
      { providerOrderId, providerPaymentId: 'pay_rzp_1', signature },
      { provider, clock: fakeClockAt('2026-09-11T10:00'), uow: inMemoryUnitOfWork(store) },
    );

  it('confirms a captured payment with a valid signature, using the provider amount', async () => {
    provider.addPayment({ providerPaymentId: 'pay_rzp_1', status: 'captured', amountPaise: 400_000 });

    const result = await verify();

    expect(result).toMatchObject({ outcome: 'CONFIRMED', receiptNo: 'MF/2026-27/000001' });
    expect(store.payments.get('pay_1')).toMatchObject({ status: 'PAID', signatureOk: true, method: 'RAZORPAY' });
  });

  it('rejects an invalid signature and leaves the payment untouched (case P5)', async () => {
    provider.addPayment({ providerPaymentId: 'pay_rzp_1' });

    const error = await verify('forged').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe('INVALID_PAYMENT_SIGNATURE');
    expect(store.payments.get('pay_1')!.status).toBe('CREATED');
    expect(provider.fetched).toHaveLength(0);
  });

  it('reports pending when the payment is authorised but not yet captured', async () => {
    provider.addPayment({ providerPaymentId: 'pay_rzp_1', status: 'authorized' });

    expect(await verify()).toEqual({ outcome: 'PENDING', paymentId: null });
    expect(store.payments.get('pay_1')!.status).toBe('CREATED');
  });

  it.each(['failed', 'refunded'] as const)('reports a %s payment as failed without confirming it', async (status) => {
    provider.addPayment({ providerPaymentId: 'pay_rzp_1', status });
    expect(await verify()).toEqual({ outcome: 'FAILED', paymentId: null });
    expect(store.payments.get('pay_1')!.status).toBe('CREATED');
  });

  it('rejects a payment that belongs to a different order', async () => {
    provider.addPayment({ providerPaymentId: 'pay_rzp_1', providerOrderId: 'order_other' });

    const error = await verify().catch((e: unknown) => e);
    expect((error as DomainError).code).toBe('INVALID_PAYMENT_SIGNATURE');
    expect(store.payments.get('pay_1')!.status).toBe('CREATED');
  });

  it('records a simulated checkout as SIMULATED', async () => {
    provider = new FakePaymentProvider('simulated');
    provider.addPayment({ providerPaymentId: 'pay_rzp_1' });

    await verify();

    expect(store.payments.get('pay_1')!.method).toBe('SIMULATED');
  });

  it('does not activate when the provider captured a different amount (case P4)', async () => {
    provider.addPayment({ providerPaymentId: 'pay_rzp_1', amountPaise: 1 });
    expect(await verify()).toMatchObject({ outcome: 'AMOUNT_MISMATCH' });
  });
});
