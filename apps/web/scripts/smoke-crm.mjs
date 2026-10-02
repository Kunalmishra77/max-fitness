/**
 * A read-only walk of every CRM screen, in a real browser, at both widths.
 *
 * Unit tests cannot see layout: the actions-menu bug the owner found rendered correctly in
 * the DOM and was clipped to ten pixels on screen. So this signs in, visits each screen at
 * 1440 and at 360, and reports what only a browser knows — console errors, failed requests,
 * whether anything overflows the viewport sideways, and a screenshot to look at.
 *
 * It creates nothing and changes nothing: every page here is a read. The e2e suite proper
 * writes members and payments, and the dev server points at the live database, so that
 * suite must not be pointed here.
 */
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

const BASE = process.env.BASE ?? 'https://maxfitnessgym.co.in';
const USER = process.env.CRM_USER;
const PIN = process.env.CRM_PIN;
const OUTDIR = process.env.OUTDIR ?? 'shots';
const WIDTH = Number(process.env.WIDTH ?? 1440);

if (!USER || !PIN) throw new Error('CRM_USER and CRM_PIN must be set');
mkdirSync(OUTDIR, { recursive: true });

const SCREENS = [
  ['home', '/crm'],
  ['members', '/crm/members'],
  ['members-expired', '/crm/members?fee=EXPIRED'],
  ['attendance', '/crm/attendance'],
  ['attendance-absent', '/crm/attendance?tab=absent'],
  ['calls', '/crm/calls'],
  ['leads', '/crm/leads'],
  ['messages', '/crm/messages'],
  ['messages-people', '/crm/messages?view=people'],
  ['reports', '/crm/reports'],
  ['reports-last-month', '/crm/reports?month=2026-09'],
  ['diet', '/crm/diet'],
  ['more', '/crm/more'],
  ['member-new', '/crm/members/new'],
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: WIDTH, height: 900 } });

const problems = [];
page.on('console', (message) => {
  if (message.type() === 'error') problems.push(`console: ${message.text().slice(0, 160)}`);
});
page.on('requestfailed', (request) => {
  // Next.js cancels its own route prefetches the moment you navigate, and Playwright
  // reports a cancelled request as a failed one. Those are noise, not faults.
  if (request.url().includes('_rsc=')) return;
  problems.push(`request failed: ${request.method()} ${request.url().slice(0, 120)}`);
});
page.on('response', (response) => {
  if (response.status() >= 500) problems.push(`HTTP ${response.status()}: ${response.url().slice(0, 120)}`);
});

try {
  await page.goto(`${BASE}/crm/login`, { waitUntil: 'domcontentloaded' });
  await page.locator('input[autocomplete="username"]').fill(USER);
  await page.locator('input[autocomplete="current-password"]').fill(PIN);
  await page.getByRole('button', { name: /.+/ }).last().click();
  await page.waitForURL(/\/crm(\?|$|\/)/, { timeout: 30_000 });
  await page.waitForLoadState('networkidle');
  console.log(`signed in — ${WIDTH}px\n`);

  for (const [name, path] of SCREENS) {
    problems.length = 0;
    let landed = '';
    try {
      await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle', timeout: 45_000 });
      // The sign-in redirect can steal the first navigation; ask once more if it did.
      // Exact pathname, not a prefix: /crm/login "starts with" /crm, which would have let
      // a bounce back to the sign-in screen pass as a successful visit to Home.
      if (new URL(page.url()).pathname !== path.split('?')[0]) {
        await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle', timeout: 45_000 });
      }
      landed = new URL(page.url()).pathname + new URL(page.url()).search;
    } catch (error) {
      problems.push(`navigation: ${error.message.split('\n')[0]}`);
    }

    // Sideways overflow is the one layout fault that is invisible on a big screen and
    // ruins a 360px phone, and it never shows up in a unit test.
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    const overflowing = overflow.scrollWidth > overflow.clientWidth + 1;

    const heading = (await page.locator('h1').first().textContent().catch(() => null))?.trim() ?? '(no h1)';
    await page.screenshot({ path: `${OUTDIR}/${WIDTH}-${name}.png`, fullPage: false });

    const flags = [];
    if (landed !== '' && new URL(landed, BASE).pathname !== path.split('?')[0]) flags.push(`redirected to ${landed}`);
    if (overflowing) flags.push(`overflows by ${overflow.scrollWidth - overflow.clientWidth}px`);
    flags.push(...problems);

    console.log(`${flags.length === 0 ? 'ok  ' : 'FLAG'} ${name.padEnd(20)} "${heading.slice(0, 40)}"${flags.length === 0 ? '' : `\n       ${flags.join('\n       ')}`}`);
  }
} finally {
  await browser.close();
}
