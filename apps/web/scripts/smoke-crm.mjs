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
  // Behind the owner's PIN. They are visited anyway: a screen that bounces to the PIN gate
  // should bounce cleanly, and a screen that does not bounce should render.
  ['settings', '/crm/settings'],
  ['settings-staff', '/crm/settings/staff'],
  ['settings-kiosk', '/crm/settings/kiosk'],
  ['announcements', '/crm/announcements'],
  ['bot', '/crm/bot'],
  ['gallery', '/crm/gallery'],
  ['import', '/crm/import'],
  ['simulator', '/crm/messages/simulator'],
  ['verify', '/crm/verify'],
  ['pin', '/crm/more/pin'],
];

/** A member id to walk the per-member screens with, found at run time. */
let someMemberId = null;

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

  // Wait for the **session cookie**, not for the URL.
  //
  // `waitForURL(/\/crm(\?|$|\/)/)` resolved instantly, because `/crm/login` already matches
  // it. On a container slow enough that the sign-in had not finished, this walked every
  // screen signed out and reported twenty-seven failures against a CRM that was working
  // perfectly — a test tool inventing an outage. The cookie is what "signed in" means;
  // nothing else on this page is true until it exists.
  const signedIn = await page
    .waitForFunction(() => document.cookie.length > 0 || !location.pathname.endsWith('/login'), null, { timeout: 30_000 })
    .then(() => true)
    .catch(() => false);
  const session = (await page.context().cookies()).find((c) => c.name === 'mfp_session');
  if (!signedIn || session === undefined) {
    const shown = (await page.getByRole('alert').allTextContents()).filter((t) => t.trim() !== '');
    throw new Error(`sign-in produced no session cookie${shown.length === 0 ? '' : ` — the screen said: ${shown.join(' / ')}`}`);
  }
  await page.waitForLoadState('networkidle');
  console.log(`signed in — ${WIDTH}px\n`);

  // The member screens need a member, and which members exist is not knowable up front.
  await page.goto(`${BASE}/crm/members`, { waitUntil: 'networkidle' });
  if (!page.url().includes('/crm/members')) await page.goto(`${BASE}/crm/members`, { waitUntil: 'networkidle' });
  const found = await page
    .locator('a')
    .evaluateAll((links) => links.map((l) => l.getAttribute('href')).filter((h) => h !== null && h.startsWith('/crm/members/') && h !== '/crm/members/new'));
  someMemberId = found[0]?.split('/').pop() ?? null;
  if (someMemberId !== null) {
    SCREENS.push(['member-profile', `/crm/members/${someMemberId}`], ['member-edit', `/crm/members/${someMemberId}/edit`]);
  }

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

    // The actions menu only exists once opened, and it is where a clipping ancestor hid
    // every item behind ten pixels. So it is opened, counted, and measured against what
    // its ancestors actually paint.
    if (name === 'member-profile') {
      const dots = page.locator('header button[aria-haspopup="menu"]');
      if ((await dots.count()) > 0) {
        await dots.click();
        const menu = page.locator('[role="menu"]');
        await menu.waitFor({ state: 'attached', timeout: 10_000 });
        const items = (await page.locator('[role="menuitem"]').allTextContents()).map((text) => text.trim());
        const box = await menu.boundingBox();
        const painted = await menu.evaluate((el) => {
          const rect = el.getBoundingClientRect();
          let clip = { top: 0, left: 0, bottom: window.innerHeight, right: window.innerWidth };
          for (let node = el.parentElement; node !== null; node = node.parentElement) {
            const style = getComputedStyle(node);
            if (style.overflow === 'hidden' || style.overflowY === 'hidden' || style.overflowX === 'hidden') {
              const r = node.getBoundingClientRect();
              clip = {
                top: Math.max(clip.top, r.top),
                left: Math.max(clip.left, r.left),
                bottom: Math.min(clip.bottom, r.bottom),
                right: Math.min(clip.right, r.right),
              };
            }
          }
          return Math.round(Math.max(0, Math.min(rect.bottom, clip.bottom) - Math.max(rect.top, clip.top)));
        });
        const height = Math.round(box?.height ?? 0);
        const clipped = painted < height - 1;
        await page.screenshot({ path: `${OUTDIR}/${WIDTH}-member-menu.png` });
        console.log(`${clipped ? 'FLAG' : 'ok  '} ${'member-menu'.padEnd(20)} ${items.length} items: ${items.join(' / ')}`);
        if (clipped) console.log(`       painted only ${painted}px of ${height}px — an ancestor is clipping it`);
      }
    }
  }
} finally {
  await browser.close();
}
