import type { MetadataRoute } from 'next';
import { isIndexable, siteUrl } from '@/lib/seo';

/** Only the real production site is crawlable; every other environment disallows everything. */
export default function robots(): MetadataRoute.Robots {
  if (!isIndexable()) {
    return { rules: { userAgent: '*', disallow: '/' } };
  }
  return {
    rules: { userAgent: '*', allow: '/', disallow: ['/api/', '/join', '/hi/join', '/r/', '/hi/r/', '/renew/', '/hi/renew/'] },
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
