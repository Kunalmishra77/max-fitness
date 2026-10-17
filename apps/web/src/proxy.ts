import createMiddleware from 'next-intl/middleware';
import { NextResponse, type NextRequest } from 'next/server';
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

const intl = createMiddleware(routing);

/**
 * `x-next-intl-locale` is set by next-intl on the request it rewrites to, and nothing
 * else sets it: a browser does not send it, and an external request carrying it is
 * indistinguishable from one that is simply not locale-prefixed.
 */
const ALREADY_RESOLVED = 'x-next-intl-locale';

/**
 * **This guard is why the English website works.** Removing it breaks every page of it.
 *
 * In the standalone production server a `proxy` rewrite is fed back through `proxy`,
 * which plain `next dev` does not do — so this was invisible in development and in a
 * Vercel build (Vercel does not use the standalone output; see `next.config.ts`), and
 * broke only in the container that actually serves the site.
 *
 * What happened, traced through a request to `/`:
 *
 * 1. `/` has no locale prefix, so next-intl rewrites it to `/en`. Correct.
 * 2. The rewritten `/en` re-enters here.
 * 3. Under `as-needed` an explicit default-locale prefix is not canonical, so next-intl
 *    redirects `/en` to `/` — also correct, in isolation.
 * 4. That redirect becomes the response to `/`. `/` answers "go to `/`", for ever.
 *
 * Hindi was unaffected, because `/hi` is already prefixed and needs no rewrite — which
 * is what made it look like a content problem rather than a routing one.
 *
 * So: once next-intl has resolved a locale for a request, let it through. The redirect
 * in step 3 is still wanted for a visitor who really does type `/en`, and that request
 * arrives without the header.
 */
export function proxy(request: NextRequest): NextResponse {
  if (request.headers.has(ALREADY_RESOLVED)) return NextResponse.next();
  return intl(request);
}

export const config = {
  // Public pages only:
  // - `/api` must never be redirected: webhooks, the kiosk and health checks call it.
  // - `/crm` takes its language from a cookie, not the URL (see i18n/crm-locale.ts).
  // - `/checkin` is the reception tablet's own screen, not a page anybody browses to,
  //   and has no locale in its URL for the same reason the CRM has none.
  // - Next internals and static files need no locale. Files are recognised by a known
  //   extension, not by any dot: signed links (`/r/{token}`, `/renew/{token}`) contain a
  //   dot between the token's body and signature and must still be localised.
  matcher: [
    '/((?!api|crm|checkin|_next|_vercel|.*\\.(?:avif|webp|png|jpe?g|gif|svg|ico|mp4|webm|woff2?|ttf|js|mjs|css|map|json|txt|xml|webmanifest|wasm|tflite|pdf|md)$).*)',
  ],
};
