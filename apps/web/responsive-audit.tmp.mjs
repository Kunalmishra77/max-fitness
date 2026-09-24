/**
 * Finds real responsive breakage rather than eyeballing screenshots: at each width,
 * does the page scroll sideways, and which element is sticking out?
 */
import { chromium } from '@playwright/test';

const BASE = 'https://max-fitness-kappa.vercel.app';
const WIDTHS = [320, 360, 390, 414, 768, 1024, 1280, 1440];

const PUBLIC_PAGES = ['/', '/hi', '/qr/existing', '/checkin'];
const CRM_PAGES = ['/crm', '/crm/members', '/crm/attendance', '/crm/calls', '/crm/leads', '/crm/reports', '/crm/messages', '/crm/messages/simulator', '/crm/more', '/crm/settings', '/crm/settings/kiosk', '/crm/verify', '/crm/import'];

async function overflow(page) {
  return page.evaluate(() => {
    const docWidth = document.documentElement.clientWidth;
    const scrollWidth = document.documentElement.scrollWidth;
    const guilty = [];
    if (scrollWidth > docWidth + 1) {
      for (const el of document.querySelectorAll('body *')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (r.right > docWidth + 1 || r.left < -1) {
          const style = getComputedStyle(el);
          if (style.position === 'fixed' && r.width <= docWidth + 1) continue;
          guilty.push({
            tag: el.tagName.toLowerCase(),
            cls: (el.className && typeof el.className === 'string' ? el.className : '').slice(0, 110),
            right: Math.round(r.right),
            left: Math.round(r.left),
            text: (el.textContent || '').trim().slice(0, 40),
          });
        }
      }
    }
    // Any element whose own content scrolls sideways is usually a table or a long word.
    const scrollers = [...document.querySelectorAll('body *')]
      .filter((el) => el.scrollWidth > el.clientWidth + 2 && getComputedStyle(el).overflowX !== 'auto' && getComputedStyle(el).overflowX !== 'scroll')
      .slice(0, 4)
      .map((el) => ({ tag: el.tagName.toLowerCase(), cls: (typeof el.className === 'string' ? el.className : '').slice(0, 80) }));
    return { docWidth, scrollWidth, guilty: guilty.slice(0, 5), scrollers };
  });
}

const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();

// Sign in once; the CRM cookie then covers every CRM page.
await page.goto(`${BASE}/crm/login`);
await page.waitForTimeout(2500);
await page.getByLabel('मोबाइल नंबर').fill('9000000001');
await page.getByLabel('PIN').fill('2468');
await page.getByRole('button', { name: 'लॉगिन करें' }).click();
await page.waitForURL(/\/crm$/, { timeout: 30000 });

const problems = [];
for (const path of [...PUBLIC_PAGES, ...CRM_PAGES]) {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    try {
      await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(700);
      const result = await overflow(page);
      if (result.scrollWidth > result.docWidth + 1) {
        problems.push({ path, width, over: result.scrollWidth - result.docWidth, guilty: result.guilty });
        console.log(`OVERFLOW ${path} @${width}: +${result.scrollWidth - result.docWidth}px`);
        for (const g of result.guilty) console.log(`    <${g.tag}> right=${g.right} "${g.text}" .${g.cls}`);
      }
      if (result.scrollers.length > 0) {
        console.log(`SCROLLER ${path} @${width}: ${result.scrollers.map((s) => `<${s.tag}>.${s.cls}`).join(' | ')}`);
      }
    } catch (error) {
      console.log(`ERROR ${path} @${width}: ${error.message.split('\n')[0]}`);
    }
  }
}

console.log(`\n=== ${problems.length} overflow problems ===`);
await browser.close();
