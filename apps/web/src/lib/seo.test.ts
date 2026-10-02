// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { gymJsonLd, isIndexable, localizedPath } from './seo';
import type { SiteContext } from './site-context';

/**
 * What a search engine is told about the gym (ADR-096).
 *
 * The structured data is the part nobody looks at until it is wrong, and then it is wrong
 * in Google's index for weeks. Two claims are worth holding down: the star rating is only
 * stated when there are reviews behind it, and the picture's address is a real absolute
 * URL rather than something with a doubled slash in it that silently fetches nothing.
 */

const original = { node: process.env['NODE_ENV'], demo: process.env['DEMO_MODE'] };

afterEach(() => {
  for (const [name, value] of [['NODE_ENV', original.node], ['DEMO_MODE', original.demo]] as const) {
    if (value === undefined) Reflect.deleteProperty(process.env, name);
    else Reflect.set(process.env, name, value);
  }
});

/** Only the parts `gymJsonLd` reads; the rest of a SiteContext is irrelevant here. */
const context = (trust: { googleRating: number; googleReviews: number }, locale: 'en' | 'hi' = 'en') =>
  ({
    locale,
    contact: {
      name: 'Max Fitness Gym',
      phone: '+919000000000',
      postal: { streetAddress: 'Nyay Khand 1', locality: 'Indirapuram', region: 'Uttar Pradesh', postalCode: '201014' },
    },
    data: { settings: { hours: [], trust: { ...trust, establishedYear: 2000 } } },
  }) as unknown as SiteContext;

describe('gymJsonLd', () => {
  it('carries the Google standing so a search result can show the stars', () => {
    const data = gymJsonLd(context({ googleRating: 4.8, googleReviews: 231 })) as Record<string, Record<string, unknown>>;
    expect(data['aggregateRating']).toEqual({
      '@type': 'AggregateRating',
      ratingValue: '4.8',
      reviewCount: 231,
      bestRating: '5',
      worstRating: '1',
    });
  });

  it('claims no rating at all when no reviews stand behind it', () => {
    // 4.8 out of nothing is a claim, not a fact, and Google is right to ignore it.
    const data = gymJsonLd(context({ googleRating: 4.8, googleReviews: 0 }));
    expect(data['aggregateRating']).toBeUndefined();
  });

  it('gives the picture an absolute address, in each language, with no doubled slash', () => {
    const en = String((gymJsonLd(context({ googleRating: 4.8, googleReviews: 9 }, 'en')) as Record<string, unknown>)['image']);
    const hi = String((gymJsonLd(context({ googleRating: 4.8, googleReviews: 9 }, 'hi')) as Record<string, unknown>)['image']);

    expect(en).toMatch(/^https?:\/\/[^/]+\/opengraph-image$/);
    expect(hi).toMatch(/^https?:\/\/[^/]+\/hi\/opengraph-image$/);
  });
});

describe('isIndexable', () => {
  beforeEach(() => {
    Reflect.set(process.env, 'NODE_ENV', 'production');
  });

  it('lets search engines in on the real production site', () => {
    process.env['DEMO_MODE'] = 'false';
    expect(isIndexable()).toBe(true);
  });

  it('keeps them out of a demo deployment, whose content is placeholder', () => {
    process.env['DEMO_MODE'] = 'true';
    expect(isIndexable()).toBe(false);
  });
});

describe('localizedPath', () => {
  it('leaves English unprefixed and prefixes Hindi', () => {
    expect(localizedPath('/', 'en')).toBe('/');
    expect(localizedPath('/', 'hi')).toBe('/hi');
    expect(localizedPath('/contact', 'hi')).toBe('/hi/contact');
  });
});
