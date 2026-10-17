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

/**
 * Waits until a screen is settled enough to be audited, whatever is on it.
 *
 * `waitForHydration` looks for a hydrated `<input>`, which is right for a test that is
 * about to type and wrong for one that is about to read. Seven of Max Register's screens
 * — Today, calls, leads, verify, the waiting list, more — have no text field at all, so
 * the accessibility block timed out on every one of them after thirty seconds and the
 * suite could never have gone green.
 *
 * So: wait for the network to go quiet, then for React to have attached to *something*
 * inside `main`. That is the real precondition for an audit — the markup a client
 * component adds is there — and it holds on a screen made entirely of links.
 */
export async function waitForScreen(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await page.waitForFunction(
    () => {
      const root = document.querySelector('main') ?? document.body;
      const nodes = [root, ...Array.from(root.querySelectorAll('*')).slice(0, 400)];
      return nodes.some((el) => Object.keys(el).some((key) => key.startsWith('__react')));
    },
    undefined,
    { timeout: 30_000 },
  );
}
