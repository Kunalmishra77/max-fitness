import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { LegalBody } from '@/components/legal/legal-body';
import { MarketingShell } from '@/components/marketing/marketing-shell';
import type { Locale } from '@/i18n/routing';
import { parseLegalMarkdown } from '@/lib/legal-markdown';
import { alternatesFor } from '@/lib/seo';
import { getSiteContext } from '@/lib/site-context';

/**
 * Privacy, Terms and Refund pages (PRD LP-22) from content/legal/*.md.
 *
 * The drafts are English. The Hindi route says so and shows the English text rather
 * than an unreviewed legal translation. Outside production every page carries the
 * "DRAFT — pending client review" banner. Statically cached (ADR-032).
 */

export const revalidate = 300;

/** Rendered statically on first visit rather than at build time, like the rest of the site (ADR-032). */
export function generateStaticParams(): Array<{ slug: string }> {
  return [];
}

const LEGAL_SLUGS = ['privacy', 'terms', 'refund'] as const;
type LegalSlug = (typeof LEGAL_SLUGS)[number];

function isLegalSlug(value: string): value is LegalSlug {
  return (LEGAL_SLUGS as readonly string[]).includes(value);
}

async function loadDocument(slug: LegalSlug) {
  // next dev and next start both run from apps/web; next.config traces content/legal.
  const source = await readFile(path.join(process.cwd(), 'content', 'legal', `${slug}.md`), 'utf8');
  return parseLegalMarkdown(source);
}

type Params = Promise<{ locale: string; slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!isLegalSlug(slug)) return {};
  const t = await getTranslations({ locale, namespace: 'legal' });
  return { title: t(`titles.${slug}`), alternates: alternatesFor(`/legal/${slug}`, locale as Locale) };
}

export default async function LegalPage({ params }: { params: Params }) {
  const { locale: rawLocale, slug } = await params;
  const locale = rawLocale as Locale;
  if (!isLegalSlug(slug)) notFound();
  setRequestLocale(locale);

  const [ctx, doc, t, format] = await Promise.all([
    getSiteContext(locale),
    loadDocument(slug),
    getTranslations('legal'),
    getFormatter(),
  ]);

  return (
    <MarketingShell ctx={ctx} onHome={false}>
      <div className="bg-brand-paper">
        <article className="mx-auto max-w-3xl px-5 py-12 md:py-16">
          {ctx.showUnconfirmed ? (
            <p className="mb-8 rounded-panel border-2 border-semantic-fee-due-soon bg-tint-fee-due-soon-bg p-4 text-body font-semibold">
              {t('draft')}
            </p>
          ) : null}
          {locale === 'hi' ? <p className="mb-6 text-body leading-body text-brand-stone">{t('hiPending')}</p> : null}

          <h1 className="font-display text-display-l leading-display font-bold text-brand-obsidian">{t(`titles.${slug}`)}</h1>
          {doc.updated === null ? null : (
            <p className="mt-3 text-small text-brand-stone">
              {t('updated', { date: format.dateTime(new Date(`${doc.updated}T00:00:00+05:30`), 'short') })}
            </p>
          )}

          <LegalBody blocks={doc.blocks} lang={locale === 'hi' ? 'en' : undefined} />
        </article>
      </div>
    </MarketingShell>
  );
}
