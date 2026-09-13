import { randomUUID } from 'node:crypto';
import type {
  CreateOrderRequest,
  CreatedOrder,
  FetchedPayment,
  PaymentProvider,
  VerifyCheckoutRequest,
} from '@mfp/core/ports';

/**
 * The simulated payment gateway (CLAUDE.md §2.7).
 *
 * Lets the whole sign-up journey be demonstrated and end-to-end tested without
 * Razorpay keys or KYC. It deliberately mirrors the real adapter's shape — same
 * order ids, same signature step, same fetch-before-trust flow — so swapping in
 * Razorpay changes one line of wiring and no business logic.
 *
 * Every payment it creates is immediately "captured". Failure paths are exercised
 * by the E2E suite through a magic amount rather than by randomness: a test that
 * fails one time in twenty is worse than no test.
 */

/** An amount ending in these paise makes the simulator fail, for journey 5 in the E2E plan. */
const FAILURE_AMOUNT_SUFFIX = 13;

export class SimulatedPaymentProvider implements PaymentProvider {
  readonly name = 'simulated' as const;
  readonly #orders = new Map<string, { amountPaise: number; receipt: string }>();
  readonly #payments = new Map<string, FetchedPayment>();

  createOrder(request: CreateOrderRequest): Promise<CreatedOrder> {
    const providerOrderId = `order_sim_${randomUUID().replace(/-/g, '').slice(0, 14)}`;
    this.#orders.set(providerOrderId, { amountPaise: request.amountPaise, receipt: request.receipt });
    return Promise.resolve({
      providerOrderId,
      amountPaise: request.amountPaise,
      publicKeyId: 'rzp_test_simulated',
    });
  }

  /**
   * In the simulator a signature is the literal string `sig_<orderId>_<paymentId>`.
   * Checkout produces it and this verifies it, so the verify step is genuinely
   * exercised rather than stubbed to `true` — an invalid signature must still be
   * rejected (case P5).
   */
  verifyCheckoutSignature(request: VerifyCheckoutRequest): boolean {
    return request.signature === expectedSimulatedSignature(request.providerOrderId, request.providerPaymentId);
  }

  fetchPayment(providerPaymentId: string): Promise<FetchedPayment> {
    const known = this.#payments.get(providerPaymentId);
    if (known !== undefined) return Promise.resolve(known);
    return Promise.reject(new Error(`Unknown simulated payment ${providerPaymentId}`));
  }

  /** The simulator has no webhook secret; the CRM's Simulate button is the trigger. */
  verifyWebhookSignature(_rawBody: string, signature: string): boolean {
    return signature === 'simulated';
  }

  // ── Test/demo controls, not part of PaymentProvider ────────────────────────

  /**
   * Complete a checkout, as tapping "Pay" would. Returns what the browser posts back.
   * The demo dialog passes an explicit outcome; without one, the magic amount decides.
   */
  completeCheckout(
    providerOrderId: string,
    options: { outcome?: 'success' | 'failure' } = {},
  ): {
    providerOrderId: string;
    providerPaymentId: string;
    signature: string;
  } {
    const order = this.#orders.get(providerOrderId);
    if (order === undefined) {
      throw new Error(`Unknown simulated order ${providerOrderId}`);
    }

    const providerPaymentId = `pay_sim_${randomUUID().replace(/-/g, '').slice(0, 14)}`;
    const failed =
      options.outcome === undefined ? order.amountPaise % 100 === FAILURE_AMOUNT_SUFFIX : options.outcome === 'failure';

    this.#payments.set(providerPaymentId, {
      providerPaymentId,
      providerOrderId,
      amountPaise: order.amountPaise,
      status: failed ? 'failed' : 'captured',
      capturedAt: failed ? null : new Date(),
      method: 'simulated',
    });

    return {
      providerOrderId,
      providerPaymentId,
      signature: expectedSimulatedSignature(providerOrderId, providerPaymentId),
    };
  }

  reset(): void {
    this.#orders.clear();
    this.#payments.clear();
  }
}

export function expectedSimulatedSignature(orderId: string, paymentId: string): string {
  return `sig_${orderId}_${paymentId}`;
}
