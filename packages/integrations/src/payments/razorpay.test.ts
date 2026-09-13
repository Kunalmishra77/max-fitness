import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { PaymentProviderError, RazorpayPaymentProvider } from './razorpay';

const KEY_ID = 'rzp_test_1DP5mmOlF5G5ag';
const KEY_SECRET = 'test-key-secret-value';
const WEBHOOK_SECRET = 'test-webhook-secret-value';

interface RecordedCall {
  readonly url: string;
  readonly method: string;
  readonly headers: Headers;
  readonly body: unknown;
  readonly signal: AbortSignal | null;
}

const hmac = (payload: string, secret: string) => createHmac('sha256', secret).update(payload).digest('hex');

describe('RazorpayPaymentProvider', () => {
  let calls: RecordedCall[];
  let reply: { status: number; body: unknown };
  let provider: RazorpayPaymentProvider;

  beforeEach(() => {
    calls = [];
    reply = { status: 200, body: {} };
    const fakeFetch: typeof fetch = (input, init) => {
      calls.push({
        url: typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
        method: init?.method ?? 'GET',
        headers: new Headers(init?.headers),
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
        signal: init?.signal ?? null,
      });
      return Promise.resolve(new Response(JSON.stringify(reply.body), { status: reply.status }));
    };
    provider = new RazorpayPaymentProvider({ keyId: KEY_ID, keySecret: KEY_SECRET, webhookSecret: WEBHOOK_SECRET, fetch: fakeFetch });
  });

  describe('createOrder', () => {
    const request = { amountPaise: 400_000, currency: 'INR', receipt: 'cm1payment0001', notes: { memberId: 'mem_1' } } as const;

    it('creates an order with basic auth and returns the order id, amount and public key', async () => {
      reply.body = { id: 'order_P1aBcD2eFgH3iJ', entity: 'order', amount: 400_000, currency: 'INR', receipt: 'cm1payment0001', status: 'created' };

      const created = await provider.createOrder(request);

      expect(created).toEqual({ providerOrderId: 'order_P1aBcD2eFgH3iJ', amountPaise: 400_000, publicKeyId: KEY_ID });
      expect(calls).toHaveLength(1);
      const [call] = calls;
      expect(call).toMatchObject({
        url: 'https://api.razorpay.com/v1/orders',
        method: 'POST',
        body: { amount: 400_000, currency: 'INR', receipt: 'cm1payment0001', notes: { memberId: 'mem_1' } },
      });
      expect(call!.headers.get('authorization')).toBe(`Basic ${Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString('base64')}`);
      expect(call!.headers.get('content-type')).toBe('application/json');
      expect(call!.signal).not.toBeNull();
    });

    it("reports Razorpay's error code and status without leaking the secret", async () => {
      reply = { status: 400, body: { error: { code: 'BAD_REQUEST_ERROR', description: 'The amount must be at least INR 1.00' } } };

      const error = await provider.createOrder(request).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(PaymentProviderError);
      expect(error).toMatchObject({ status: 400, providerCode: 'BAD_REQUEST_ERROR', operation: 'createOrder' });
      expect(String((error as Error).message)).not.toContain(KEY_SECRET);
    });

    it('rejects a response that is not an order', async () => {
      reply.body = { unexpected: true };
      await expect(provider.createOrder(request)).rejects.toBeInstanceOf(PaymentProviderError);
    });
  });

  describe('fetchPayment', () => {
    it("reads the payment from Razorpay's own record", async () => {
      reply.body = {
        id: 'pay_P1aBcD2eFgH3iJ',
        entity: 'payment',
        amount: 400_000,
        currency: 'INR',
        status: 'captured',
        order_id: 'order_P1aBcD2eFgH3iJ',
        method: 'upi',
        captured: true,
        email: 'someone@example.com',
        contact: '+919876543210',
      };

      const payment = await provider.fetchPayment('pay_P1aBcD2eFgH3iJ');

      expect(payment).toEqual({
        providerPaymentId: 'pay_P1aBcD2eFgH3iJ',
        providerOrderId: 'order_P1aBcD2eFgH3iJ',
        amountPaise: 400_000,
        status: 'captured',
        capturedAt: null,
        method: 'upi',
      });
      expect(calls[0]).toMatchObject({ url: 'https://api.razorpay.com/v1/payments/pay_P1aBcD2eFgH3iJ', method: 'GET' });
      expect(calls[0]!.headers.get('authorization')).toMatch(/^Basic /);
    });

    it('refuses a malformed payment id without calling Razorpay', async () => {
      for (const id of ['../orders', 'pay_abc/../../x', '', 'order_P1aBcD2eFgH3iJ']) {
        await expect(provider.fetchPayment(id)).rejects.toBeInstanceOf(PaymentProviderError);
      }
      expect(calls).toHaveLength(0);
    });

    it('reports a payment Razorpay does not know', async () => {
      reply = { status: 404, body: { error: { code: 'BAD_REQUEST_ERROR', description: 'The id provided does not exist' } } };
      await expect(provider.fetchPayment('pay_P1aBcD2eFgH3iJ')).rejects.toMatchObject({ status: 404, operation: 'fetchPayment' });
    });
  });

  describe('verifyCheckoutSignature', () => {
    const orderId = 'order_P1aBcD2eFgH3iJ';
    const paymentId = 'pay_P1aBcD2eFgH3iJ';

    it('accepts the HMAC of order id and payment id keyed with the key secret', () => {
      const signature = hmac(`${orderId}|${paymentId}`, KEY_SECRET);
      expect(provider.verifyCheckoutSignature({ providerOrderId: orderId, providerPaymentId: paymentId, signature })).toBe(true);
    });

    it('rejects a signature for another payment, another secret, or of the wrong shape', () => {
      const forged = [
        hmac(`${orderId}|pay_Other0000000000`, KEY_SECRET),
        hmac(`${orderId}|${paymentId}`, WEBHOOK_SECRET),
        hmac(`${orderId}|${paymentId}`, KEY_SECRET).slice(0, 40),
        'z'.repeat(64),
        '',
      ];
      for (const signature of forged) {
        expect(provider.verifyCheckoutSignature({ providerOrderId: orderId, providerPaymentId: paymentId, signature })).toBe(false);
      }
    });
  });

  describe('verifyWebhookSignature', () => {
    const rawBody = '{"event":"payment.captured","payload":{"payment":{"entity":{"id":"pay_P1aBcD2eFgH3iJ","amount":400000}}}}';

    it('accepts the HMAC of the raw body keyed with the webhook secret', () => {
      expect(provider.verifyWebhookSignature(rawBody, hmac(rawBody, WEBHOOK_SECRET))).toBe(true);
    });

    it('rejects a changed body, the checkout key secret, or a missing signature', () => {
      const signature = hmac(rawBody, WEBHOOK_SECRET);
      expect(provider.verifyWebhookSignature(rawBody.replace('400000', '400001'), signature)).toBe(false);
      expect(provider.verifyWebhookSignature(rawBody, hmac(rawBody, KEY_SECRET))).toBe(false);
      expect(provider.verifyWebhookSignature(rawBody, '')).toBe(false);
    });
  });
});
