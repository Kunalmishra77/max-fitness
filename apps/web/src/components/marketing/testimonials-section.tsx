import { getTranslations } from 'next-intl/server';
import type { ReviewItem } from '@/content/landing-content';
import { ContentFlag, Stars } from './brand';
import { Section, SectionHeading } from './section';

/**
 * Testimonials (PRD LP-12, wireframe §10).
 *
 * Real Google reviews only, first name and initial, star rating, excerpt. Demo
 * placeholders appear only where unconfirmed content is allowed and each carries a
 * visible "Demo review" label. With nothing to show, the section is omitted rather
 * than rendered empty.
 */
export async function TestimonialsSection({
  reviews,
  googleReviewsUrl,
}: {
  reviews: readonly ReviewItem[];
  googleReviewsUrl: string | null;
}) {
  if (reviews.length === 0) return null;
  const t = await getTranslations('reviews');

  return (
    <Section id="reviews" tone="chalk" labelledBy="reviews-heading">
      <SectionHeading id="reviews-heading" className="text-brand-plate-navy">
        {t('h2')}
      </SectionHeading>

      {/* Swipeable on phones; focusable so keyboard users can scroll it too (WCAG 2.1.1). */}
      <ul
        tabIndex={0}
        aria-label={t('h2')}
        className="-mx-5 mt-10 flex snap-x snap-mandatory gap-4 overflow-x-auto px-5 pb-2 md:mx-0 md:grid md:grid-cols-3 md:gap-6 md:overflow-visible md:px-0"
      >
        {reviews.map((review) => (
          <li
            key={review.id}
            className="flex w-[85%] shrink-0 snap-start flex-col rounded-panel border border-brand-rubber-grey/20 bg-brand-white p-6 md:w-auto"
          >
            <div className="flex items-center justify-between gap-3">
              <Stars rating={review.rating} label={t('rating', { count: review.rating })} />
              {review.demo ? <ContentFlag tone="onChalk">{t('demoLabel')}</ContentFlag> : null}
            </div>
            <blockquote className="mt-4 flex-1 text-body leading-body">“{review.text}”</blockquote>
            <p className="mt-5 text-small font-semibold text-brand-plate-navy">
              {review.author} <span className="font-medium text-brand-rubber-grey">· {t('source')}</span>
            </p>
          </li>
        ))}
      </ul>

      {googleReviewsUrl === null ? null : (
        <a
          href={googleReviewsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-8 inline-flex min-h-11 items-center text-body font-semibold text-brand-wall-blue underline underline-offset-4 hover:no-underline"
        >
          {t('readAll')}
        </a>
      )}
    </Section>
  );
}
