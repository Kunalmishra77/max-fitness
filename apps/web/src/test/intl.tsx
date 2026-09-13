import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import en from '../../messages/en.json';

/** Wraps a client component in the English catalogue, as the locale layout does. */
export function WithIntl({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="en" messages={en} timeZone="Asia/Kolkata">
      {children}
    </NextIntlClientProvider>
  );
}
