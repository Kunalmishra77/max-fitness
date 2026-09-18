'use client';

import useEmblaCarousel from 'embla-carousel-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { preload } from 'react-dom';
import { buttonVariants } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/cn';
import { ChatIcon, PauseIcon, PlayIcon } from './icons';
import { Eyebrow } from './section';

/**
 * Hero slider (PRD LP-03, DESIGN-BLUEPRINT §6.1).
 *
 * - Embla, three slides, 7 s auto-advance that stops on mouse hover, on keyboard
 *   focus, and with the pause button.
 * - The progress indicator is a rep tally: one mark per slide, the current mark
 *   filling like a counted rep. Each mark is a real button.
 * - Posters are plain <picture> elements, so the first paint (and LCP) is an image.
 *   The first slide's posters are preloaded from <head> and decoded synchronously,
 *   so the poster can paint before hydration starts (ADR-030).
 * - Video mounts only for the current slide, only after the page has loaded, and
 *   never with reduced motion or Save-Data. Server render assumes both, so nothing
 *   heavy loads before the client knows.
 * - Reduced motion also turns auto-advance off.
 * - Until the owner's film exists, each slide is one of the gym's own photos drifting
 *   slowly (Ken Burns), restarted with every slide, so the hero moves without a video
 *   download (ADR-061). Set HERO_HAS_VIDEO once real clips are in public/media/hero/.
 * - The headline reveal runs once, on the first slide's first paint.
 */

export interface HeroSlide {
  readonly key: string;
  /** Placeholder clip set in public/media/hero/ (hero1…hero3). */
  readonly media: 1 | 2 | 3;
  readonly title: string;
  readonly sub: string;
}

/** The placeholder clips are gone; the hero is photos until the edited film arrives. */
const HERO_HAS_VIDEO = false;

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';
const PORTRAIT = '(orientation: portrait)';
const LANDSCAPE = '(orientation: landscape)';

function mediaQueryStore(query: string) {
  return {
    subscribe: (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    get: () => window.matchMedia(query).matches,
  };
}

const reducedMotionStore = mediaQueryStore(REDUCED_MOTION);
const portraitStore = mediaQueryStore(PORTRAIT);
const neverChanges = () => () => {};

function useSaveData(): boolean {
  return useSyncExternalStore(
    neverChanges,
    () => (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true,
    () => true,
  );
}

/**
 * True once the page has loaded and the browser has had an idle moment.
 *
 * Video waits for this. Mounted at hydration, it painted over the poster seconds
 * later on a throttled phone and became the Largest Contentful Paint (Lighthouse:
 * 5 s against the 2.5 s budget). After load, the poster has long been painted.
 */
let pageSettled = false;
let settleScheduled = false;
const settledListeners = new Set<() => void>();

function subscribePageSettled(onChange: () => void): () => void {
  settledListeners.add(onChange);
  if (!pageSettled && !settleScheduled) {
    settleScheduled = true;
    const settle = () => {
      pageSettled = true;
      settledListeners.forEach((listener) => listener());
    };
    const whenIdle = () => {
      if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(settle, { timeout: 3000 });
      else window.setTimeout(settle, 200);
    };
    if (document.readyState === 'complete') whenIdle();
    else window.addEventListener('load', whenIdle, { once: true });
  }
  return () => {
    settledListeners.delete(onChange);
  };
}

export function HeroCarousel({ slides, whatsappHref }: { slides: readonly HeroSlide[]; whatsappHref: string }) {
  const t = useTranslations('hero');
  const tc = useTranslations('common');
  const [viewportRef, api] = useEmblaCarousel({ loop: true, duration: 28 });

  const [index, setIndex] = useState(0);
  const [cycle, setCycle] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [keyboardFocus, setKeyboardFocus] = useState(false);

  const reducedMotion = useSyncExternalStore(reducedMotionStore.subscribe, reducedMotionStore.get, () => true);
  const portrait = useSyncExternalStore(portraitStore.subscribe, portraitStore.get, () => true);
  const saveData = useSaveData();
  const settled = useSyncExternalStore(subscribePageSettled, () => pageSettled, () => false);

  const videoAllowed = HERO_HAS_VIDEO && settled && !reducedMotion && !saveData;
  const advancing = !reducedMotion && !paused && !hovered && !keyboardFocus;

  // Emitted into <head> during the server render; each is fetched only when its media query matches.
  const first = slides[0];
  if (first !== undefined) {
    const base = `/media/hero/hero${first.media}`;
    preload(`${base}-mobile-poster.avif`, { as: 'image', type: 'image/avif', media: PORTRAIT, fetchPriority: 'high' });
    preload(`${base}-poster.avif`, { as: 'image', type: 'image/avif', media: LANDSCAPE, fetchPriority: 'high' });
  }

  useEffect(() => {
    if (api === undefined) return;
    const onSelect = () => {
      setIndex(api.selectedScrollSnap());
      setCycle((value) => value + 1);
    };
    api.on('select', onSelect);
    return () => {
      api.off('select', onSelect);
    };
  }, [api]);

  const goTo = useCallback((target: number) => api?.scrollTo(target), [api]);
  const next = useCallback(() => api?.scrollNext(), [api]);

  return (
    <section
      aria-roledescription="carousel"
      aria-label={t('carouselLabel')}
      className="relative bg-brand-obsidian text-brand-paper"
      onPointerEnter={(event) => {
        if (event.pointerType === 'mouse') setHovered(true);
      }}
      onPointerLeave={(event) => {
        if (event.pointerType === 'mouse') setHovered(false);
      }}
      onFocus={(event) => {
        // Hold rotation for keyboard users only; a tap on Play must still play.
        if (event.target.matches(':focus-visible')) setKeyboardFocus(true);
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setKeyboardFocus(false);
      }}
    >
      <div ref={viewportRef} className="overflow-hidden">
        <div className="flex" aria-live={advancing ? 'off' : 'polite'}>
          {slides.map((slide, i) => (
            <div
              key={slide.key}
              role="group"
              aria-roledescription="slide"
              aria-label={t('slideLabel', { n: i + 1, total: slides.length })}
              className="relative flex min-h-[40rem] min-w-0 flex-[0_0_100%] md:min-h-[42rem] lg:min-h-[max(44rem,calc(100svh-4rem))]"
            >
              <SlideMedia
                key={i === index ? `on-${cycle}` : 'off'}
                n={slide.media}
                priority={i === 0}
                portrait={portrait}
                drifting={i === index}
                playVideo={videoAllowed && i === index}
              />
              {/* Legibility scrim over footage, not decoration. */}
              <div
                aria-hidden
                className="absolute inset-0 bg-[linear-gradient(180deg,rgb(10_10_11/0.45)_0%,rgb(10_10_11/0.55)_45%,rgb(10_10_11/0.92)_100%)] lg:bg-[linear-gradient(90deg,rgb(10_10_11/0.94)_0%,rgb(10_10_11/0.72)_45%,rgb(10_10_11/0.25)_100%)]"
              />
              <div className="relative mx-auto flex w-full max-w-[var(--size-content-max)] flex-col justify-end px-5 pt-16 pb-64 md:px-6 md:pb-48 lg:justify-center lg:pb-36">
                <div className="max-w-[36rem] lg:max-w-[calc(100%-26rem)]">
                  <div className={cn('mb-5', i === 0 && 'hero-reveal')}>
                    <Eyebrow onDark>{t('eyebrow')}</Eyebrow>
                  </div>
                  {i === 0 ? (
                    <h1 className="hero-reveal font-display text-display-xl leading-display font-bold tracking-[0.01em] uppercase">{slide.title}</h1>
                  ) : (
                    <p className="font-display text-display-xl leading-display font-bold tracking-[0.01em] uppercase">{slide.title}</p>
                  )}
                  <p
                    className={cn(
                      'mt-5 max-w-[46ch] text-body-l leading-body text-brand-paper/90',
                      i === 0 && 'hero-reveal hero-reveal-late',
                    )}
                  >
                    {slide.sub}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Actions and controls stay put while slides move; pointer events pass through to Embla. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0">
        <div className="mx-auto flex max-w-[var(--size-content-max)] flex-col gap-5 px-5 pb-6 md:px-6 lg:pb-10">
          <div className="pointer-events-auto flex flex-wrap gap-3">
            <Link
              href="/join"
              data-track="signup_started"
              data-track-source="hero"
              className={cn(buttonVariants({ variant: 'primary', size: 'hero' }), 'flex-1 sm:flex-none')}
            >
              {tc('signUp')}
            </Link>
            <a
              href={whatsappHref}
              target="_blank"
              rel="noopener noreferrer"
              data-track="whatsapp_click"
              data-track-source="hero"
              className={cn(buttonVariants({ variant: 'outlineLight', size: 'hero' }), 'flex-1 sm:flex-none')}
            >
              <ChatIcon />
              {tc('whatsapp')}
            </a>
          </div>

          <div className="pointer-events-auto -ml-3 flex items-center">
            {slides.map((slide, i) => (
              <button
                key={slide.key}
                type="button"
                onClick={() => goTo(i)}
                aria-label={t('showSlide', { n: i + 1, total: slides.length })}
                aria-current={i === index ? 'true' : undefined}
                className="flex size-11 items-center justify-center rounded-button"
              >
                <span className="relative block h-7 w-1.5 overflow-hidden rounded-full bg-brand-paper/30">
                  {i === index ? (
                    <span
                      key={cycle}
                      aria-hidden
                      className={cn('absolute inset-0 origin-bottom rounded-full bg-brand-accent-glow', !reducedMotion && 'tally-fill')}
                      style={reducedMotion ? undefined : { animationPlayState: advancing ? 'running' : 'paused' }}
                      onAnimationEnd={next}
                    />
                  ) : null}
                </span>
              </button>
            ))}
            <span aria-hidden className="mr-1 ml-2 font-display text-title font-bold tracking-[0.12em] text-brand-white tabular">
              {String(index + 1).padStart(2, '0')}
              <span className="text-brand-mist"> / {String(slides.length).padStart(2, '0')}</span>
            </span>
            <button
              type="button"
              onClick={() => setPaused((value) => !value)}
              aria-label={paused ? t('play') : t('pause')}
              className="ml-2 inline-flex size-11 items-center justify-center rounded-full border-2 border-brand-paper/60 text-[0.9rem] hover:border-brand-paper"
            >
              {paused ? <PlayIcon /> : <PauseIcon />}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function SlideMedia({
  n,
  priority,
  portrait,
  drifting,
  playVideo,
}: {
  n: number;
  priority: boolean;
  portrait: boolean;
  /** The current slide drifts; the others rest, ready to start from the beginning. */
  drifting: boolean;
  playVideo: boolean;
}) {
  const base = `/media/hero/hero${n}`;
  return (
    <div className="absolute inset-0 overflow-hidden">
      <picture>
        <source media={PORTRAIT} type="image/avif" srcSet={`${base}-mobile-poster.avif`} />
        <source media={PORTRAIT} type="image/webp" srcSet={`${base}-mobile-poster.webp`} />
        <source type="image/avif" srcSet={`${base}-poster.avif`} />
        <img
          src={`${base}-poster.webp`}
          alt=""
          width={1280}
          height={720}
          // The first poster is the LCP element: decode it with the frame, not after.
          decoding={priority ? 'sync' : 'async'}
          loading={priority ? 'eager' : 'lazy'}
          fetchPriority={priority ? 'high' : 'auto'}
          className={cn('absolute inset-0 size-full object-cover', drifting && (n % 2 === 0 ? 'hero-drift hero-drift-alt' : 'hero-drift'))}
        />
      </picture>
      {playVideo ? (
        <video
          key={portrait ? 'portrait' : 'landscape'}
          className="absolute inset-0 size-full object-cover"
          autoPlay
          muted
          playsInline
          loop
          preload="metadata"
          poster={portrait ? `${base}-mobile-poster.webp` : `${base}-poster.webp`}
          aria-hidden="true"
          tabIndex={-1}
        >
          {portrait ? (
            <>
              <source src={`${base}-mobile-720x1280.webm`} type="video/webm" />
              <source src={`${base}-mobile-720x1280.mp4`} type="video/mp4" />
            </>
          ) : (
            <>
              <source src={`${base}-720.webm`} type="video/webm" />
              <source src={`${base}-720.mp4`} type="video/mp4" />
            </>
          )}
        </video>
      ) : null}
    </div>
  );
}
