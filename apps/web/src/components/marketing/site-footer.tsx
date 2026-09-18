import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { Wordmark } from './brand';
import type { NavSection } from './site-nav';

/** Footer (PRD LP-20, wireframe §16): NAP, quick links to the page's sections, policies. */

const LEGAL_LINKS = [
  { href: '/legal/privacy', key: 'privacy' },
  { href: '/legal/terms', key: 'terms' },
  { href: '/legal/refund', key: 'refund' },
  { href: '/contact', key: 'contact' },
] as const;

export async function SiteFooter({
  sections,
  sectionHrefPrefix,
  address,
  phoneDisplay,
  telHref,
  hoursSummary,
  year,
}: {
  sections: readonly NavSection[];
  /** `''` on the home page; the localised home path elsewhere, so `#plans` still lands. */
  sectionHrefPrefix: string;
  address: string;
  phoneDisplay: string;
  telHref: string;
  hoursSummary: string | null;
  year: number;
}) {
  const t = await getTranslations('footer');
  const tn = await getTranslations('nav');

  return (
    <footer className="deferred-render border-t-2 border-brand-accent bg-brand-obsidian text-brand-paper">
      <div className="mx-auto grid max-w-[var(--size-content-max)] gap-10 px-5 py-14 md:grid-cols-12 md:gap-6 md:px-6">
        <div className="md:col-span-5">
          <Wordmark />
          <address className="mt-5 max-w-[34ch] text-body leading-body text-brand-paper/85 not-italic">{address}</address>
          <a
            href={telHref}
            data-track="call_click"
            data-track-source="footer"
            className="mt-3 inline-flex min-h-11 items-center font-display text-title font-bold"
          >
            {phoneDisplay}
          </a>
          {hoursSummary === null ? null : (
            <p className="mt-2 max-w-[40ch] text-small leading-body text-brand-paper/75">
              <span className="font-semibold">{t('hours')}:</span> {hoursSummary}
            </p>
          )}
        </div>

        <nav aria-labelledby="footer-quick" className="md:col-span-3 md:col-start-7">
          <h2 id="footer-quick" className="font-body text-small font-semibold text-brand-paper/70">
            {t('quickLinks')}
          </h2>
          <ul className="mt-3 grid">
            {sections.map((id) => (
              <li key={id}>
                <a href={`${sectionHrefPrefix}#${id}`} className="inline-flex min-h-11 items-center text-body hover:underline">
                  {tn(id)}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <nav aria-labelledby="footer-legal" className="md:col-span-3">
          <h2 id="footer-legal" className="font-body text-small font-semibold text-brand-paper/70">
            {t('legalLinks')}
          </h2>
          <ul className="mt-3 grid">
            {LEGAL_LINKS.map((link) => (
              <li key={link.key}>
                <Link href={link.href} className="inline-flex min-h-11 items-center text-body hover:underline">
                  {t(link.key)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      <div className="border-t border-brand-paper/10">
        {/* Extra bottom padding on phones so the sticky action bar never covers the last line. */}
        <p className="mx-auto max-w-[var(--size-content-max)] px-5 pt-5 pb-24 text-small text-brand-paper/65 md:px-6 md:pb-5">
          {t('copyright', { year })}
        </p>
      </div>
    </footer>
  );
}
