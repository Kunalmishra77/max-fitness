import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end journeys (testing-strategy.md §3) against a running web app.
 *
 * Locally this builds and starts the app unless E2E_BASE_URL points at a server that is
 * already running. Two projects: a 360-class phone and a 1440px desktop, because the
 * layouts differ (sticky bar vs navigation, stacked fee rows vs table).
 */

const baseURL = process.env['E2E_BASE_URL'] ?? 'http://localhost:3000';

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: true,
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] ? 2 : 0,
  // One worker locally: the database is a network hop away and the machine is shared
  // with whatever else is building. CI parallelises.
  ...(process.env['CI'] ? {} : { workers: 1 }),
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: process.env['CI'] ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'mobile', use: { ...devices['Pixel 7'], viewport: { width: 360, height: 780 } } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
  ],
  /**
   * A built server, not `next dev`.
   *
   * `next dev` compiles each route on its first request. On a slow machine that is 14
   * seconds for the landing page and 8 for the login — against a 15-second assertion
   * timeout, so whichever test reaches a route first fails on a stopwatch rather than on
   * anything the application did. A full run on 2026-10-18 lost fourteen tests that way,
   * on pages nobody had touched; re-run against a warm server, they passed in 1.3
   * minutes.
   *
   * Building first costs about two minutes once, instead of a compile stall in front of
   * every route, and it is what CI measures — so a green run here means the same thing
   * there. The timeout covers the build as well as the boot.
   */
  ...(process.env['E2E_BASE_URL'] === undefined
    ? { webServer: { command: 'pnpm build && pnpm start', url: baseURL, reuseExistingServer: true, timeout: 600_000 } }
    : {}),
});
