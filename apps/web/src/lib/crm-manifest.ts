import type { MetadataRoute } from 'next';

/**
 * The install card for Max Register (crm-ux-blueprint §18; PRD CRM-24).
 *
 * The owner installs the CRM, not the website, so the scope is `/crm`: the installed
 * icon opens Today, and a link out to a public page leaves the installed window instead
 * of turning the marketing site into part of the app.
 *
 * It is served from `/crm/manifest.webmanifest` and linked only by the CRM's layout.
 * Next's `app/manifest.ts` convention would have been shorter, but it adds the manifest
 * link to **every** page, which offers the gym's back office to visitors of the website.
 */

export function crmManifest(): MetadataRoute.Manifest {
  return {
    name: 'Max Register — Max Fitness Gym',
    short_name: 'Max Register',
    description: 'मेंबर, फीस और हाज़िरी — एक जगह',
    start_url: '/crm',
    scope: '/crm',
    display: 'standalone',
    orientation: 'portrait',
    lang: 'hi',
    dir: 'ltr',
    // The plate navy behind the splash screen, so opening it does not flash white.
    theme_color: '#0A0A0B',
    background_color: '#0A0A0B',
    icons: [
      { src: '/icons/max-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/max-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      // Android crops to its own shape; this one keeps the mark inside the safe circle.
      { src: '/icons/max-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
