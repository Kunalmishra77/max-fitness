import { describe, expect, it } from 'vitest';
import { istDate } from '@mfp/shared';
import { buildReceiptMessage, buildVerificationApprovedMessage, buildWelcomeMessage, confirmationText } from './transactional';

/**
 * The messages a member gets because something happened, not because a clock struck
 * (whatsapp-automation-engine §8; BR-6.3, BR-11).
 *
 * Each one is built from what the database already holds, in the member's own language,
 * and carries the key that stops it being sent twice.
 */

describe('buildReceiptMessage', () => {
  it('says what was paid, for what, until when, and with which receipt number', () => {
    const message = buildReceiptMessage({
      paymentId: 'pay_1',
      firstName: 'Priya',
      language: 'en',
      amountPaise: 400_000,
      planLabel: '3 months',
      startDate: istDate('2026-09-23'),
      endDate: istDate('2026-12-22'),
      receiptNo: 'MF/2026-27/000123',
    });

    expect(message).toEqual({
      templateName: 'mf_payment_receipt',
      language: 'en',
      idempotencyKey: 'receipt:pay_1',
      purpose: 'RECEIPT',
      variables: {
        firstName: 'Priya',
        amount: '₹4,000',
        planName: '3 months',
        startDate: '23 Sep 2026',
        endDate: '22 Dec 2026',
        receiptNo: 'MF/2026-27/000123',
      },
    });
  });

  it('writes the amount and the dates the Hindi way for a Hindi member', () => {
    const message = buildReceiptMessage({
      paymentId: 'pay_2',
      firstName: 'संजय',
      language: 'hi',
      amountPaise: 150_000,
      planLabel: '1 महीना',
      startDate: istDate('2026-09-23'),
      endDate: istDate('2026-10-22'),
      receiptNo: 'MF/2026-27/000124',
    });

    expect(message.variables['amount']).toBe('₹1,500');
    expect(message.variables['endDate']).toBe('22 अक्टू॰ 2026');
  });
});

describe('buildWelcomeMessage', () => {
  it('welcomes the member with their code and the gym hours, once per member', () => {
    const message = buildWelcomeMessage({ memberId: 'mem_1', firstName: 'Priya', language: 'en', memberCode: 'MF-0231', hoursLine: 'Mon–Sat 4:30 am – 10:00 pm' });

    expect(message).toEqual({
      templateName: 'mf_welcome_member',
      language: 'en',
      idempotencyKey: 'welcome:mem_1',
      purpose: 'WELCOME',
      variables: { firstName: 'Priya', memberCode: 'MF-0231', hours: 'Mon–Sat 4:30 am – 10:00 pm' },
    });
  });
});

describe('buildVerificationApprovedMessage', () => {
  it('confirms the checked details with the date the fees run to', () => {
    const message = buildVerificationApprovedMessage({ verificationId: 'ver_1', firstName: 'Sanjay', language: 'hi', endDate: istDate('2026-09-30') });

    expect(message).toEqual({
      templateName: 'mf_verification_approved',
      language: 'hi',
      idempotencyKey: 'verification-approved:ver_1',
      purpose: 'VERIFICATION',
      variables: { firstName: 'Sanjay', endDate: '30 सित॰ 2026' },
    });
  });
});

describe('confirmationText', () => {
  it('tells the member the reminders stopped, and how to undo it, in their language', () => {
    expect(confirmationText('UNSUBSCRIBED', 'en')).toContain('You will not get membership reminders');
    expect(confirmationText('UNSUBSCRIBED', 'en')).toContain('Restart');
    expect(confirmationText('UNSUBSCRIBED', 'hi')).toContain('रिमाइंडर');
  });

  it('confirms a restart too', () => {
    expect(confirmationText('RESTARTED', 'en')).toContain('reminders are on again');
    expect(confirmationText('RESTARTED', 'hi')).toContain('फिर से');
  });
});
