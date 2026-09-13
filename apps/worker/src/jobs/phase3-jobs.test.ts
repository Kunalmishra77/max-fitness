import { describe, expect, it, vi } from 'vitest';
import type { ClaimedOutboxEvent } from '@mfp/core';
import { RECEIPT_PDF_QUEUE, outboxHandlers, receiptJobPaymentId } from './phase3-jobs';

const event = (payload: Record<string, unknown>): ClaimedOutboxEvent => ({
  id: 'evt_1',
  gymId: 'gym_1',
  type: 'receipt.pdf',
  payload,
  dedupeKey: 'pdf:pay_1',
  attempts: 0,
});

describe('outboxHandlers', () => {
  it('hands a receipt.pdf event to the receipt queue once per payment', async () => {
    const send = vi.fn(() => Promise.resolve('job_1'));
    const handlers = outboxHandlers({ send });

    await handlers['receipt.pdf']?.(event({ paymentId: 'pay_1' }));

    expect(send).toHaveBeenCalledWith(RECEIPT_PDF_QUEUE, { paymentId: 'pay_1' }, expect.objectContaining({ singletonKey: 'pdf:pay_1' }));
  });

  it('handles only the event types whose phase has landed', () => {
    expect(Object.keys(outboxHandlers({ send: vi.fn() }))).toEqual(['receipt.pdf']);
  });

  it('rejects an event without a payment id, so it is retried and then marked failed', async () => {
    const handlers = outboxHandlers({ send: vi.fn() });
    await expect(handlers['receipt.pdf']?.(event({}))).rejects.toThrow();
  });
});

describe('receiptJobPaymentId', () => {
  it('reads the payment id from a job', () => {
    expect(receiptJobPaymentId({ paymentId: 'pay_1' })).toBe('pay_1');
    expect(receiptJobPaymentId({ paymentId: 42 })).toBeNull();
    expect(receiptJobPaymentId(null)).toBeNull();
  });
});
