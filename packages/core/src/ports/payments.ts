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
