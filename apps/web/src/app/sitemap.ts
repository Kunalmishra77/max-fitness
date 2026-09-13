import type { MetadataRoute } from 'next';
import { localizedPath, siteUrl } from '@/lib/seo';

/** Public pages in both languages, with hreflang alternates. Sign-up, renew and receipt pages are private and stay out. */

const PAGES: ReadonlyArray<{ path: string; changeFrequency: 'weekly' | 'yearly'; priority: number }> = [
  { path: '/', changeFrequency: 'weekly', priority: 1 },
  { path: '/contact', changeFrequency: 'yearly', priority: 0.5 },
  { path: '/legal/privacy', changeFrequency: 'yearly', priority: 0.2 },
  { path: '/legal/terms', changeFrequency: 'yearly', priority: 0.2 },
  { path: '/legal/refund', changeFrequency: 'yearly', priority: 0.2 },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  return PAGES.map(({ path, changeFrequency, priority }) => ({
    url: `${base}${localizedPath(path, 'en')}`,
    changeFrequency,
    priority,
    alternates: {
      languages: {
        en: `${base}${localizedPath(path, 'en')}`,
        hi: `${base}${localizedPath(path, 'hi')}`,
      },
    },
  }));
}
