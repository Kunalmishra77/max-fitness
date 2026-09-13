import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

/**
 * Locale routing for the public website (CLAUDE.md §2.9).
 *
 * Next.js 16 renamed `middleware.ts` to `proxy.ts`; it reads a `proxy` export
 * (or the default export) from this file.
 *
 * With `localePrefix: 'as-needed'`, `/` serves English and `/hi/...` serves Hindi,
 * and a visitor's saved choice is remembered in a cookie.
 */
export const proxy = createMiddleware(routing);

export const config = {
  // Public pages only:
  // - `/api` must never be redirected: webhooks, the kiosk and health checks call it.
  // - `/crm` takes its language from a cookie, not the URL (see i18n/crm-locale.ts).
  // - Next internals and static files need no locale. Files are recognised by a known
  //   extension, not by any dot: signed links (`/r/{token}`, `/renew/{token}`) contain a
  //   dot between the token's body and signature and must still be localised.
  matcher: [
    '/((?!api|crm|_next|_vercel|.*\\.(?:avif|webp|png|jpe?g|gif|svg|ico|mp4|webm|woff2?|ttf|js|mjs|css|map|json|txt|xml|webmanifest|wasm|tflite|pdf|md)$).*)',
  ],
};
