'use client';

import { useRouter } from '@/i18n/navigation';
import { QrExistingFlow } from './qr-existing-flow';

/** The wizard on its page: a reference code takes the member to the "show this" screen. */
export function QrExistingPageFlow(props: {
  today: string;
  minAge: number;
  noticeVersion: string;
  termsHref: string;
  privacyHref: string;
  otpRequired: boolean;
}) {
  const router = useRouter();
  return <QrExistingFlow {...props} onSubmitted={(referenceCode) => router.push(`/qr/done/${referenceCode}`)} />;
}
