import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type {
  CreateOrderRequest,
  CreatePlanRequest,
  CreateSubscriptionRequest,
  CreatedOrder,
  CreatedPlan,
  FetchedPayment,
  FetchedSubscription,
  PaymentProvider,
  SubscriptionProvider,
  VerifyCheckoutRequest,
} from '@mfp/core/ports';

/**
 * Razorpay adapter (TRD §7, signup-and-payment-flow.md, api-specification.md §4).
 *
 * Plain `fetch` against the REST API rather than the SDK: the platform uses four
 * calls, and the SDK would add a dependency for none of the parts that need care —
 * the signature checks, which live here either way.
 *
 * - `createOrder`: `POST /v1/orders`, with our `Payment.id` as the receipt so the two
 *   records can always be reconciled.
 * - `fetchPayment`: `GET /v1/payments/{id}` — the amount and status that decide an
 *   activation come from here, never from the browser (BR-11.3, case P4).
 * - Checkout signature: HMAC-SHA256 of `order_id|payment_id` keyed with the key secret.
 * - Webhook signature: HMAC-SHA256 of the RAW body keyed with the webhook secret; the
 *   route must read the bytes before any JSON parse (coding-standards.md §7).
 *
 * Nothing is retried here. Creating an order is not idempotent at Razorpay, and a
 * failed call surfaces to the member as "try again", which creates a fresh payment.
 */

export interface RazorpayConfig {
  readonly keyId: string;
  readonly keySecret: string;
  readonly webhookSecret: string;
  /** Injected in tests. Defaults to the global `fetch`. */
  readonly fetch?: typeof fetch;
  readonly baseUrl?: string;
  /** Razorpay answers in well under a second; a hung call must not hold a request open. */
  readonly timeoutMs?: number;
}

export type RazorpayOperation =
  | 'createOrder'
  | 'fetchPayment'
  | 'createPlan'
  | 'createSubscription'
  | 'fetchSubscription'
  | 'cancelSubscription';

/** An infrastructure failure talking to the gateway. The API layer maps it to 502. */
export class PaymentProviderError extends Error {
  readonly operation: RazorpayOperation;
  /** HTTP status, or `null` for a network failure, a timeout or a malformed reply. */
  readonly status: number | null;
  readonly providerCode: string | null;

  constructor(operation: RazorpayOperation, message: string, status: number | null = null, providerCode: string | null = null) {
    super(`Razorpay ${operation} failed: ${message}`);
    this.name = 'PaymentProviderError';
    this.operation = operation;
    this.status = status;
    this.providerCode = providerCode;
  }
}

const OrderResponse = z.object({
  id: z.string().regex(/^order_[A-Za-z0-9]+$/),
  amount: z.number().int(),
});

const PaymentResponse = z.object({
  id: z.string(),
  amount: z.number().int(),
  status: z.enum(['created', 'authorized', 'captured', 'failed', 'refunded']),
  order_id: z.string().nullable().optional(),
  method: z.string().nullable().optional(),
});

const ErrorResponse = z.object({
  error: z.object({ code: z.string().optional(), description: z.string().optional() }),
});

const PlanResponse = z.object({
  id: z.string().regex(/^plan_[A-Za-z0-9]+$/),
  item: z.object({ amount: z.number().int() }),
});

const SubscriptionResponse = z.object({
  id: z.string().regex(/^sub_[A-Za-z0-9]+$/),
  status: z.enum(['created', 'authenticated', 'active', 'pending', 'halted', 'paused', 'cancelled', 'completed', 'expired']),
  short_url: z.string().nullable().optional(),
  /** Unix seconds. Absent until the member has authorised. */
  charge_at: z.number().int().nullable().optional(),
});

const PAYMENT_ID = /^pay_[A-Za-z0-9]{1,40}$/;
const PLAN_ID = /^plan_[A-Za-z0-9]{1,40}$/;
const SUBSCRIPTION_ID = /^sub_[A-Za-z0-9]{1,40}$/;
const HEX_SHA256 = /^[0-9a-f]{64}$/;

/**
 * Razorpay expresses a cycle as a period plus an interval, and only some combinations are
 * legal. A month count with no period is refused here rather than by the API, so a typo in
 * a plan definition fails locally instead of creating something immutable and wrong.
 */
const PERIOD_BY_INTERVAL_MONTHS: Readonly<Record<number, { period: string; interval: number }>> = {
  1: { period: 'monthly', interval: 1 },
  3: { period: 'monthly', interval: 3 },
  6: { period: 'monthly', interval: 6 },
  12: { period: 'yearly', interval: 1 },
};

/** Constant-time comparison of a presented hex HMAC with the expected one. */
function hmacMatches(payload: string, secret: string, presented: string): boolean {
  if (!HEX_SHA256.test(presented)) return false;
  const expected = createHmac('sha256', secret).update(payload).digest();
  return timingSafeEqual(expected, Buffer.from(presented, 'hex'));
}

export class RazorpayPaymentProvider implements PaymentProvider, SubscriptionProvider {
  readonly name = 'razorpay' as const;
  readonly #config: RazorpayConfig;
  readonly #fetch: typeof fetch;
  readonly #baseUrl: string;

  constructor(config: RazorpayConfig) {
    this.#config = config;
    this.#fetch = config.fetch ?? globalThis.fetch.bind(globalThis);
    this.#baseUrl = config.baseUrl ?? 'https://api.razorpay.com/v1';
  }

  async createOrder(request: CreateOrderRequest): Promise<CreatedOrder> {
    const body = await this.#call('createOrder', 'POST', '/orders', {
      amount: request.amountPaise,
      currency: request.currency,
      receipt: request.receipt,
      ...(request.notes === undefined ? {} : { notes: request.notes }),
    });
    const order = OrderResponse.safeParse(body);
    if (!order.success) throw new PaymentProviderError('createOrder', 'unexpected response shape');

    return { providerOrderId: order.data.id, amountPaise: order.data.amount, publicKeyId: this.#config.keyId };
  }

  verifyCheckoutSignature(request: VerifyCheckoutRequest): boolean {
    return hmacMatches(`${request.providerOrderId}|${request.providerPaymentId}`, this.#config.keySecret, request.signature);
  }

  async fetchPayment(providerPaymentId: string): Promise<FetchedPayment> {
    // The id reaches the URL path, and it arrives from the browser: accept only Razorpay's shape.
    if (!PAYMENT_ID.test(providerPaymentId)) {
      throw new PaymentProviderError('fetchPayment', 'malformed payment id');
    }
    const body = await this.#call('fetchPayment', 'GET', `/payments/${providerPaymentId}`);
    const payment = PaymentResponse.safeParse(body);
    if (!payment.success) throw new PaymentProviderError('fetchPayment', 'unexpected response shape');

    return {
      providerPaymentId: payment.data.id,
      providerOrderId: payment.data.order_id ?? null,
      amountPaise: payment.data.amount,
      status: payment.data.status,
      // The payment entity carries no capture timestamp; confirmation uses our clock.
      capturedAt: null,
      method: payment.data.method ?? null,
    };
  }

  verifyWebhookSignature(rawBody: string, signature: string): boolean {
    return hmacMatches(rawBody, this.#config.webhookSecret, signature);
  }

  // ── Subscriptions: the e-mandate half (ADR-105) ──────────────────────────────

  /**
   * A Razorpay plan is immutable once created — the amount and the cycle cannot be edited,
   * only deactivated. That is why the interval is validated here before the call and why the
   * amount Razorpay echoes back is returned: a plan created for the wrong price is dead
   * weight that still appears in a dropdown.
   */
  async createPlan(request: CreatePlanRequest): Promise<CreatedPlan> {
    const cycle = PERIOD_BY_INTERVAL_MONTHS[request.intervalMonths];
    if (cycle === undefined) {
      throw new PaymentProviderError('createPlan', `no Razorpay period for an interval of ${request.intervalMonths} months`);
    }
    const body = await this.#call('createPlan', 'POST', '/plans', {
      period: cycle.period,
      interval: cycle.interval,
      item: { name: request.name, amount: request.amountPaise, currency: 'INR' },
      ...(request.notes === undefined ? {} : { notes: request.notes }),
    });
    const plan = PlanResponse.safeParse(body);
    if (!plan.success) throw new PaymentProviderError('createPlan', 'unexpected response shape');

    return { providerPlanId: plan.data.id, amountPaise: plan.data.item.amount };
  }

  async createSubscription(request: CreateSubscriptionRequest): Promise<FetchedSubscription> {
    if (!PLAN_ID.test(request.providerPlanId)) {
      throw new PaymentProviderError('createSubscription', 'malformed plan id');
    }
    const body = await this.#call('createSubscription', 'POST', '/subscriptions', {
      plan_id: request.providerPlanId,
      total_count: request.totalCount,
      quantity: 1,
      // Razorpay sends its own authorisation prompt. The gym's WhatsApp message carries the
      // same link, so a member who misses one still gets the other.
      customer_notify: 1,
      ...(request.notes === undefined ? {} : { notes: request.notes }),
    });
    return this.#subscription('createSubscription', body);
  }

  async fetchSubscription(providerSubscriptionId: string): Promise<FetchedSubscription> {
    // The id reaches the URL path and can arrive from a webhook body: accept only the shape.
    if (!SUBSCRIPTION_ID.test(providerSubscriptionId)) {
      throw new PaymentProviderError('fetchSubscription', 'malformed subscription id');
    }
    const body = await this.#call('fetchSubscription', 'GET', `/subscriptions/${providerSubscriptionId}`);
    return this.#subscription('fetchSubscription', body);
  }

  async cancelSubscription(providerSubscriptionId: string, options?: { readonly atCycleEnd?: boolean }): Promise<FetchedSubscription> {
    if (!SUBSCRIPTION_ID.test(providerSubscriptionId)) {
      throw new PaymentProviderError('cancelSubscription', 'malformed subscription id');
    }
    try {
      const body = await this.#call('cancelSubscription', 'POST', `/subscriptions/${providerSubscriptionId}/cancel`, {
        cancel_at_cycle_end: options?.atCycleEnd === true ? 1 : 0,
      });
      return this.#subscription('cancelSubscription', body);
    } catch (error) {
      // Cancelling something already cancelled is the outcome the caller wanted. Razorpay
      // says so with a 400, and treating that as a failure would leave a row stuck ACTIVE
      // in the register while no money is ever taken again.
      if (error instanceof PaymentProviderError && /already cancelled/i.test(error.message)) {
        return { providerSubscriptionId, status: 'cancelled', shortUrl: null, chargeAt: null };
      }
      throw error;
    }
  }

  #subscription(operation: RazorpayOperation, body: unknown): FetchedSubscription {
    const parsed = SubscriptionResponse.safeParse(body);
    if (!parsed.success) throw new PaymentProviderError(operation, 'unexpected response shape');

    const chargeAt = parsed.data.charge_at;
    return {
      providerSubscriptionId: parsed.data.id,
      status: parsed.data.status,
      shortUrl: parsed.data.short_url ?? null,
      // Unix seconds to an instant. Turning it into a business date is the domain's job,
      // with the IST helpers — doing it here would bake a timezone into the adapter.
      chargeAt: chargeAt === undefined || chargeAt === null ? null : new Date(chargeAt * 1000),
    };
  }

  async #call(operation: RazorpayOperation, method: 'GET' | 'POST', path: string, payload?: unknown): Promise<unknown> {
    const credentials = Buffer.from(`${this.#config.keyId}:${this.#config.keySecret}`).toString('base64');

    let response: Response;
    try {
      response = await this.#fetch(`${this.#baseUrl}${path}`, {
        method,
        headers: {
          authorization: `Basic ${credentials}`,
          ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
        signal: AbortSignal.timeout(this.#config.timeoutMs ?? 10_000),
      });
    } catch (error) {
      const reason = error instanceof Error && error.name === 'TimeoutError' ? 'timed out' : 'network error';
      throw new PaymentProviderError(operation, reason);
    }

    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const detail = ErrorResponse.safeParse(body);
      // Razorpay's descriptions are about the request, never the credentials.
      const description = detail.success ? (detail.data.error.description ?? 'request refused') : 'request refused';
      throw new PaymentProviderError(operation, description, response.status, detail.success ? (detail.data.error.code ?? null) : null);
    }
    return body;
  }
}
