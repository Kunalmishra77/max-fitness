'use client';

import Script from 'next/script';
import { useTranslations } from 'next-intl';
import { useEffect, useSyncExternalStore } from 'react';
import { buttonVariants } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';
import { currentConsent, isSiteEvent, propsFromDataset, subscribeConsent, track, writeConsent } from '@/lib/analytics';
import { jsonLd } from '@/lib/json-ld';

/**
 * Analytics loader, click tracking and the consent banner (PRD LP-25).
 *
 * - Scripts for Plausible or GA4 load only after "Allow analytics".
 * - The banner appears only when a provider is configured: asking consent for
 *   analytics that do not exist would be noise.
 * - Clicks on any element with `data-track` are reported through `track()`, which
 *   itself does nothing without consent.
 */
export function Analytics({ plausibleDomain, ga4Id }: { plausibleDomain: string; ga4Id: string }) {
  const configured = plausibleDomain !== '' || ga4Id !== '';
  // On the server and during hydration the choice is unknown: render no banner yet.
  const consent = useSyncExternalStore(subscribeConsent, currentConsent, () => 'unknown' as const);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-track]') : null;
      if (target === null) return;
      const name = target.dataset['track'];
      if (isSiteEvent(name)) track(name, propsFromDataset(target.dataset));
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  if (!configured) return null;

  return (
    <>
      {consent === 'granted' && plausibleDomain !== '' ? (
        <Script src="https://plausible.io/js/script.js" data-domain={plausibleDomain} strategy="afterInteractive" />
      ) : null}
      {consent === 'granted' && ga4Id !== '' ? (
        <>
          <Script src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(ga4Id)}`} strategy="afterInteractive" />
          <Script id="ga4-init" strategy="afterInteractive">
            {`window.dataLayer=window.dataLayer||[];window.gtag=function(){window.dataLayer.push(arguments)};window.gtag('js',new Date());window.gtag('config',${jsonLd(ga4Id)},{anonymize_ip:true});`}
          </Script>
        </>
      ) : null}
      {consent === null ? <ConsentBanner /> : null}
    </>
  );
}

function ConsentBanner() {
  const t = useTranslations('consent');

  return (
    <div
      role="region"
      aria-label={t('label')}
      className="fixed inset-x-3 bottom-[4.75rem] z-50 rounded-panel border border-brand-stone/20 bg-brand-white p-5 text-brand-ink shadow-[var(--shadow-overlay)] md:right-auto md:bottom-6 md:left-6 md:max-w-md"
    >
      <p className="text-body leading-body">{t('body')}</p>
      <Link href="/legal/privacy" className="mt-1 inline-flex min-h-11 items-center text-small font-semibold text-brand-link underline underline-offset-4">
        {t('policy')}
      </Link>
      {/* Equal weight for both answers: declining must be as easy as agreeing. */}
      <div className="mt-2 grid grid-cols-2 gap-3">
        <button type="button" onClick={() => writeConsent('denied')} className={buttonVariants({ variant: 'outlineDark' })}>
          {t('decline')}
        </button>
        <button type="button" onClick={() => writeConsent('granted')} className={buttonVariants({ variant: 'outlineDark' })}>
          {t('accept')}
        </button>
      </div>
    </div>
  );
}
