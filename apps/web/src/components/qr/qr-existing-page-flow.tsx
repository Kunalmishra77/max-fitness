'use client';

import { useRouter } from '@/i18n/navigation';
import { postQrExisting } from './qr-existing-flow';
import { QrExistingForm } from './qr-existing-form';

/**
 * The form on its page: a reference code takes the member to the "show this" screen.
 *
 * One page rather than nine questions (ADR-075). `postQrExisting` still does the
 * talking to the API, because reading the error envelope is the same job either way.
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
