import { beforeEach, describe, expect, it } from 'vitest';
import { fakeClockAt, ist } from '../testing/builders';
import type { CrmActor } from './permissions';
import { voidPayment, type AuditEntry, type PaymentForVoid, type VoidPaymentStore, type VoidUpdate } from './void-payment';

/**
 * Voiding a desk payment (case P9; crm-module-spec §3; BR-11).
 *
 * The owner's escape hatch for "I typed the wrong thing": the payment is marked VOIDED,
 * the membership it confirmed goes back to PENDING_PAYMENT, and an audit row records who
 * did it and why. The receipt number stays on the payment — a receipt that was handed
 * over cannot be un-issued, and the series must stay gapless (BR-11.2).
 */

const NOW = ist('2026-09-12T11:30');
const elevated = new Date(NOW.getTime() + 60_000);
const owner: CrmActor = { staffUserId: 'staff_1', gymId: 'gym_1', role: 'OWNER', elevatedUntil: elevated, receptionMayTakePayments: true };
const reception: CrmActor = { ...owner, staffUserId: 'staff_2', role: 'RECEPTION' };

const paid: PaymentForVoid = {
  id: 'pay_1',
  gymId: 'gym_1',
  memberId: 'mem_1',
  membershipId: 'ms_1',
  amountPaise: 400_000,
  status: 'PAID',
  receiptNo: 'MF/2026-27/000007',
  method: 'CASH',
};

class FakeStore implements VoidPaymentStore {
  payment: PaymentForVoid | null = paid;
  readonly voided: Array<VoidUpdate & { paymentId: string }> = [];
  readonly reverted: Array<{ membershipId: string; at: Date }> = [];
  readonly audit: AuditEntry[] = [];

  lockPayment(gymId: string, paymentId: string) {
    return Promise.resolve(this.payment?.id === paymentId && this.payment.gymId === gymId ? this.payment : null);
  }
  voidPayment(paymentId: string, update: VoidUpdate) {
    this.voided.push({ paymentId, ...update });
    return Promise.resolve();
  }
  revertMembership(membershipId: string, at: Date) {
    this.reverted.push({ membershipId, at });
    return Promise.resolve();
  }
  writeAudit(entry: AuditEntry) {
    this.audit.push(entry);
    return Promise.resolve();
  }
}

describe('voidPayment', () => {
  let store: FakeStore;
  const clock = fakeClockAt('2026-09-12T11:30');

  beforeEach(() => {
    store = new FakeStore();
  });

  const run = (reason = 'गलत रकम डाल दी', actor: CrmActor = owner) =>
    voidPayment({ paymentId: 'pay_1', reason }, { actor, clock, uow: { transaction: (work) => work(store) } });

  it('voids the payment, puts the membership back to unpaid and records who and why', async () => {
    const result = await run();

    expect(result).toEqual({ paymentId: 'pay_1', memberId: 'mem_1', membershipId: 'ms_1', amountPaise: 400_000 });
    expect(store.voided).toEqual([{ paymentId: 'pay_1', voidedById: 'staff_1', voidReason: 'गलत रकम डाल दी' }]);
    expect(store.reverted).toEqual([{ membershipId: 'ms_1', at: clock.now() }]);
    expect(store.audit).toEqual([
      {
        gymId: 'gym_1',
        actorType: 'staff',
        actorId: 'staff_1',
        action: 'payment.void',
        entityType: 'Payment',
        entityId: 'pay_1',
        before: { status: 'PAID', amountPaise: 400_000, receiptNo: 'MF/2026-27/000007', membershipId: 'ms_1' },
        after: { status: 'VOIDED', voidReason: 'गलत रकम डाल दी' },
      },
    ]);
  });

  it('leaves the receipt number on the voided payment, so the series stays gapless', async () => {
    await run();
    // Nothing in the update clears it.
    expect(store.voided[0]).not.toHaveProperty('receiptNo');
  });

  it('needs the owner and a PIN entered a moment ago', async () => {
    await expect(run('typo', reception)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(run('typo', { ...owner, elevatedUntil: null })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(run('typo', { ...owner, elevatedUntil: new Date(NOW.getTime() - 1_000) })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('needs a reason', async () => {
    await expect(run('   ')).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(store.voided).toEqual([]);
  });

  it('refuses an unknown payment, one already voided, and one that was never paid', async () => {
    store.payment = null;
    await expect(run()).rejects.toMatchObject({ code: 'PAYMENT_NOT_FOUND' });

    store.payment = { ...paid, status: 'VOIDED' };
    await expect(run()).rejects.toMatchObject({ code: 'PAYMENT_ALREADY_SETTLED' });

    store.payment = { ...paid, status: 'CREATED', receiptNo: null };
    await expect(run()).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('voids a payment that never had a membership, such as a correction', async () => {
    store.payment = { ...paid, membershipId: null };
    await expect(run()).resolves.toMatchObject({ membershipId: null });
    expect(store.reverted).toEqual([]);
  });
});
