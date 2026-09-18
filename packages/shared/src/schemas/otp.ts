import { z } from 'zod';
import { isValidIndianMobile, toE164 } from '../phone';

/** One-time codes and the lookup they unlock (api-specification §/otp, §/qr/lookup; ADR-060). */

const mobile = z
  .string()
  .trim()
  .refine(isValidIndianMobile, { message: 'mobile' })
  .transform((value) => toE164(value));

/** What a phone on the website may ask a code for; staff PIN resets are not among them. */
export const OTP_PUBLIC_PURPOSES = ['SIGNUP', 'QR_EXISTING'] as const;

export const OtpSendSchema = z.object({
  mobile,
  purpose: z.enum(OTP_PUBLIC_PURPOSES, { message: 'purpose' }),
});

export const OtpVerifySchema = OtpSendSchema.extend({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, { message: 'code' }),
});

export const QrLookupSchema = z.object({
  mobile,
  otpToken: z.string().min(1, { message: 'otpToken' }).max(1_000, { message: 'otpToken' }),
});
