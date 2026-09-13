import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end journeys (testing-strategy.md §3) against a running web app.
 *
 * Locally this starts `next dev` unless E2E_BASE_URL points at a server that is
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
  // `next dev` compiles routes on first request and serves unminified bundles, so local
  // runs use one worker and generous timeouts; CI runs against `next start`.
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
  ...(process.env['E2E_BASE_URL'] === undefined
    ? { webServer: { command: 'pnpm dev', url: baseURL, reuseExistingServer: true, timeout: 180_000 } }
    : {}),
});
