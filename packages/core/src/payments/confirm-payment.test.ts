import { beforeEach, describe, expect, it } from 'vitest';
import type { Clock } from '@mfp/shared';
import { DomainError } from '../errors';
import { fakeClockAt } from '../testing/builders';
import { InMemoryPaymentStore, inMemoryUnitOfWork, seedPendingPayment } from '../testing/payments';
import { confirmPayment } from './confirm-payment';

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    return error instanceof DomainError ? error.code : 'not a DomainError';
  }
  return undefined;
}

describe('confirmPayment', () => {
  let store: InMemoryPaymentStore;
  let clock: Clock;

  beforeEach(() => {
    store = new InMemoryPaymentStore();
    clock = fakeClockAt('2026-09-11T18:30');
    seedPendingPayment(store);
  });

  const payment = (id = 'pay_1') => store.payments.get(id)!;

  const confirm = (overrides: Partial<Parameters<typeof confirmPayment>[0]> = {}) =>
    confirmPayment(
      { providerOrderId: 'order_1', providerPaymentId: 'pay_rzp_1', paidAmountPaise: 400_000, source: 'checkout', ...overrides },
      { clock, uow: inMemoryUnitOfWork(store) },
    );

  it('marks the payment paid, numbers the receipt and activates the member', async () => {
    const result = await confirm();

    expect(result).toEqual({
      outcome: 'CONFIRMED',
      paymentId: 'pay_1',
      memberId: 'mem_1',
      membershipId: 'ms_1',
      receiptNo: 'MF/2026-27/000001',
      memberCode: 'MF-0001',
    });
    expect(payment()).toMatchObject({ status: 'PAID', providerPaymentId: 'pay_rzp_1', signatureOk: true, method: 'RAZORPAY' });
    expect(payment().paidAt).toEqual(clock.now());
    expect(store.memberships.get('ms_1')!.confirmedAt).toEqual(clock.now());
    expect(store.members.get('mem_1')).toEqual({ status: 'ACTIVE', memberCode: 'MF-0001' });
  });

  it('closes the call tasks a payment makes pointless', async () => {
    await confirm();
    expect(store.closedTasks).toEqual([
      {
        memberId: 'mem_1',
        reasons: ['SIGNUP_NOT_PAID', 'EXPIRED_NOT_RENEWED', 'DUE_SOON_NO_RESPONSE', 'EXPIRED_BUT_VISITING'],
      },
    ]);
  });

  it('queues the receipt, the receipt PDF and enrolment, each once', async () => {
    await confirm();
    expect(store.outbox.map((e) => [e.type, e.dedupeKey])).toEqual([
      ['whatsapp.receipt', 'receipt:pay_1'],
      ['receipt.pdf', 'pdf:pay_1'],
      ['kiosk.enroll', 'enroll:mem_1'],
    ]);
    // The owner hears about it from the Alert row, not from a second outbox event (ADR-065).
    expect(store.alerts.map((a) => a.type)).toContain('ONLINE_PAYMENT');
  });

  it('is idempotent: a second confirmation changes nothing (cases P1, P2)', async () => {
    const first = await confirm();
    const second = await confirm({ source: 'webhook' });

    expect(second).toEqual({ ...first, outcome: 'ALREADY_CONFIRMED' });
    expect(store.counters.get('gym_1:receipt:2026-27')).toBe(1);
    expect(store.outbox).toHaveLength(3);
    expect(payment().signatureOk).toBe(true);
  });

  it('records a webhook confirmation without a checkout signature', async () => {
    await confirm({ source: 'webhook' });
    expect(payment()).toMatchObject({ signatureOk: false, method: 'RAZORPAY' });
  });

  it('puts the payment on the CRM bell once', async () => {
    await confirm();
    await confirm({ source: 'webhook' });

    expect(store.alerts).toEqual([
      {
        gymId: 'gym_1',
        type: 'ONLINE_PAYMENT',
        memberId: 'mem_1',
        title: 'crm.alerts.onlinePayment',
        params: { paymentId: 'pay_1', receiptNo: 'MF/2026-27/000001' },
      },
    ]);
  });

  it('raises one system alert for an amount mismatch, however many deliveries report it', async () => {
    await confirm({ paidAmountPaise: 100, source: 'webhook' });
    await confirm({ paidAmountPaise: 100, source: 'webhook' });

    expect(store.alerts).toEqual([
      { gymId: 'gym_1', type: 'SYSTEM', memberId: 'mem_1', title: 'crm.alerts.paymentAmountMismatch', params: { paymentId: 'pay_1', receivedPaise: 100 } },
    ]);
  });

  it('records a simulated payment as SIMULATED', async () => {
    await confirm({ source: 'simulated' });
    expect(payment().method).toBe('SIMULATED');
  });

  it('does not activate when the captured amount differs, and alerts the owner (case P4)', async () => {
    const result = await confirm({ paidAmountPaise: 100 });

    expect(result).toEqual({ outcome: 'AMOUNT_MISMATCH', paymentId: 'pay_1', memberId: 'mem_1' });
    expect(payment()).toMatchObject({ status: 'CREATED', flag: 'AMOUNT_MISMATCH' });
    expect(store.members.get('mem_1')!.status).toBe('PENDING_PAYMENT');
    expect(store.counters.size).toBe(0);
    expect(store.outbox).toEqual([]);
    // Both numbers, so the owner's alert can say what was asked and what arrived.
    expect(store.alerts.at(-1)).toMatchObject({ type: 'SYSTEM', title: 'crm.alerts.paymentAmountMismatch', params: { paymentId: 'pay_1', receivedPaise: 100 } });
  });

  it('confirms a payment that failed before and then succeeded on retry', async () => {
    payment().status = 'FAILED';
    expect((await confirm()).outcome).toBe('CONFIRMED');
  });

  it('refuses an unknown order', async () => {
    expect(await codeOf(confirm({ providerOrderId: 'order_unknown' }))).toBe('PAYMENT_NOT_FOUND');
  });

  it('refuses a payment that was voided or refunded', async () => {
    payment().status = 'VOIDED';
    expect(await codeOf(confirm())).toBe('PAYMENT_ALREADY_SETTLED');
  });

  it("keeps a renewing member's existing code", async () => {
    store.members.get('mem_1')!.memberCode = 'MF-0042';
    const result = await confirm();
    expect(result).toMatchObject({ memberCode: 'MF-0042' });
    expect(store.counters.has('gym_1:member_code')).toBe(false);
  });

  it('starts a new receipt series on 1 April (case P8)', async () => {
    clock = fakeClockAt('2027-03-31T23:30');
    const march = await confirm();
    expect(march).toMatchObject({ receiptNo: 'MF/2026-27/000001' });

    store.payments.set('pay_2', { ...payment(), id: 'pay_2', status: 'CREATED', receiptNo: null, providerOrderId: 'order_2' });
    clock = fakeClockAt('2027-04-01T00:30');
    const april = await confirm({ providerOrderId: 'order_2', providerPaymentId: 'pay_rzp_2' });
    expect(april).toMatchObject({ receiptNo: 'MF/2027-28/000001' });
  });
});
