import { describe, expect, it } from 'vitest';
import { OtpSendSchema, OtpVerifySchema, QrLookupSchema } from './otp';

describe('one-time code schemas', () => {
  it('takes any spelling of an Indian mobile and a known purpose', () => {
    expect(OtpSendSchema.parse({ mobile: '98765 43210', purpose: 'QR_EXISTING' })).toEqual({
      mobile: '+919876543210',
      purpose: 'QR_EXISTING',
    });
    expect(OtpSendSchema.safeParse({ mobile: '12345', purpose: 'QR_EXISTING' }).success).toBe(false);
    // Staff PIN resets are not something a phone on the website may ask for.
    expect(OtpSendSchema.safeParse({ mobile: '9876543210', purpose: 'CRM_LOGIN_RESET' }).success).toBe(false);
  });

  it('wants exactly six digits for a code', () => {
    expect(
      OtpVerifySchema.parse({ mobile: '9876543210', purpose: 'QR_EXISTING', code: ' 482913 ' }).code,
    ).toBe('482913');
    expect(
      OtpVerifySchema.safeParse({ mobile: '9876543210', purpose: 'QR_EXISTING', code: '48291' }).success,
    ).toBe(false);
  });

  it('needs a token for a lookup', () => {
    expect(QrLookupSchema.safeParse({ mobile: '9876543210', otpToken: '' }).success).toBe(false);
    expect(QrLookupSchema.parse({ mobile: '9876543210', otpToken: 'abc.def' })).toEqual({
      mobile: '+919876543210',
      otpToken: 'abc.def',
    });
  });
});
