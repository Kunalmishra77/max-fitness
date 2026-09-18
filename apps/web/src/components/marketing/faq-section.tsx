import { getTranslations } from 'next-intl/server';
import { FAQ_ITEMS, type FaqKey } from '@/content/landing-content';
import { jsonLd } from '@/lib/json-ld';
import { ContentFlag } from './brand';
import { ChevronDownIcon } from './icons';
import { Section, SectionHeading } from './section';

/**
 * FAQs (PRD LP-17) with FAQPage structured data (content strategy §4).
 *
 * Native `<details>`/`<summary>` disclosure widgets: keyboard-operable and announced
 * as expandable by browsers themselves, with no client JavaScript to download or
 * hydrate (ADR-030) — the answers stay in the HTML for search engines too.
 *
 * Only verified answers go into structured data. Unverified ones appear on the page
 * only where unconfirmed content is allowed, labelled, and never reach Google.
 */

export interface FaqValues {
  readonly hours: string | null;
  readonly phoneDisplay: string;
  readonly menMonthly: string | null;
  readonly womenMonthly: string | null;
  readonly minAge: number;
}

interface FaqEntry {
  readonly key: FaqKey;
  readonly question: string;
  readonly answer: string;
  readonly unverified: boolean;
}

export async function FaqSection({ showUnconfirmed, values }: { showUnconfirmed: boolean; values: FaqValues }) {
  const t = await getTranslations('faq');
  const tc = await getTranslations('common');

  const answer = (key: FaqKey): string => {
    switch (key) {
      case 'timings':
        return values.hours === null
          ? t('items.timings.aUnknown', { phone: values.phoneDisplay })
          : t('items.timings.a', { hours: values.hours });
      case 'fees':
        return values.menMonthly === null || values.womenMonthly === null
          ? t('items.fees.aUnknown')
          : t('items.fees.a', { menPrice: values.menMonthly, womenPrice: values.womenMonthly });
      case 'minAge':
        return t('items.minAge.a', { minAge: values.minAge });
      default:
        return t(`items.${key}.a`);
    }
  };

  const items: FaqEntry[] = FAQ_ITEMS.filter((item) => item.verified || showUnconfirmed).map((item) => ({
    key: item.key,
    question: t(`items.${item.key}.q`),
    answer: answer(item.key),
    unverified: !item.verified,
  }));

  const structured = items.filter((item) => !item.unverified);

  return (
    <Section tone="white" labelledBy="faq-heading">
      <SectionHeading id="faq-heading" eyebrow={t('eyebrow')} className="text-brand-obsidian">
        {t('h2')}
      </SectionHeading>

      <div className="mt-10 max-w-3xl border-t border-brand-stone/25">
        {items.map((item) => (
          <details key={item.key} className="group border-b border-brand-stone/25">
            <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 py-4 text-left [&::-webkit-details-marker]:hidden">
              <h3 className="font-body text-title leading-ui font-semibold text-brand-obsidian">{item.question}</h3>
              <ChevronDownIcon className="shrink-0 text-[1.25rem] text-brand-obsidian transition-transform duration-[var(--duration-base)] group-open:rotate-180" />
            </summary>
            <div className="pb-5">
              <p className="max-w-[65ch] text-body leading-body">{item.answer}</p>
              {item.unverified ? (
                <p className="mt-2">
                  <ContentFlag tone="onChalk">{tc('needsConfirmation')}</ContentFlag>
                </p>
              ) : null}
            </div>
          </details>
        ))}
      </div>

      {structured.length > 0 ? (
        <script
          type="application/ld+json"
          // Safe: jsonLd() escapes `<`, so no answer text can close the script tag.
          dangerouslySetInnerHTML={{
            __html: jsonLd({
              '@context': 'https://schema.org',
              '@type': 'FAQPage',
              mainEntity: structured.map((item) => ({
                '@type': 'Question',
                name: item.question,
                acceptedAnswer: { '@type': 'Answer', text: item.answer },
              })),
            }),
          }}
        />
      ) : null}
    </Section>
  );
}
