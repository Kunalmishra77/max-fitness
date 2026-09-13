import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

afterEach(() => {
  cleanup();
});

/**
 * The locale-aware Link needs Next's router, which component tests do not mount.
 * A plain anchor with the same href is enough to assert where a button goes.
 */
vi.mock('@/i18n/navigation', async () => {
  const { createElement } = await import('react');
  type Href = string | { pathname: string; query?: Record<string, string> };
  const toUrl = (href: Href) =>
    typeof href === 'string'
      ? href
      : `${href.pathname}${href.query === undefined ? '' : `?${new URLSearchParams(href.query).toString()}`}`;
  return {
    Link: ({ href, locale: _locale, ...rest }: { href: Href; locale?: string } & Record<string, unknown>) =>
      createElement('a', { href: toUrl(href), ...rest }),
    usePathname: () => '/',
    getPathname: ({ href }: { href: string }) => href,
  };
});
