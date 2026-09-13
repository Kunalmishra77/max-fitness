import type { Locale } from '@/i18n/routing';
import type { SiteContext } from './site-context';
import { GOOGLE_PLACE, googleMapsUrl } from './site';

/**
 * SEO helpers (content-strategy-and-seo.md §3–4).
 *
 * Read straight from process.env rather than the validated container: metadata,
 * robots and the sitemap must still work when the database configuration is broken.
 */

/** The gym's Justdial listing (same NAP, rated there too). */
const JUSTDIAL_URL =
  'https://www.justdial.com/Ghaziabad/Max-Fitness-Gym-Opposite-Sai-Mandir-Nyay-Khand-1-Indirapuram/011PXX11-XX11-090427110658-D2Z7_BZDET';

export function siteUrl(): string {
  try {
    return new URL(process.env['APP_URL'] ?? '').origin;
  } catch {
    return 'http://localhost:3000';
  }
}

/**
 * Search engines index only the real production site. Development, previews and demo
 * deployments carry placeholder content and must stay out of the index.
 */
export function isIndexable(): boolean {
  return process.env['NODE_ENV'] === 'production' && process.env['DEMO_MODE'] === 'false';
}

/** `/legal/privacy` → `/hi/legal/privacy` for Hindi; English has no prefix (routing `as-needed`). */
export function localizedPath(path: string, locale: Locale): string {
  if (locale === 'en') return path;
  return path === '/' ? '/hi' : `/hi${path}`;
}

/** Canonical and hreflang alternates, relative to `metadataBase`. */
export function alternatesFor(path: string, locale: Locale) {
  return {
    canonical: localizedPath(path, locale),
    languages: {
      en: localizedPath(path, 'en'),
      hi: localizedPath(path, 'hi'),
      'x-default': localizedPath(path, 'en'),
    },
  };
}

const SCHEMA_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

/**
 * ExerciseGym structured data. Deliberately without `aggregateRating`: self-serving
 * review markup is not eligible and can be treated as spam (content strategy §4).
 * `geo` is the Google Business Profile pin, verified 2026-09-11 (ADR-031).
 */
export function gymJsonLd(ctx: SiteContext): Record<string, unknown> {
  const open = ctx.data.settings.hours.filter((row) => !row.closed);
  return {
    '@context': 'https://schema.org',
    '@type': 'ExerciseGym',
    name: ctx.contact.name,
    url: `${siteUrl()}${localizedPath('/', ctx.locale)}`,
    telephone: ctx.contact.phone,
    priceRange: '₹₹',
    foundingDate: String(ctx.data.settings.trust.establishedYear),
    address: {
      '@type': 'PostalAddress',
      streetAddress: ctx.contact.postal.streetAddress,
      addressLocality: ctx.contact.postal.locality,
      addressRegion: ctx.contact.postal.region,
      postalCode: ctx.contact.postal.postalCode,
      addressCountry: 'IN',
    },
    geo: { '@type': 'GeoCoordinates', latitude: GOOGLE_PLACE.latitude, longitude: GOOGLE_PLACE.longitude },
    hasMap: googleMapsUrl(),
    sameAs: [googleMapsUrl(), JUSTDIAL_URL],
    ...(open.length === 0
      ? {}
      : {
          openingHoursSpecification: open.map((row) => ({
            '@type': 'OpeningHoursSpecification',
            dayOfWeek: `https://schema.org/${SCHEMA_DAYS[row.day] ?? 'Monday'}`,
            opens: row.open,
            closes: row.close,
          })),
        }),
  };
}
