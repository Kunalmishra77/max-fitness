import { crmManifest } from '@/lib/crm-manifest';

/**
 * `GET /crm/manifest.webmanifest` — what a phone reads when it installs Max Register.
 *
 * It lives under `/crm` on purpose: Next's root `app/manifest.ts` convention links a
 * manifest from every page, including the public website, and the gym's back office
 * should not be offered to visitors (crm-ux-blueprint §18).
 */

export const dynamic = 'force-static';

export function GET() {
  return Response.json(crmManifest(), {
    headers: {
      'Content-Type': 'application/manifest+json',
      // It changes about as often as the app's name does.
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
