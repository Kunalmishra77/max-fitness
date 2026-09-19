import type { Page } from '@playwright/test';

/**
 * Waits until React has hydrated the page's first form field.
 *
 * Server-rendered text appears before the client script attaches, so a test that types the
 * instant a heading is visible can type into a field React then resets. Real people are
 * slower than ~100 ms; the tests wait for the same moment explicitly.
 */
export async function waitForHydration(page: Page, selector = 'input'): Promise<void> {
  await page.waitForFunction(
    (sel) => {
      const el = document.querySelector(sel);
      return el !== null && Object.keys(el).some((key) => key.startsWith('__react'));
    },
    selector,
    { timeout: 30_000 },
  );
}
