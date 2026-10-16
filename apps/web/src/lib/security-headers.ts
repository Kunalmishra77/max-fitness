/**
 * HTTP security headers (security-plan.md §3.1; SEC-001).
 *
 * Until now `next.config.ts` set one header — a year's cache for `/fonts` — and nothing
 * else. There was no CSP, no `nosniff`, no `Permissions-Policy` and no framing rule, while
 * `deployment-plan.md` said in passing that "CSP is set by Next.js per route". It was set
 * by nothing. This module is that policy, in one place, with tests.
 *
 * **Three areas, three policies**, because they have genuinely different needs:
 *
 * - **public** — the marketing site, the sign-up flow and the QR forms. Loads Razorpay
 *   Standard Checkout, optionally Plausible or GA4 after consent, and Google Maps in an
 *   iframe once the visitor asks. The widest policy, because it is the only one that
 *   talks to anybody else.
 * - **crm** — Max Register. Verified by grep to load no third-party script at all: no
 *   Razorpay (fees are taken at the desk), no analytics. It does run the self-hosted
 *   MediaPipe face detector when a member is added, so WebAssembly has to be allowed.
 *   Everything else is `'self'`, and nothing may frame it.
 * - **api** — no document is ever rendered, so the policy only has to make sure a
 *   response is never treated as one: `default-src 'none'` and `sandbox`.
 *
 * **Why `script-src` keeps `'unsafe-inline'`.** The honest answer, so nobody reads this
 * file and thinks the XSS story is finished. A nonce has to be minted per request, which
 * Next's own CSP guide is explicit about: *"you must use dynamic rendering to add
 * nonces"*. The public pages are deliberately static and cached (ADR-032) and are held to
 * a mobile LCP budget in CI, so nonces there would mean giving up the caching that budget
 * depends on. Next also injects its own inline hydration scripts on every page.
 *
 * So `script-src` is the one directive that stays permissive, and every other directive is
 * tight — which is not nothing: `object-src 'none'` and `base-uri 'self'` close off plugin
 * and base-tag injection, `form-action` stops a form being retargeted at somebody else's
 * server, `frame-ancestors 'none'` is clickjacking, and a narrow `connect-src` means an
 * injected script cannot post a member's details to an address of its choosing.
 *
 * The CRM is force-dynamic on every route already, so a nonce-based `strict-dynamic`
 * policy there costs nothing and is the natural next step — SEC-013 in the review. It is
 * not done here because this session cannot run the app (no database credentials) and an
 * unverified enforcing policy on the owner's daily tool could white-screen it.
 *
 * `CSP_REPORT_ONLY=true` sends the whole thing as `Content-Security-Policy-Report-Only`
 * instead, so the policy can be watched before it bites.
 */

/** Razorpay Standard Checkout: the script, the API it calls, and the frames it opens. */
const RAZORPAY_SCRIPT = 'https://checkout.razorpay.com';
const RAZORPAY_API = 'https://api.razorpay.com';
/** Razorpay's own telemetry endpoint. Blocking it breaks checkout in some flows. */
const RAZORPAY_TELEMETRY = 'https://lumberjack.razorpay.com';
/** Razorpay serves card-network and bank logos from its CDN subdomains. */
const RAZORPAY_IMAGES = 'https://*.razorpay.com';

const PLAUSIBLE = 'https://plausible.io';
const GTAG = 'https://www.googletagmanager.com';
const GA_COLLECT = ['https://www.google-analytics.com', 'https://*.google-analytics.com', 'https://*.analytics.google.com'];

/** `mapEmbedSrc()` builds a `maps.google.com/maps?...&output=embed` URL (lib/site.ts). */
const MAPS_FRAME = ['https://maps.google.com', 'https://www.google.com'];

export type SecurityArea = 'public' | 'crm' | 'api';

/**
 * Build the policy for one area.
 *
 * `upgrade-insecure-requests` is production-only: on a developer's machine the site is
 * plain HTTP and the directive would rewrite every local request to HTTPS.
 */
export function contentSecurityPolicy(area: SecurityArea, options: { production: boolean }): string {
  if (area === 'api') {
    /**
     * A JSON or image response should never be able to act as a document.
     *
     * Deliberately **no `sandbox`**. It was the obvious thing to add and it would have
     * broken a real screen: `/api/v1/files` serves a member's uploaded ID as a PDF with
     * `Content-Disposition: inline`, and staff open it at the desk to read the card. A
     * bare `sandbox` is the most restrictive form there is and takes the browser's PDF
     * viewer with it. `default-src 'none'` costs nothing here — these responses have no
     * subresources — and `nosniff`, which `staticSecurityHeaders` adds, is the directive
     * that actually matters on a route that streams bytes.
     */
    return ["default-src 'none'", "frame-ancestors 'none'", "base-uri 'none'"].join('; ');
  }

  const isPublic = area === 'public';

  const scriptSrc = ["'self'", "'unsafe-inline'", "'wasm-unsafe-eval'"];
  const connectSrc = ["'self'"];
  const imgSrc = ["'self'", 'data:', 'blob:'];
  const frameSrc: string[] = [];

  if (isPublic) {
    scriptSrc.push(RAZORPAY_SCRIPT, PLAUSIBLE, GTAG);
    connectSrc.push(RAZORPAY_API, RAZORPAY_TELEMETRY, PLAUSIBLE, ...GA_COLLECT);
    imgSrc.push(RAZORPAY_IMAGES, ...GA_COLLECT);
    frameSrc.push(RAZORPAY_SCRIPT, RAZORPAY_API, ...MAPS_FRAME);
  }

  const directives = [
    "default-src 'self'",
    `script-src ${scriptSrc.join(' ')}`,
    // Tailwind compiles to a stylesheet, but Next and Radix both set inline styles
    // (dialog positioning, view transitions), so this cannot be dropped.
    "style-src 'self' 'unsafe-inline'",
    `img-src ${imgSrc.join(' ')}`,
    // Self-hosted (ADR-033). No Google Fonts at runtime.
    "font-src 'self'",
    // Hero clips are ours; `blob:` is the selfie and check-in camera preview.
    "media-src 'self' blob:",
    `connect-src ${connectSrc.join(' ')}`,
    // `blob:` is the MediaPipe face detector's worker; `'self'` is Max Register's own
    // service worker.
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    `frame-src ${frameSrc.length === 0 ? "'none'" : frameSrc.join(' ')}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    // Nothing here is meant to be embedded anywhere, the CRM least of all.
    "frame-ancestors 'none'",
    ...(production(options) ? ['upgrade-insecure-requests'] : []),
  ];

  return directives.join('; ');
}

function production(options: { production: boolean }): boolean {
  return options.production;
}

export interface HeaderPair {
  readonly key: string;
  readonly value: string;
}

/**
 * Everything that is not the CSP.
 *
 * `Permissions-Policy` keeps the camera, which the selfie step and the check-in screen
 * both need, and gives up the rest — a gym's website has no business asking for a
 * microphone or a location.
 *
 * HSTS is production-only and deliberately carries no `preload`: that is a one-way door
 * for a domain, and submitting it is the owner's decision, not a default.
 */
export function staticSecurityHeaders(area: SecurityArea, options: { production: boolean }): HeaderPair[] {
  const headers: HeaderPair[] = [
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    // Belt and braces for `frame-ancestors`, which older browsers ignore.
    { key: 'X-Frame-Options', value: 'DENY' },
    {
      key: 'Permissions-Policy',
      value: ['camera=(self)', 'microphone=()', 'geolocation=()', 'payment=()', 'usb=()', 'magnetometer=()', 'accelerometer=()', 'gyroscope=()'].join(', '),
    },
  ];

  if (options.production) {
    headers.push({ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' });
  }

  // Max Register and the attendance screen render members' names, fee states and
  // photographs. A shared cache must never hold one of those pages, and the back button
  // must re-ask rather than redraw a signed-out screen from memory.
  if (area === 'crm') {
    headers.push({ key: 'Cache-Control', value: 'no-store, must-revalidate' });
  }

  return headers;
}

/** The CSP header name depends on whether we are watching the policy or enforcing it. */
export function cspHeaderKey(reportOnly: boolean): string {
  return reportOnly ? 'Content-Security-Policy-Report-Only' : 'Content-Security-Policy';
}

/**
 * The full header set for one area, ready for `next.config.ts`.
 *
 * Kept free of imports so it can be pulled into the Next config, which is evaluated
 * before the app's module graph exists.
 */
export function securityHeadersFor(area: SecurityArea, options: { production: boolean; reportOnly: boolean }): HeaderPair[] {
  return [
    ...staticSecurityHeaders(area, options),
    { key: cspHeaderKey(options.reportOnly), value: contentSecurityPolicy(area, options) },
  ];
}
