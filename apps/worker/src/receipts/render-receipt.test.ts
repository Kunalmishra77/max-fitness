import { describe, expect, it } from 'vitest';
import type { ReceiptDocument } from '@mfp/core';
import { receiptLines, renderReceiptPdf } from './render-receipt';

const receipt: ReceiptDocument = {
  paymentId: 'pay_1',
  gymId: 'gym_1',
  receiptNo: 'MF/2026-27/000007',
  paidAt: new Date('2026-09-11T04:30:00Z'),
  amountPaise: 450_000,
  method: 'RAZORPAY',
  gym: { name: 'Max Fitness Gym', addressLine: 'Krishan Plaza, Plot No. 6', city: 'Indirapuram, Ghaziabad', state: 'Uttar Pradesh', pincode: '201014', phone: '+919871406350' },
  member: { id: 'mem_1', fullName: 'Priya Sharma', memberCode: 'MF-0012', mobile: '+919876543210', language: 'hi' },
  membership: { durationMonths: 3, startDate: '2026-09-11', endDate: '2026-12-10', pricePaise: 400_000, admissionPaise: 50_000 },
  receiptPdfKey: null,
};

describe('receiptLines', () => {
  it('lists what the receipt says, with amounts the built-in PDF font can print', () => {
    expect(receiptLines(receipt)).toEqual({
      header: ['Max Fitness Gym', 'Krishan Plaza, Plot No. 6, Indirapuram, Ghaziabad, Uttar Pradesh 201014', 'Phone +91 98714 06350'],
      details: [
        ['Receipt no.', 'MF/2026-27/000007'],
        ['Date', '11 Sep 2026, 10:00 am'],
        ['Member', 'Priya Sharma'],
        ['Member code', 'MF-0012'],
        ['Plan', '3 months membership, 11 Sep 2026 to 10 Dec 2026'],
        ['Paid by', 'Online (Razorpay)'],
      ],
      amounts: [
        ['Membership fee', 'Rs. 4,000.00'],
        ['Admission fee', 'Rs. 500.00'],
      ],
      total: ['Total paid', 'Rs. 4,500.00'],
      inWords: 'Rupees Four Thousand Five Hundred Only',
      footer: 'This is a computer-generated receipt and needs no signature.',
    });
  });
});

describe('renderReceiptPdf', () => {
  it('produces a real PDF document from those lines', async () => {
    // What the PDF says is proved by receiptLines above; the fonts encode glyphs, so the
    // bytes are checked for being a complete PDF rather than searched for text.
    const pdf = Buffer.from(await renderReceiptPdf(receipt));

    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pdf.subarray(-6).toString('latin1')).toContain('%%EOF');
    expect(pdf.byteLength).toBeGreaterThan(1_000);
  }, 30_000);
});
