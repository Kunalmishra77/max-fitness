import type { Language } from '@mfp/shared';
import { DomainError } from '../errors';
import type { StorageDriver, StoredObject } from '../ports/storage';

/**
 * The receipt PDF (signup-and-payment-flow.md §7).
 *
 * Queued by payment confirmation and run by the worker: render the paid receipt, store
 * it as a private object, attach it to the payment. Safe to run twice — a receipt that
 * already has its PDF is left alone, and if two runs race, the loser deletes its copy.
 */

/** Everything a receipt shows. The web receipt page and the PDF read the same record. */
export interface ReceiptDocument {
  readonly paymentId: string;
  readonly gymId: string;
  readonly receiptNo: string;
  readonly paidAt: Date;
  readonly amountPaise: number;
  readonly method: 'RAZORPAY' | 'CASH' | 'UPI_DIRECT' | 'CARD_POS' | 'BANK_TRANSFER' | 'SIMULATED';
  readonly gym: {
    readonly name: string;
    readonly addressLine: string;
    readonly city: string;
    readonly state: string;
    readonly pincode: string;
    readonly phone: string;
  };
  readonly member: { readonly id: string; readonly fullName: string; readonly memberCode: string | null; readonly mobile: string; readonly language: Language };
  readonly membership: {
    readonly durationMonths: number | null;
    readonly startDate: string | null;
    readonly endDate: string;
    readonly pricePaise: number;
    readonly admissionPaise: number;
  } | null;
  /** The stored PDF, once rendered. */
  readonly receiptPdfKey: string | null;
}

export interface ReceiptPdfStore {
  /** Records the PDF against the payment. `false` when the payment already has one. */
  attachReceiptPdf(record: { paymentId: string; gymId: string; memberId: string; stored: StoredObject }): Promise<boolean>;
}

export type AttachReceiptOutcome = 'ATTACHED' | 'ALREADY_ATTACHED';

export async function attachReceiptPdf(
  paymentId: string,
  deps: {
    readonly load: (paymentId: string) => Promise<ReceiptDocument | null>;
    readonly render: (receipt: ReceiptDocument) => Promise<Uint8Array>;
    readonly storage: StorageDriver;
    readonly store: ReceiptPdfStore;
  },
): Promise<AttachReceiptOutcome> {
  const receipt = await deps.load(paymentId);
  if (receipt === null) throw new DomainError('PAYMENT_NOT_FOUND', 'No paid payment with that id');
  if (receipt.receiptPdfKey !== null) return 'ALREADY_ATTACHED';

  const body = await deps.render(receipt);
  const stored = await deps.storage.put({ body, mimeType: 'application/pdf', prefix: 'receipts' });

  const attached = await deps.store.attachReceiptPdf({ paymentId, gymId: receipt.gymId, memberId: receipt.member.id, stored });
  if (!attached) {
    await deps.storage.delete(stored.key);
    return 'ALREADY_ATTACHED';
  }
  return 'ATTACHED';
}
