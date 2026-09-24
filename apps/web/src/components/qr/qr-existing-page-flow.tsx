'use client';

import { useRouter } from '@/i18n/navigation';
import { postQrExisting } from './post-qr-existing';
import { QrExistingForm } from './qr-existing-form';

/**
 * The form on its page: a reference code takes the member to the "show this" screen.
 *
 * One page rather than nine questions (ADR-075).
 *
 * `otpRequired` is accepted and not used: the form asks for no code, and the switch
 * that would demand one cannot be turned on while the gym has no WhatsApp number
 * (ADR-077). It stays in the signature so the day OTP returns, the page already has it.
 */
export function QrExistingPageFlow(props: {
  today: string;
  minAge: number;
  noticeVersion: string;
  termsHref: string;
  privacyHref: string;
  otpRequired: boolean;
}) {
  const router = useRouter();
  const { otpRequired: _otpRequired, ...rest } = props;
  return <QrExistingForm {...rest} submit={postQrExisting} onSubmitted={(referenceCode) => router.push(`/qr/done/${referenceCode}`)} />;
}
