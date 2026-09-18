import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations } from 'next-intl/server';
import { isDomainError } from '@mfp/core';
import { RenewFlow } from '@/components/join/renew-flow';
import { buttonVariants } from '@/components/ui/button';
import { getContainer } from '@/lib/container';
import { JoinPage, joinContext } from '@/lib/join-page';
import { loadRenewalOffer, type RenewalOffer } from '@/lib/renewal-offer';

/**
 * `/renew/{token}` — renew from a WhatsApp link (copy deck `renew.*`; BR-3.4).
 *
 * The link is private: not indexed and sent with no referrer. An expired, tampered or
 * unusable link gets the same plain message with a WhatsApp button.
 */

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'renew' });
  return { title: t('metaTitle'), robots: { index: false, follow: false }, referrer: 'no-referrer' };
}

export default async function RenewPage({ params }: { params: Promise<{ locale: string; token: string }> }) {
  const ctx = await joinContext(params);
  const { token } = await params;
  const t = await getTranslations({ locale: ctx.locale, namespace: 'renew' });

  let offer: RenewalOffer | 'blocked' | 'invalid';
  try {
    offer = await loadRenewalOffer(getContainer(), token);
  } catch (error) {
    if (!isDomainError(error)) console.error(`[renew] failed to load: ${error instanceof Error ? error.name : 'Error'}`);
    offer = isDomainError(error) && error.code === 'MEMBER_BLOCKED' ? 'blocked' : 'invalid';
  }

  const messages = await getMessages({ locale: ctx.locale });

  return (
    <JoinPage ctx={ctx}>
      <div className="bg-brand-paper">
        <div className="mx-auto max-w-xl px-5 py-10 md:py-16">
          {typeof offer === 'string' ? (
            <div className="grid gap-5">
              <p role="alert" className="text-body-l leading-body">
                {offer === 'blocked' ? t('blocked') : t('expired')}
              </p>
              <a href={ctx.contact.whatsappHref} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: 'primary' })}>
                {t('whatsapp')}
              </a>
            </div>
          ) : (
            <NextIntlClientProvider messages={{ signup: messages['signup'] as Record<string, unknown>, renew: messages['renew'] as Record<string, unknown> }}>
              <RenewFlow
                token={token}
                firstName={offer.firstName}
                photoUrl={offer.photoUrl}
                currentEndDate={offer.currentEndDate}
                proposedStartDate={offer.proposedStartDate}
                cards={offer.cards}
                deskConfirmsPrice={offer.deskConfirmsPrice}
                today={ctx.today}
                phoneDisplay={ctx.contact.phoneDisplay}
                directionsHref={ctx.contact.directionsHref}
              />
            </NextIntlClientProvider>
          )}
        </div>
      </div>
    </JoinPage>
  );
}
