import type { ReactNode } from 'react';
import { getPathname } from '@/i18n/navigation';
import type { SiteContext } from '@/lib/site-context';
import { MobileStickyBar, WhatsAppFloat } from './mobile-actions';
import { Preloader } from './preloader';
import { PromoBar } from './promo-bar';
import { SiteFooter } from './site-footer';
import { SiteNav } from './site-nav';

/** Promo bar, navigation, footer and the always-reachable actions around every public page. */
export function MarketingShell({ ctx, onHome, children }: { ctx: SiteContext; onHome: boolean; children: ReactNode }) {
  const { contact } = ctx;

  return (
    <>
      <Preloader />
      {ctx.promo.bar === null ? null : <PromoBar text={ctx.promo.bar} whatsappHref={ctx.promo.whatsappHref} />}
      <SiteNav sections={ctx.navSections} telHref={contact.telHref} phoneDisplay={contact.phoneDisplay} onHome={onHome} />
      <main id="main" tabIndex={-1} className="focus:outline-none">
        {children}
      </main>
      <SiteFooter
        sections={ctx.navSections}
        sectionHrefPrefix={onHome ? '' : getPathname({ href: '/', locale: ctx.locale })}
        address={contact.address}
        phoneDisplay={contact.phoneDisplay}
        telHref={contact.telHref}
        hoursSummary={ctx.hours.summary}
        year={Number(ctx.today.slice(0, 4))}
      />
      <MobileStickyBar telHref={contact.telHref} whatsappHref={contact.whatsappHref} />
      <WhatsAppFloat whatsappHref={contact.whatsappHref} />
    </>
  );
}
