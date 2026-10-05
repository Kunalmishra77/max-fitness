import type { ISTDate } from '@mfp/shared';

/**
 * Payment gateway.
 *
 * Implementations: `razorpay` (Orders API + Standard Checkout + webhooks) and
 * `simulated` for DEMO_MODE and tests. Both paths converge on the same
 * `confirmPayment()` in the domain, so a desk cash entry and an online card payment
 * produce the same `Payment` row (project-analysis D7).
 */

export interface CreateOrderRequest {
  /** Integer paise, computed server-side from plan + settings (BR-11.3). */
  readonly amountPaise: number;
  readonly currency: 'INR';
  /** Our `Payment.id`, sent as the provider receipt so the two can always be reconciled. */
  readonly receipt: string;
  readonly notes?: Readonly<Record<string, string>>;
}

export interface CreatedOrder {
  readonly providerOrderId: string;
  readonly amountPaise: number;
  /** Publishable key the browser needs. Never the secret. */
  readonly publicKeyId: string;
}

export interface VerifyCheckoutRequest {
  readonly providerOrderId: string;
  readonly providerPaymentId: string;
  /** HMAC-SHA256 over `order_id|payment_id`, verified with a constant-time compare. */
  readonly signature: string;
}

export interface FetchedPayment {
  readonly providerPaymentId: string;
  readonly providerOrderId: string | null;
  readonly amountPaise: number;
  readonly status: 'created' | 'authorized' | 'captured' | 'failed' | 'refunded';
  readonly capturedAt: Date | null;
  readonly method: string | null;
}

export interface PaymentProvider {
  readonly name: 'razorpay' | 'simulated';
  createOrder(request: CreateOrderRequest): Promise<CreatedOrder>;
  /** True only when the signature is valid. Never throws on a bad signature. */
  verifyCheckoutSignature(request: VerifyCheckoutRequest): boolean;
  /** Source of truth for the amount — never trust the client (BR-11.3, case P4). */
  fetchPayment(providerPaymentId: string): Promise<FetchedPayment>;
  /** Verify a webhook body's HMAC against the raw bytes (TRD §7). */
  verifyWebhookSignature(rawBody: string, signature: string): boolean;
}

/** A payment recorded at the desk: cash, UPI, card machine or bank transfer. */
export interface DeskPaymentInput {
  readonly amountPaise: number;
  readonly method: 'CASH' | 'UPI_DIRECT' | 'CARD_POS' | 'BANK_TRANSFER';
  readonly paidOn: ISTDate;
  readonly recordedByStaffId: string;
}

/**
 * Recurring payments — an e-mandate, which Razorpay models as a subscription (ADR-105).
 *
 * Deliberately separate from `PaymentProvider`. The simulated provider has no mandate to
 * offer: `DEMO_MODE` confirms through the pay dialog and answers 404 on the webhook, so a
 * demo mandate would be a fiction that behaved like the real thing. Code that needs a
 * mandate asks for this port and finds nothing in demo, which is the truth.
 *
 * A plan is created once per price and shared by every member on it. A subscription is one
 * member's standing instruction against that plan.
 */

export interface CreatePlanRequest {
  /** Shown to the member in their UPI app and on the bank statement. */
  readonly name: string;
  /** Integer paise, copied from the gym's own `Plan.pricePaise` (CLAUDE.md §2.1). */
  readonly amountPaise: number;
  /** 1 for the monthly plans this gym sells. Anything a provider has no period for is refused. */
  readonly intervalMonths: number;
  readonly notes?: Readonly<Record<string, string>>;
}

export interface CreatedPlan {
  readonly providerPlanId: string;
  /** Echoed back by the provider, so a mismatch with what we asked for is visible. */
  readonly amountPaise: number;
}

export interface CreateSubscriptionRequest {
  readonly providerPlanId: string;
  /**
   * How many debits the mandate authorises. Razorpay requires a finite count, so there is
   * no truly open-ended standing instruction; the caller passes a span long enough that the
   * member will have left or renewed by then.
   */
  readonly totalCount: number;
  readonly notes?: Readonly<Record<string, string>>;
}

/** Razorpay's own subscription states, which `MandateStatus` mirrors one for one. */
export type SubscriptionStatus =
  | 'created'
  | 'authenticated'
  | 'active'
  | 'pending'
  | 'halted'
  | 'paused'
  | 'cancelled'
  | 'completed'
  | 'expired';

export interface FetchedSubscription {
  readonly providerSubscriptionId: string;
  readonly status: SubscriptionStatus;
  /** The link the member opens to authorise. Only present while it is still usable. */
  readonly shortUrl: string | null;
  /** When the provider says it will debit next, or `null` before authorisation. */
  readonly chargeAt: Date | null;
}

export interface SubscriptionProvider {
  readonly name: 'razorpay';
  createPlan(request: CreatePlanRequest): Promise<CreatedPlan>;
  createSubscription(request: CreateSubscriptionRequest): Promise<FetchedSubscription>;
  fetchSubscription(providerSubscriptionId: string): Promise<FetchedSubscription>;
  /**
   * Immediately by default, so the member is not debited again while somebody works out
   * what went wrong. `atCycleEnd` lets a member who has already paid for this month keep it.
   *
   * Cancelling something the provider has already cancelled is not a failure.
   */
  cancelSubscription(providerSubscriptionId: string, options?: { readonly atCycleEnd?: boolean }): Promise<FetchedSubscription>;
}
