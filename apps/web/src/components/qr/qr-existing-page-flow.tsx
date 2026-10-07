'use client';

import { useRouter } from '@/i18n/navigation';
import { postQrExisting } from './post-qr-existing';
import { rememberQrAutopay } from './qr-done-autopay';
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
  return (
    <QrExistingForm
      {...rest}
      submit={postQrExisting}
      onSubmitted={(referenceCode, autopay) => {
        // Handed to the next screen rather than put in the URL: a reference code is shown
        // to whoever is at the desk, and a token in the address bar goes with it.
        if (autopay !== undefined) rememberQrAutopay(autopay);
        router.push(`/qr/done/${referenceCode}`);
      }}
    />
  );
}
