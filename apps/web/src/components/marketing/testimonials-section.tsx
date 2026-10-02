import { getTranslations } from 'next-intl/server';
import type { ReviewItem } from '@/content/landing-content';
import { ContentFlag, Stars } from './brand';
import { Section, SectionHeading } from './section';

/**
 * Testimonials (PRD LP-12, wireframe §10; one line by client request).
 *
 * Real Google reviews only, first name and initial, star rating, excerpt. Demo
 * placeholders appear only where unconfirmed content is allowed and each carries a
 * visible "Demo review" label. With nothing to show, the section is omitted rather
 * than rendered empty.
 *
 * They drift past in a single line instead of filling the page with cards. Three
 * consequences were wanted: the section stops being the tallest thing on a phone, a
 * visitor sees that there are many reviews rather than three, and the eye is drawn
 * without a carousel's buttons. The line **pauses on hover and on keyboard focus**, so
 * a review that catches the eye can be finished; the whole list is written twice so the
 * loop has no seam, and the second copy is hidden from assistive tech. With reduced
 * motion the animation is off and the strip is swiped by hand instead.
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

  const line = (hidden: boolean) => (
    <ul aria-hidden={hidden || undefined} className="flex shrink-0 items-center">
      {reviews.map((review) => (
        <li
          key={review.id}
          className="mx-2 flex min-h-14 shrink-0 items-center gap-3 rounded-full border border-brand-stone/20 bg-brand-white px-5 py-3 whitespace-nowrap shadow-sm"
        >
          <Stars rating={review.rating} label={t('rating', { count: review.rating })} />
          <span className="text-body leading-none text-brand-obsidian">“{review.text}”</span>
          <span className="text-small font-semibold text-brand-stone">— {review.author}</span>
          {review.demo ? <ContentFlag tone="onChalk">{t('demoLabel')}</ContentFlag> : null}
        </li>
      ))}
    </ul>
  );

  return (
    <Section id="reviews" tone="chalk" labelledBy="reviews-heading">
      <SectionHeading id="reviews-heading" eyebrow={t('eyebrow')} className="text-brand-obsidian">
        {t('h2')}
      </SectionHeading>

      {/* Full-bleed: the line should run off both edges rather than stop at the gutter. */}
      <div
        aria-label={t('h2')}
        className="marquee marquee-reviews-wrap -mx-5 mt-10 overflow-hidden md:-mx-8 lg:-mx-12"
      >
        <div className="marquee-reviews flex w-max py-1">
          {line(false)}
          {line(true)}
        </div>
      </div>

      {googleReviewsUrl === null ? null : (
        <a
          href={googleReviewsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-8 inline-flex min-h-11 items-center text-body font-semibold text-brand-link underline underline-offset-4 hover:no-underline"
        >
          {t('readAll')}
        </a>
      )}
    </Section>
  );
}
