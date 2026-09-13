import type { Clock } from '@mfp/shared';
import { DomainError } from '../errors';
import type { PaymentRecordStatus } from '../payments/confirm-payment';
import { assertCan, type CrmActor } from './permissions';

/**
 * Voiding a payment (case P9; crm-module-spec §3; BR-11).
 *
 * The owner's correction for money entered wrongly: the payment becomes VOIDED, the
 * membership it confirmed goes back to PENDING_PAYMENT, and an audit row records who,
 * when and why. It needs the owner **and** a PIN entered in the last few minutes, because
 * this is the one action that can make money disappear from the day's total.
 *
 * The receipt number stays on the voided payment. A receipt handed to a member cannot be
 * un-issued, and reusing its number would break the gapless series (BR-11.2); the void is
 * recorded against it instead.
 */

export interface PaymentForVoid {
  readonly id: string;
  readonly gymId: string;
  readonly memberId: string;
  readonly membershipId: string | null;
  readonly amountPaise: number;
  readonly status: PaymentRecordStatus;
  readonly receiptNo: string | null;
  readonly method: string;
}

export interface VoidUpdate {
  readonly voidedById: string;
  readonly voidReason: string;
}

export interface AuditEntry {
  readonly gymId: string;
  readonly actorType: 'staff';
  readonly actorId: string;
  readonly action: 'payment.void';
  readonly entityType: 'Payment';
  readonly entityId: string;
  readonly before: Readonly<Record<string, unknown>>;
  readonly after: Readonly<Record<string, unknown>>;
}

export interface VoidPaymentStore {
  /** Must take a row lock: two owners tapping void at once must not void twice. */
  lockPayment(gymId: string, paymentId: string): Promise<PaymentForVoid | null>;
  voidPayment(paymentId: string, update: VoidUpdate): Promise<void>;
  /** Back to PENDING_PAYMENT, with the confirmation cleared. */
  revertMembership(membershipId: string, at: Date): Promise<void>;
  writeAudit(entry: AuditEntry): Promise<void>;
}

export interface VoidPaymentUnitOfWork {
  transaction<T>(work: (store: VoidPaymentStore) => Promise<T>): Promise<T>;
}

export interface VoidPaymentResult {
  readonly paymentId: string;
  readonly memberId: string;
  readonly membershipId: string | null;
  readonly amountPaise: number;
}

export async function voidPayment(
  input: { readonly paymentId: string; readonly reason: string },
  deps: { readonly actor: CrmActor; readonly clock: Clock; readonly uow: VoidPaymentUnitOfWork },
): Promise<VoidPaymentResult> {
  const now = deps.clock.now();
  assertCan(deps.actor, 'payment.void', now);

  const reason = input.reason.trim();
  if (reason === '') throw new DomainError('VALIDATION_FAILED', 'A void needs a reason');

  return deps.uow.transaction(async (store) => {
    const payment = await store.lockPayment(deps.actor.gymId, input.paymentId);
    if (payment === null) throw new DomainError('PAYMENT_NOT_FOUND', 'No such payment');
    if (payment.status === 'VOIDED' || payment.status === 'REFUNDED') {
      throw new DomainError('PAYMENT_ALREADY_SETTLED', 'This payment was already voided or refunded');
    }
    if (payment.status !== 'PAID') {
      throw new DomainError('CONFLICT', 'Only a paid payment can be voided', { status: payment.status });
    }

    await store.voidPayment(payment.id, { voidedById: deps.actor.staffUserId, voidReason: reason });
    if (payment.membershipId !== null) {
      await store.revertMembership(payment.membershipId, now);
    }
    await store.writeAudit({
      gymId: payment.gymId,
      actorType: 'staff',
      actorId: deps.actor.staffUserId,
      action: 'payment.void',
      entityType: 'Payment',
      entityId: payment.id,
      before: { status: payment.status, amountPaise: payment.amountPaise, receiptNo: payment.receiptNo, membershipId: payment.membershipId },
      after: { status: 'VOIDED', voidReason: reason },
    });

    return { paymentId: payment.id, memberId: payment.memberId, membershipId: payment.membershipId, amountPaise: payment.amountPaise };
  });
}
