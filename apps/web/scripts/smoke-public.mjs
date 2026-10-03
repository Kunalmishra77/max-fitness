/**
 * A read-only walk of what a stranger sees, in a real browser.
 *
 * The CRM has `smoke-crm.mjs`; this is its twin for the pages a member or a prospective
 * member lands on — the website, the sign-up, the QR the poster points at. It reports what
 * only a browser knows: console errors, failed requests, 5xx responses, sideways overflow
 * at phone width, and any warning or alert the page is showing.
 *
 * It fills nothing in and submits nothing, so it creates no members.
 *
 *   pnpm --filter @mfp/web smoke:public
 */
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

const BASE = process.env.BASE ?? 'https://maxfitnessgym.co.in';
const OUTDIR = process.env.OUTDIR ?? 'shots-public';
const WIDTH = Number(process.env.WIDTH ?? 1440);

mkdirSync(OUTDIR, { recursive: true });

const SCREENS = [
  ['home', '/'],
  ['home-hi', '/hi'],
  ['join', '/join'],
  ['join-plan', '/join/plan'],
  ['join-pay', '/join/pay'],
  ['qr', '/qr?src=reception&g=max-fitness-indirapuram'],
  ['qr-new', '/qr/new'],
  ['qr-existing', '/qr/existing'],
  ['contact', '/contact'],
  ['privacy', '/legal/privacy'],
  ['terms', '/legal/terms'],
  ['refund', '/legal/refund'],
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: WIDTH, height: 900 } });

const problems = [];
page.on('console', (message) => {
  if (message.type() === 'error') problems.push(`console error: ${message.text().slice(0, 200)}`);
  if (message.type() === 'warning') problems.push(`console warning: ${message.text().slice(0, 200)}`);
});
page.on('pageerror', (error) => problems.push(`page threw: ${error.message.slice(0, 200)}`));
page.on('requestfailed', (request) => {
  // Next.js cancels its own prefetches on navigation; a cancelled request is not a fault.
  if (request.url().includes('_rsc=')) return;
  problems.push(`request failed: ${request.method()} ${request.url().slice(0, 140)}`);
});
page.on('response', (response) => {
  if (response.status() >= 500) problems.push(`HTTP ${response.status()}: ${response.url().slice(0, 140)}`);
});

try {
  console.log(`walking ${BASE} at ${WIDTH}px\n`);

  for (const [name, path] of SCREENS) {
    problems.length = 0;
    try {
      await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle', timeout: 60_000 });
    } catch (error) {
      problems.push(`navigation: ${error.message.split('\n')[0]}`);
    }

    // Anything the page is telling the visitor is wrong. A sign-up that greets a stranger
    // with a warning is the thing most likely to turn them around at the door.
    const warnings = await page
      .locator('[role="alert"], [role="status"]')
      .evaluateAll((nodes) => nodes.map((n) => (n.textContent ?? '').replace(/\s+/g, ' ').trim()).filter((text) => text !== ''));

    const overflow = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    if (overflow.scroll > overflow.client + 1) problems.push(`overflows by ${overflow.scroll - overflow.client}px`);

    const heading = (await page.locator('h1').first().textContent().catch(() => null))?.trim() ?? '(no h1)';
    await page.screenshot({ path: `${OUTDIR}/${WIDTH}-${name}.png` });

    const flags = [...warnings.map((text) => `ON SCREEN: "${text.slice(0, 160)}"`), ...problems];
    console.log(`${flags.length === 0 ? 'ok  ' : 'FLAG'} ${name.padEnd(14)} "${heading.slice(0, 38)}"`);
    for (const flag of flags) console.log(`       ${flag}`);
  }
} finally {
  await browser.close();
}
