import { describe, expect, it, vi } from 'vitest';
import type { PutObjectRequest, StorageDriver, StoredObject } from '../ports/storage';
import { attachReceiptPdf, type ReceiptDocument, type ReceiptPdfStore } from './receipt-pdf';

const receipt: ReceiptDocument = {
  paymentId: 'pay_1',
  gymId: 'gym_1',
  receiptNo: 'MF/2026-27/000007',
  paidAt: new Date('2026-09-11T04:30:00Z'),
  amountPaise: 400_000,
  method: 'RAZORPAY',
  gym: { name: 'Max Fitness Gym', addressLine: 'Krishan Plaza', city: 'Indirapuram', state: 'Uttar Pradesh', pincode: '201014', phone: '+919871406350' },
  member: { id: 'mem_1', fullName: 'Priya Sharma', memberCode: 'MF-0012', mobile: '+919876543210', language: 'hi' },
  membership: { durationMonths: 3, startDate: '2026-09-11', endDate: '2026-12-10', pricePaise: 400_000, admissionPaise: 0 },
  receiptPdfKey: null,
};

function fakeStorage() {
  const puts: PutObjectRequest[] = [];
  const deleted: string[] = [];
  const storage = {
    name: 'local',
    put: (request: PutObjectRequest): Promise<StoredObject> => {
      puts.push(request);
      return Promise.resolve({ key: `receipts/object-${puts.length}`, sizeBytes: request.body.byteLength, sha256: 'b'.repeat(64), mimeType: request.mimeType });
    },
    delete: (key: string) => (deleted.push(key), Promise.resolve()),
    get: () => Promise.reject(new Error('unused')),
    exists: () => Promise.resolve(true),
    signedUrl: () => Promise.resolve(''),
  } satisfies StorageDriver;
  return { storage, puts, deleted };
}

describe('attachReceiptPdf', () => {
  const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

  it('renders the receipt, stores it privately and attaches it to the payment', async () => {
    const { storage, puts } = fakeStorage();
    const attach = vi.fn<ReceiptPdfStore['attachReceiptPdf']>(() => Promise.resolve(true));
    const render = vi.fn(() => Promise.resolve(pdf));

    const outcome = await attachReceiptPdf('pay_1', { load: () => Promise.resolve(receipt), render, storage, store: { attachReceiptPdf: attach } });

    expect(outcome).toBe('ATTACHED');
    expect(render).toHaveBeenCalledWith(receipt);
    expect(puts).toEqual([{ body: pdf, mimeType: 'application/pdf', prefix: 'receipts' }]);
    expect(attach).toHaveBeenCalledWith({
      paymentId: 'pay_1',
      gymId: 'gym_1',
      memberId: 'mem_1',
      stored: { key: 'receipts/object-1', sizeBytes: 4, sha256: 'b'.repeat(64), mimeType: 'application/pdf' },
    });
  });

  it('does nothing for a receipt that already has its PDF', async () => {
    const { storage, puts } = fakeStorage();
    const render = vi.fn(() => Promise.resolve(pdf));

    const outcome = await attachReceiptPdf('pay_1', {
      load: () => Promise.resolve({ ...receipt, receiptPdfKey: 'receipts/existing' }),
      render,
      storage,
      store: { attachReceiptPdf: () => Promise.resolve(true) },
    });

    expect(outcome).toBe('ALREADY_ATTACHED');
    expect(render).not.toHaveBeenCalled();
    expect(puts).toHaveLength(0);
  });

  it('removes its own copy when another run attached a PDF first', async () => {
    const { storage, deleted } = fakeStorage();

    const outcome = await attachReceiptPdf('pay_1', {
      load: () => Promise.resolve(receipt),
      render: () => Promise.resolve(pdf),
      storage,
      store: { attachReceiptPdf: () => Promise.resolve(false) },
    });

    expect(outcome).toBe('ALREADY_ATTACHED');
    expect(deleted).toEqual(['receipts/object-1']);
  });

  it('refuses a payment that has no receipt', async () => {
    const { storage } = fakeStorage();
    await expect(
      attachReceiptPdf('pay_x', { load: () => Promise.resolve(null), render: () => Promise.resolve(pdf), storage, store: { attachReceiptPdf: () => Promise.resolve(true) } }),
    ).rejects.toMatchObject({ code: 'PAYMENT_NOT_FOUND' });
  });
});
