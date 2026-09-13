import { beforeEach, describe, expect, it } from 'vitest';
import { SimulatedPaymentProvider, expectedSimulatedSignature } from './simulated';

describe('SimulatedPaymentProvider', () => {
  let provider: SimulatedPaymentProvider;

  beforeEach(() => {
    provider = new SimulatedPaymentProvider();
  });

  const order = () =>
    provider.createOrder({
      amountPaise: 150_000,
      currency: 'INR',
      receipt: 'pay_abc123',
      notes: { memberId: 'mem_1' },
    });

  it('creates an order carrying the amount and a test key id', async () => {
    const created = await order();
    expect(created.providerOrderId).toMatch(/^order_sim_/);
    expect(created.amountPaise).toBe(150_000);
    expect(created.publicKeyId).toBe('rzp_test_simulated');
  });

  it('gives each order its own id', async () => {
    const a = await order();
    const b = await order();
    expect(a.providerOrderId).not.toBe(b.providerOrderId);
  });

  it('completes a checkout and reports it captured', async () => {
    const created = await order();
    const completed = provider.completeCheckout(created.providerOrderId);

    const fetched = await provider.fetchPayment(completed.providerPaymentId);
    expect(fetched).toMatchObject({
      providerOrderId: created.providerOrderId,
      amountPaise: 150_000,
      status: 'captured',
    });
    expect(fetched.capturedAt).toBeInstanceOf(Date);
  });

  it('P5 — verifies a genuine signature and rejects an invalid one', async () => {
    const created = await order();
    const completed = provider.completeCheckout(created.providerOrderId);

    expect(provider.verifyCheckoutSignature(completed)).toBe(true);
    expect(provider.verifyCheckoutSignature({ ...completed, signature: 'forged' })).toBe(false);
    expect(
      provider.verifyCheckoutSignature({ ...completed, providerOrderId: 'order_sim_other' }),
    ).toBe(false);
  });

  it('exposes the signature rule so a test harness can build one', async () => {
    const created = await order();
    const completed = provider.completeCheckout(created.providerOrderId);
    expect(completed.signature).toBe(
      expectedSimulatedSignature(created.providerOrderId, completed.providerPaymentId),
    );
  });

  it('fails deterministically on the magic amount, not at random', async () => {
    // An amount ending in 13 paise is the agreed failure trigger for E2E journey 5.
    const created = await provider.createOrder({
      amountPaise: 150_013,
      currency: 'INR',
      receipt: 'pay_fail',
    });
    const completed = provider.completeCheckout(created.providerOrderId);
    const fetched = await provider.fetchPayment(completed.providerPaymentId);

    expect(fetched.status).toBe('failed');
    expect(fetched.capturedAt).toBeNull();
  });

  it('lets the demo pay dialog choose the outcome, whatever the amount', async () => {
    const normal = await order();
    const failed = provider.completeCheckout(normal.providerOrderId, { outcome: 'failure' });
    expect((await provider.fetchPayment(failed.providerPaymentId)).status).toBe('failed');

    const magic = await provider.createOrder({ amountPaise: 150_013, currency: 'INR', receipt: 'pay_magic' });
    const succeeded = provider.completeCheckout(magic.providerOrderId, { outcome: 'success' });
    expect((await provider.fetchPayment(succeeded.providerPaymentId)).status).toBe('captured');
  });

  it('always captures a normal amount — no flaky tests', async () => {
    for (let i = 0; i < 20; i += 1) {
      const created = await provider.createOrder({
        amountPaise: 150_000,
        currency: 'INR',
        receipt: `pay_${i}`,
      });
      const completed = provider.completeCheckout(created.providerOrderId);
      expect((await provider.fetchPayment(completed.providerPaymentId)).status).toBe('captured');
    }
  });

  it('refuses to complete an order it never issued', () => {
    expect(() => provider.completeCheckout('order_sim_unknown')).toThrow(/Unknown simulated order/);
  });

  it('refuses to fetch a payment it never made', async () => {
    await expect(provider.fetchPayment('pay_sim_unknown')).rejects.toThrow(/Unknown simulated payment/);
  });

  it('verifies its webhook marker', () => {
    expect(provider.verifyWebhookSignature('{}', 'simulated')).toBe(true);
    expect(provider.verifyWebhookSignature('{}', 'anything-else')).toBe(false);
  });

  it('resets between demos', async () => {
    const created = await order();
    provider.reset();
    expect(() => provider.completeCheckout(created.providerOrderId)).toThrow();
  });
});
