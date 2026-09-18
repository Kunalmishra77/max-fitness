import { getTranslations } from 'next-intl/server';
import { HeroCarousel, type HeroSlide } from './hero-carousel';
import { LeadForm } from './lead-form';

/**
 * Hero (PRD LP-03, LP-04, wireframe §1): the slider with the call-back form beside it
 * on desktop, and directly beneath it on phones.
 *
 * Slide 1 leads with what is verified about the gym — the owner coaches, since 2000,
 * and the Google rating from settings — rather than an unconfirmed title (ADR-031).
 */
export async function Hero({
  womenMonthly,
  rating,
  reviewCount,
  whatsappHref,
}: {
  womenMonthly: string | null;
  rating: string;
  reviewCount: number;
  whatsappHref: string;
}) {
  const t = await getTranslations('hero');

  const slides: HeroSlide[] = [
    {
      key: 'owner',
      media: 1,
      title: t('slides.owner.title'),
      sub: t('slides.owner.sub', { rating, count: reviewCount }),
    },
    { key: 'beginners', media: 2, title: t('slides.beginners.title'), sub: t('slides.beginners.sub') },
    {
      key: 'women',
      media: 3,
      title: womenMonthly === null ? t('slides.women.titleNoPrice') : t('slides.women.title', { price: womenMonthly }),
      sub: t('slides.women.sub'),
    },
  ];

  return (
    <div className="relative bg-brand-obsidian">
      <HeroCarousel slides={slides} whatsappHref={whatsappHref} />
      <div className="lg:pointer-events-none lg:absolute lg:inset-0">
        {/* Below `lg` the form sits under the slider, aligned with the headline; from `lg` it moves beside it. */}
        <div className="mx-auto flex h-full max-w-[var(--size-content-max)] items-center px-5 pt-2 pb-12 md:px-6 lg:justify-end lg:pt-0 lg:pb-16">
          <div id="call-back" className="w-full scroll-mt-20 md:max-w-md lg:pointer-events-auto lg:w-[24rem]">
            <LeadForm />
          </div>
        </div>
      </div>
    </div>
  );
}
