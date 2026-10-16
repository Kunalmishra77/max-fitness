import { resolve } from 'node:path';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';
import { securityHeadersFor } from './src/lib/security-headers';

// Next only reads .env files from apps/web, but the monorepo keeps one .env at the
// root. Node's built-in loader never overrides variables already set.
try {
  process.loadEnvFile(resolve(process.cwd(), '../../.env'));
} catch {
  // No root .env: rely on the process environment.
}

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  reactStrictMode: true,

  /**
   * Workspace packages are consumed from TypeScript source rather than a built
   * `dist`, so Next compiles them. That keeps the monorepo free of a build step
   * between "edit a rule" and "see it in the browser", and means Vitest, tsx and
   * Next all read exactly the same files.
   */
  transpilePackages: ['@mfp/shared', '@mfp/core', '@mfp/db', '@mfp/integrations'],

  /**
   * Standalone output for the Phase 8 container image (deployment-plan.md §1).
   *
   * Not on Vercel, which packages each route itself: with standalone on, its builder
   * could not map routes to functions ("Unable to find lambda for route"). Vercel sets
   * `VERCEL=1` for every build, local `vercel build` included.
   */
  ...(process.env['VERCEL'] === '1' ? {} : { output: 'standalone' as const }),

  /** The legal pages read content/legal/*.md at request time, so the standalone trace must carry them. */
  outputFileTracingIncludes: { '/[locale]/legal/[slug]': ['./content/legal/**/*'] },

  /** Do not advertise the framework (security-plan.md §3.1). */
  poweredByHeader: false,

  /**
   * Security headers, and the one caching rule (SEC-001; security-plan.md §3.1).
   *
   * Three policies for three areas — see `src/lib/security-headers.ts`, which holds the
   * reasoning and the tests. Order matters: Next applies every matching entry, and the
   * later `/fonts` rule is meant to add to the earlier ones rather than replace them.
   *
   * `CSP_REPORT_ONLY=true` sends the policy as report-only, which is how to watch it on
   * the live site before letting it bite.
   */
  headers() {
    const options = {
      production: process.env['NODE_ENV'] === 'production',
      reportOnly: process.env['CSP_REPORT_ONLY'] === 'true',
    };

    return Promise.resolve([
      // Max Register and the attendance screen: no third party, nothing cached.
      { source: '/crm/:path*', headers: [...securityHeadersFor('crm', options)] },
      { source: '/checkin/:path*', headers: [...securityHeadersFor('crm', options)] },
      // Never a document: `default-src 'none'` plus a sandbox.
      { source: '/api/:path*', headers: [...securityHeadersFor('api', options)] },
      /**
       * Everything else — the marketing site, sign-up and the QR forms.
       *
       * The three areas above are excluded by name rather than relying on order: Next
       * applies *every* matching entry, so a plain `/:path*` here would put a second,
       * wider CSP on every CRM and API response, and two CSP headers are enforced as
       * their intersection — which is how a policy breaks a screen nobody tested.
       */
      {
        source: '/:path((?!api(?:/|$)|crm(?:/|$)|checkin(?:/|$)).*)',
        headers: [...securityHeadersFor('public', options)],
      },
      /**
       * Self-hosted fonts carry a version in the file name (`*.v1.woff2`), so they can be
       * cached for a year; a new file gets a new name (ADR-033).
       */
      {
        source: '/fonts/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
    ]);
  },

  serverExternalPackages: ['@prisma/client', '@prisma/adapter-pg', 'pg'],

  experimental: {
    // The generated Prisma client is large; keeping it out of the trace bundle
    // analysis avoids a slow build for no benefit.
    optimizePackageImports: ['@mfp/shared', '@mfp/core'],
    // The register import sends a CSV of up to 1 MB to a server action, whose default
    // cap is 1 MB for the whole request (ADR-056). The action checks the size itself.
    serverActions: { bodySizeLimit: '2mb' },
  },
};

export default withNextIntl(nextConfig);
