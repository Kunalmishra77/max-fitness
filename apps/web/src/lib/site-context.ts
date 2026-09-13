import { getTranslations } from 'next-intl/server';
import { activePromos, groupHours, planCards, weekHours } from '@mfp/core';
import { systemClock, todayIST, type E164Mobile, type ISTDate, type ISTTime } from '@mfp/shared';
import type { HoursTableRow } from '@/components/marketing/hours-table';
import type { NavSection } from '@/components/marketing/site-nav';
import { DEMO_REVIEWS, REAL_REVIEWS, showUnconfirmedContent, type ReviewItem } from '@/content/landing-content';
import type { Locale } from '@/i18n/routing';
import { getContainer } from './container';
import { formatTime, price } from './format';
import { getLandingData, type LandingData } from './landing-data';
import { SITE_FALLBACK, directionsHref, displayPhone, mapEmbedSrc, telHref, whatsappHref } from './site';

/**
 * Everything the public pages derive from settings and plans, worked out once per render
 * so the page, the navigation, the footer and structured data agree. Components receive
 * finished values; none of them reads settings directly.
 *
 * Nothing here depends on the time of day: pages are served from a static cache
 * (ADR-032), and the one time-of-day detail — today's row in the hours table — is
 * decided in the browser. `today` is used only for things that change by the day at
 * most (the promo window, years operating, the footer year) and is refreshed with the
 * cache.
 */

export interface SiteContext {
  readonly locale: Locale;
  readonly data: LandingData;
  readonly today: ISTDate;
  readonly showUnconfirmed: boolean;
  readonly contact: {
    readonly name: string;
    readonly phone: E164Mobile;
    readonly phoneDisplay: string;
    readonly telHref: string;
    readonly whatsappHref: string;
    readonly address: string;
    readonly postal: {
      readonly streetAddress: string;
      readonly locality: string;
      readonly region: string;
      readonly postalCode: string;
    };
    readonly directionsHref: string;
    readonly mapSrc: string;
  };
  readonly promo: { readonly bar: string | null; readonly banner: string | null; readonly whatsappHref: string };
  readonly hours: {
    readonly rows: readonly HoursTableRow[];
    /** "Mon–Sat 4:30 am – 10:00 pm; Sun Closed" — the whole week, or `null` without hours. */
    readonly summary: string | null;
    /** The first open run of days, e.g. "Mon–Sat 4:30 am – 10:00 pm", for the trust strip and About. */
    readonly line: string | null;
  };
  readonly monthly: { readonly men: string | null; readonly women: string | null };
  /** Google rating as printed ("4.8") and its review count, from settings. */
  readonly rating: { readonly google: string; readonly googleReviews: number };
  readonly reviews: readonly ReviewItem[];
  readonly navSections: readonly NavSection[];
}

function currentClock() {
  try {
    return getContainer().clock;
  } catch {
    // The page must render even when configuration is broken (ADR-022).
    return systemClock;
  }
}

/** Short weekday names, 0 = Sunday. 7 January 2024 was a Sunday. */
function shortDayNames(locale: Locale): string[] {
  const format = new Intl.DateTimeFormat(locale === 'hi' ? 'hi-IN' : 'en-IN', { weekday: 'short', timeZone: 'UTC' });
  return Array.from({ length: 7 }, (_, day) => format.format(Date.UTC(2024, 0, 7 + day)));
}

export async function getSiteContext(locale: Locale): Promise<SiteContext> {
  const [data, tw, tv] = await Promise.all([
    getLandingData(),
    getTranslations({ locale, namespace: 'whatsapp' }),
    getTranslations({ locale, namespace: 'visit' }),
  ]);

  const today = todayIST(currentClock());
  const showUnconfirmed = showUnconfirmedContent();
  const { settings, plans, gym } = data;

  // The gym row stores E.164 (seed and CRM validate it); the fallback matches it.
  const phone = (gym?.phone ?? SITE_FALLBACK.phone) as E164Mobile;
  const postal = {
    streetAddress: gym?.addressLine ?? SITE_FALLBACK.addressLine,
    locality: gym?.city ?? SITE_FALLBACK.city,
    region: gym?.state ?? SITE_FALLBACK.state,
    postalCode: gym?.pincode ?? SITE_FALLBACK.pincode,
  };

  const time = (value: ISTTime) => formatTime(tv, value);
  const range = (open: ISTTime, close: ISTTime) => tv('range', { open: time(open), close: time(close) });

  const days = shortDayNames(locale);
  const groups =
    settings.hours.length === 0
      ? []
      : groupHours(settings.hours).map((group) => {
          const first = days[group.days[0] ?? 0] ?? '';
          const last = days[group.days.at(-1) ?? 0] ?? '';
          const dayText = group.days.length === 1 ? first : `${first}–${last}`;
          return {
            closed: group.closed,
            text: group.closed ? `${dayText} ${tv('closed')}` : tv('dayRange', { day: dayText, range: range(group.open, group.close) }),
          };
        });

  const monthlyFor = (gender: 'MALE' | 'FEMALE') => {
    const card = planCards(plans, gender, settings.pricing).find((c) => c.durationMonths === 1);
    return card === undefined ? null : price(card.pricePaise);
  };

  const reviews = REAL_REVIEWS.length > 0 ? REAL_REVIEWS : showUnconfirmed ? DEMO_REVIEWS : [];
  const promo = activePromos(settings.promo, today, locale);

  return {
    locale,
    data,
    today,
    showUnconfirmed,
    contact: {
      name: gym?.name ?? SITE_FALLBACK.name,
      phone,
      phoneDisplay: gym === null ? SITE_FALLBACK.phoneDisplay : displayPhone(phone),
      telHref: telHref(phone),
      whatsappHref: whatsappHref(phone, tw('prefill')),
      address: `${postal.streetAddress}, ${postal.locality} ${postal.postalCode}`,
      postal,
      directionsHref: directionsHref(),
      mapSrc: mapEmbedSrc(),
    },
    promo: { bar: promo.bar, banner: promo.banner, whatsappHref: whatsappHref(phone, tw('offerPrefill')) },
    hours: {
      // Monday-first rows; which one is today is decided in the browser.
      rows: weekHours(settings.hours, today).map((row) => ({
        day: row.day,
        label: tv(`days.${row.day}`),
        hours: row.closed ? null : range(row.open, row.close),
      })),
      summary: groups.length === 0 ? null : groups.map((group) => group.text).join('; '),
      line: groups.find((group) => !group.closed)?.text ?? null,
    },
    monthly: { men: monthlyFor('MALE'), women: monthlyFor('FEMALE') },
    rating: { google: settings.trust.googleRating.toFixed(1), googleReviews: settings.trust.googleReviews },
    reviews,
    navSections: ['about', 'facilities', 'plans', 'owner', ...(reviews.length > 0 ? (['reviews'] as const) : []), 'contact'],
  };
}
