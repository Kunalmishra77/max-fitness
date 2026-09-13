import type { OutboxEventInput } from '../ports/outbox';
import type {
  CreateOrderRequest,
  CreatedOrder,
  FetchedPayment,
  PaymentProvider,
  VerifyCheckoutRequest,
} from '../ports/payments';
import type {
  PaidUpdate,
  PaymentAlertRecord,
  PaymentConfirmationStore,
  PaymentConfirmationUnitOfWork,
  PaymentForConfirmation,
} from '../payments/confirm-payment';

/**
 * In-memory payment fakes for unit tests (testing-strategy.md §2).
 *
 * Row locking and concurrency are proved against Postgres in the db integration
 * tests (case P3); these fakes let the payment rules be proved in isolation.
 */

export type StoredPayment = { -readonly [K in keyof PaymentForConfirmation]: PaymentForConfirmation[K] } & {
  providerOrderId: string;
  providerPaymentId?: string;
  paidAt?: Date;
  signatureOk?: boolean;
  method?: string;
  flag?: string;
};

export class InMemoryPaymentStore implements PaymentConfirmationStore {
  readonly payments = new Map<string, StoredPayment>();
  readonly counters = new Map<string, number>();
  readonly memberships = new Map<string, { confirmedAt: Date | null }>();
  readonly members = new Map<string, { memberCode: string | null; status: string }>();
  readonly closedTasks: Array<{ memberId: string; reasons: readonly string[] }> = [];
  readonly outbox: OutboxEventInput[] = [];
  readonly alerts: PaymentAlertRecord[] = [];

  lockPaymentByOrderId(providerOrderId: string): Promise<PaymentForConfirmation | null> {
    const found = [...this.payments.values()].find((p) => p.providerOrderId === providerOrderId);
    return Promise.resolve(found === undefined ? null : { ...found });
  }

  nextCounterValue(gymId: string, key: string): Promise<number> {
    const next = (this.counters.get(`${gymId}:${key}`) ?? 0) + 1;
    this.counters.set(`${gymId}:${key}`, next);
    return Promise.resolve(next);
  }

  markPaymentPaid(paymentId: string, update: PaidUpdate): Promise<void> {
    Object.assign(this.#payment(paymentId), { ...update, status: 'PAID' });
    return Promise.resolve();
  }

  flagPayment(paymentId: string, reason: 'AMOUNT_MISMATCH'): Promise<void> {
    Object.assign(this.#payment(paymentId), { flag: reason, failureReason: reason });
    return Promise.resolve();
  }

  confirmMembership(membershipId: string, confirmedAt: Date): Promise<void> {
    const membership = this.memberships.get(membershipId);
    if (membership === undefined) throw new Error(`No membership ${membershipId}`);
    membership.confirmedAt = confirmedAt;
    return Promise.resolve();
  }

  getMember(memberId: string): Promise<{ id: string; memberCode: string | null }> {
    return Promise.resolve({ id: memberId, memberCode: this.#member(memberId).memberCode });
  }

  activateMember(memberId: string, memberCode: string): Promise<void> {
    Object.assign(this.#member(memberId), { status: 'ACTIVE', memberCode });
    return Promise.resolve();
  }

  closeOpenCallTasks(memberId: string, reasons: readonly string[]): Promise<void> {
    this.closedTasks.push({ memberId, reasons });
    return Promise.resolve();
  }

  createAlert(alert: PaymentAlertRecord): Promise<void> {
    this.alerts.push(alert);
    return Promise.resolve();
  }

  enqueueOutbox(event: OutboxEventInput): Promise<void> {
    if (!this.outbox.some((e) => e.dedupeKey === event.dedupeKey)) this.outbox.push(event);
    return Promise.resolve();
  }

  #payment(paymentId: string): StoredPayment {
    const payment = this.payments.get(paymentId);
    if (payment === undefined) throw new Error(`No payment ${paymentId}`);
    return payment;
  }

  #member(memberId: string): { memberCode: string | null; status: string } {
    const member = this.members.get(memberId);
    if (member === undefined) throw new Error(`No member ${memberId}`);
    return member;
  }
}

export function inMemoryUnitOfWork(store: InMemoryPaymentStore): PaymentConfirmationUnitOfWork {
  return { transaction: (work) => work(store) };
}

/** `pay_1` for ₹4,000 on `order_1`, with membership `ms_1` and a pending member `mem_1`. */
export function seedPendingPayment(store: InMemoryPaymentStore, overrides: Partial<StoredPayment> = {}): StoredPayment {
  const payment: StoredPayment = {
    id: 'pay_1',
    gymId: 'gym_1',
    memberId: 'mem_1',
    membershipId: 'ms_1',
    amountPaise: 400_000,
    status: 'CREATED',
    receiptNo: null,
    failureReason: null,
    providerOrderId: 'order_1',
    ...overrides,
  };
  store.payments.set(payment.id, payment);
  store.memberships.set('ms_1', { confirmedAt: null });
  store.members.set('mem_1', { memberCode: null, status: 'PENDING_PAYMENT' });
  return payment;
}

/** A payment provider whose signatures and payments a test controls. */
export class FakePaymentProvider implements PaymentProvider {
  readonly name: 'razorpay' | 'simulated';
  readonly orders: CreateOrderRequest[] = [];
  readonly payments = new Map<string, FetchedPayment>();
  readonly fetched: string[] = [];
  static readonly VALID_SIGNATURE = 'valid-checkout-signature';
  static readonly VALID_WEBHOOK_SIGNATURE = 'valid-webhook-signature';

  constructor(name: 'razorpay' | 'simulated' = 'razorpay') {
    this.name = name;
  }

  createOrder(request: CreateOrderRequest): Promise<CreatedOrder> {
    this.orders.push(request);
    return Promise.resolve({
      providerOrderId: `order_${this.orders.length}`,
      amountPaise: request.amountPaise,
      publicKeyId: 'rzp_test_key',
    });
  }

  verifyCheckoutSignature(request: VerifyCheckoutRequest): boolean {
    return request.signature === FakePaymentProvider.VALID_SIGNATURE;
  }

  fetchPayment(providerPaymentId: string): Promise<FetchedPayment> {
    this.fetched.push(providerPaymentId);
    const payment = this.payments.get(providerPaymentId);
    return payment === undefined ? Promise.reject(new Error(`Unknown payment ${providerPaymentId}`)) : Promise.resolve(payment);
  }

  verifyWebhookSignature(_rawBody: string, signature: string): boolean {
    return signature === FakePaymentProvider.VALID_WEBHOOK_SIGNATURE;
  }

  /** Record a payment as the provider would see it. */
  addPayment(payment: Partial<FetchedPayment> & { providerPaymentId: string }): void {
    this.payments.set(payment.providerPaymentId, {
      providerOrderId: 'order_1',
      amountPaise: 400_000,
      status: 'captured',
      capturedAt: null,
      method: 'upi',
      ...payment,
    });
  }
}
