import { redirect } from 'next/navigation';
import { getPathname } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';
import { qrMetadata } from '@/lib/qr-page';

/**
 * `/qr` — what the reception poster opens (qr-onboarding-flow §1–2; ADR-058, ADR-080).
 *
 * It used to ask "already a member, or new?". The gym asked for the poster to be about
 * existing members only for now — they are importing the register, and a stranger at the
 * desk is served by a person, not a form — so this goes straight to that form. Nobody
 * standing at reception has to choose anything before they start.
 *
 * `/qr/new` still exists and still works; it is simply not what the poster opens.
 */

export const dynamic = 'force-dynamic';

export function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return qrMetadata(params);
}

export default async function QrPosterPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const known = routing.locales.includes(locale as (typeof routing.locales)[number]) ? (locale as (typeof routing.locales)[number]) : routing.defaultLocale;
  redirect(getPathname({ href: '/qr/existing', locale: known }));
}
