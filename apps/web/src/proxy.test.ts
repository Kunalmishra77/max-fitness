import { describe, expect, it, vi } from 'vitest';

/**
 * WEB-001 regression tests.
 *
 * The whole English website returned "307 → itself" in the production container, and
 * only there: the standalone server feeds a `proxy` rewrite back through `proxy`, which
 * `next dev` does not do. `/` rewrote to `/en`, the re-entered `/en` was redirected back
 * to `/` because an explicit default-locale prefix is not canonical under `as-needed`,
 * and that redirect became the answer to `/`.
 *
 * These tests pin the guard that stops it, and — the half that matters just as much —
 * that the `/en` → `/` redirect still happens for a visitor who really types it.
 */

const intlHandler = vi.fn(() => new Response(null, { status: 307, headers: { location: '/' } }));
vi.mock('next-intl/middleware', () => ({ default: () => intlHandler }));

const { proxy, config } = await import('./proxy');

function request(path: string, headers: Record<string, string> = {}): Request {
  return new Request(`https://maxfitness.example${path}`, { headers });
}

describe('proxy — the rewrite loop', () => {
  it('lets a request through once next-intl has already resolved its locale', () => {
    intlHandler.mockClear();
    // This is the rewritten `/en` coming back round. Handing it to next-intl again is
    // what produced the redirect to `/` that became the response to `/`.
    const response = proxy(request('/en', { 'x-next-intl-locale': 'en' }) as never);

    expect(intlHandler).not.toHaveBeenCalled();
    expect(response.headers.get('location')).toBeNull();
  });

  it('still hands a fresh request to next-intl, so `/en` redirects to `/`', () => {
    intlHandler.mockClear();
    // A visitor who types `/en` sends no such header, and should still be sent to the
    // canonical English URL. Losing this would leave two URLs for every English page.
    proxy(request('/en') as never);

    expect(intlHandler).toHaveBeenCalledTimes(1);
  });

  it.each(['/', '/contact', '/qr/new', '/hi', '/r/abc.def'])('hands %s to next-intl', (path) => {
    intlHandler.mockClear();
    proxy(request(path) as never);

    expect(intlHandler).toHaveBeenCalledTimes(1);
  });
});

describe('proxy — what it runs on', () => {
  const matcher = new RegExp(`^${(config.matcher[0] as string).replace(/\\\\/g, '\\')}$`);

  it.each(['/', '/contact', '/hi/qr', '/r/token.signature', '/renew/token.signature'])('matches %s', (path) => {
    expect(matcher.test(path)).toBe(true);
  });

  /**
   * Each of these would be actively broken by locale handling: the API is called by
   * webhooks and the kiosk, and the CRM and the check-in screen take their language from
   * a cookie so that pasting a URL cannot land staff in the wrong one.
   */
  it.each(['/api/v1/health', '/crm', '/crm/members', '/checkin', '/_next/static/x.js'])('does not match %s', (path) => {
    expect(matcher.test(path)).toBe(false);
  });

  it('does not match a file, but does match a signed link containing a dot', () => {
    expect(matcher.test('/fonts/hind-400-latin-ext.v1.woff2')).toBe(false);
    expect(matcher.test('/icon.png')).toBe(false);
    // The dot here separates a token's body from its signature, not a file extension.
    expect(matcher.test('/diet/eyJhbGciOi.c2lnbmF0dXJl')).toBe(true);
  });
});
