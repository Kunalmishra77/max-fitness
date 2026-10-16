import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy, cspHeaderKey, securityHeadersFor, staticSecurityHeaders, type SecurityArea } from './security-headers';

/**
 * SEC-001 regression tests.
 *
 * These exist because the headers were missing entirely once, and the deployment plan
 * claimed otherwise. The ones that matter are the negative assertions: a directive that
 * quietly widens is how a policy stops being a policy.
 */

const prod = { production: true, reportOnly: false };

/** Read one directive out of a policy string. */
function directive(policy: string, name: string): string | null {
  const found = policy
    .split('; ')
    .find((part) => part === name || part.startsWith(`${name} `));
  return found ?? null;
}

describe('contentSecurityPolicy — every area', () => {
  const areas: SecurityArea[] = ['public', 'crm', 'api'];

  it.each(areas)('%s refuses to be framed and forbids plugins', (area) => {
    const policy = contentSecurityPolicy(area, { production: true });
    expect(policy).toContain("frame-ancestors 'none'");
  });

  it.each(areas)('%s never allows a bare wildcard origin', (area) => {
    const policy = contentSecurityPolicy(area, { production: true });
    // `https://*.razorpay.com` is a bounded wildcard and fine; a lone `*` is not.
    for (const part of policy.split('; ')) {
      expect(part.split(' ').slice(1), part).not.toContain('*');
    }
  });

  it.each(areas)('%s never allows unsafe-eval', (area) => {
    // `wasm-unsafe-eval` is WebAssembly only and is not the same grant.
    const policy = contentSecurityPolicy(area, { production: true });
    expect(policy).not.toMatch(/'unsafe-eval'/);
  });
});

describe('contentSecurityPolicy — the public site', () => {
  const policy = contentSecurityPolicy('public', { production: true });

  it('lets Razorpay Standard Checkout load, call home and open its frame', () => {
    expect(directive(policy, 'script-src')).toContain('https://checkout.razorpay.com');
    expect(directive(policy, 'connect-src')).toContain('https://api.razorpay.com');
    expect(directive(policy, 'connect-src')).toContain('https://lumberjack.razorpay.com');
    expect(directive(policy, 'frame-src')).toContain('https://checkout.razorpay.com');
  });

  it('allows the two analytics providers the consent banner can switch on', () => {
    expect(directive(policy, 'script-src')).toContain('https://plausible.io');
    expect(directive(policy, 'script-src')).toContain('https://www.googletagmanager.com');
    expect(directive(policy, 'connect-src')).toContain('https://www.google-analytics.com');
  });

  it('allows the Google Maps iframe the contact page loads on request', () => {
    expect(directive(policy, 'frame-src')).toContain('https://maps.google.com');
  });

  it('allows WebAssembly, for the self-hosted MediaPipe face detector', () => {
    expect(directive(policy, 'script-src')).toContain("'wasm-unsafe-eval'");
    expect(directive(policy, 'worker-src')).toContain('blob:');
  });

  it('allows the camera preview and captured photographs as blobs', () => {
    expect(directive(policy, 'img-src')).toContain('blob:');
    expect(directive(policy, 'media-src')).toContain('blob:');
  });
});

describe('contentSecurityPolicy — Max Register', () => {
  const policy = contentSecurityPolicy('crm', { production: true });

  /**
   * The CRM was verified by grep to load no third-party script. If that ever changes,
   * this test fails before a screen does — which is the point of asserting the absence.
   */
  it('reaches nobody but us', () => {
    expect(policy).not.toContain('razorpay');
    expect(policy).not.toContain('plausible');
    expect(policy).not.toContain('google');
    expect(directive(policy, 'connect-src')).toBe("connect-src 'self'");
  });

  it('frames nothing at all', () => {
    expect(directive(policy, 'frame-src')).toBe("frame-src 'none'");
  });

  it('still allows WebAssembly, because adding a member takes a selfie', () => {
    expect(directive(policy, 'script-src')).toContain("'wasm-unsafe-eval'");
  });
});

describe('contentSecurityPolicy — the API', () => {
  const policy = contentSecurityPolicy('api', { production: true });

  it('allows nothing and sandboxes the response', () => {
    expect(policy).toContain("default-src 'none'");
    expect(policy).toContain('sandbox');
  });
});

describe('contentSecurityPolicy — environment', () => {
  it('upgrades insecure requests only in production', () => {
    expect(contentSecurityPolicy('public', { production: true })).toContain('upgrade-insecure-requests');
    // A developer's machine serves plain HTTP; upgrading would break every local request.
    expect(contentSecurityPolicy('public', { production: false })).not.toContain('upgrade-insecure-requests');
  });
});

describe('staticSecurityHeaders', () => {
  it('sets nosniff, a referrer policy and a framing refusal everywhere', () => {
    for (const area of ['public', 'crm', 'api'] as SecurityArea[]) {
      const keys = staticSecurityHeaders(area, { production: true }).map((h) => h.key);
      expect(keys, area).toContain('X-Content-Type-Options');
      expect(keys, area).toContain('Referrer-Policy');
      expect(keys, area).toContain('X-Frame-Options');
      expect(keys, area).toContain('Permissions-Policy');
    }
  });

  it('keeps the camera and gives up the microphone and location', () => {
    const permissions = staticSecurityHeaders('public', { production: true }).find((h) => h.key === 'Permissions-Policy');
    expect(permissions?.value).toContain('camera=(self)');
    expect(permissions?.value).toContain('microphone=()');
    expect(permissions?.value).toContain('geolocation=()');
  });

  it('sends HSTS in production only, and never asks for preload', () => {
    const live = staticSecurityHeaders('public', { production: true }).find((h) => h.key === 'Strict-Transport-Security');
    expect(live?.value).toBe('max-age=31536000; includeSubDomains');
    expect(live?.value).not.toContain('preload');

    expect(staticSecurityHeaders('public', { production: false }).find((h) => h.key === 'Strict-Transport-Security')).toBeUndefined();
  });

  it('forbids caching a CRM page, which holds members and their fees', () => {
    const cache = staticSecurityHeaders('crm', { production: true }).find((h) => h.key === 'Cache-Control');
    expect(cache?.value).toContain('no-store');
    // The public site is meant to be cached; that is the point of ADR-032.
    expect(staticSecurityHeaders('public', { production: true }).find((h) => h.key === 'Cache-Control')).toBeUndefined();
  });
});

describe('cspHeaderKey', () => {
  it('names the report-only header when the policy is only being watched', () => {
    expect(cspHeaderKey(true)).toBe('Content-Security-Policy-Report-Only');
    expect(cspHeaderKey(false)).toBe('Content-Security-Policy');
  });
});

describe('securityHeadersFor', () => {
  it('returns one CSP header and the static set together', () => {
    const headers = securityHeadersFor('crm', prod);
    expect(headers.filter((h) => h.key.startsWith('Content-Security-Policy'))).toHaveLength(1);
    expect(headers.find((h) => h.key === 'X-Content-Type-Options')?.value).toBe('nosniff');
  });

  it('switches the header name when report-only is on, keeping the same policy', () => {
    const enforced = securityHeadersFor('public', { production: true, reportOnly: false });
    const watched = securityHeadersFor('public', { production: true, reportOnly: true });

    const enforcedCsp = enforced.find((h) => h.key === 'Content-Security-Policy');
    const watchedCsp = watched.find((h) => h.key === 'Content-Security-Policy-Report-Only');
    expect(enforcedCsp?.value).toBe(watchedCsp?.value);
  });
});
