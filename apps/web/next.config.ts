import { resolve } from 'node:path';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

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

  /** Standalone output for the Phase 8 container image (deployment-plan.md §1). */
  output: 'standalone',

  /** The legal pages read content/legal/*.md at request time, so the standalone trace must carry them. */
  outputFileTracingIncludes: { '/[locale]/legal/[slug]': ['./content/legal/**/*'] },

  /** Do not advertise the framework (security-plan.md §3.1). */
  poweredByHeader: false,

  /**
   * Self-hosted fonts carry a version in the file name (`*.v1.woff2`), so they can be
   * cached for a year; a new file gets a new name (ADR-033).
   */
  headers() {
    return Promise.resolve([
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
  },
};

export default withNextIntl(nextConfig);
