/**
 * Look at the QR new-member form the way a member does: a phone, from the top to the
 * bottom, one screenful at a time.
 *
 * The overflow check in smoke-public only catches a page wider than its viewport. The
 * owner reported something it passed — cramped fields, a tap target too small, something
 * that reads wrong — so this captures the whole form and measures what a finger has to hit.
 */
import { chromium, devices } from '@playwright/test';

const BASE = process.env.BASE ?? 'https://maxfitnessgym.co.in';
const OUT = process.env.OUT ?? 'qr';
// Not named PATH: Git Bash rewrites a leading slash in an argument into a Windows path.
const PAGE = process.env.PAGE_PATH ?? 'qr/new';

const browser = await chromium.launch();
const page = await browser.newPage({ ...devices['Pixel 7'], viewport: { width: 390, height: 844 } });

try {
  await page.goto(`${BASE}/${PAGE}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(3000);

  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  console.log(`page is ${height}px tall at 390 wide (${Math.ceil(height / 844)} screenfuls)`);

  // Anything a finger must hit, and how big it actually is. 44px is the usual floor;
  // this project's own rule is 56 for the CRM and no less than 44 for a member.
  const targets = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('button, a, input, select, textarea, label[for]')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const style = getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none') continue;
      out.push({
        tag: el.tagName.toLowerCase(),
        text: (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 32),
        w: Math.round(r.width),
        h: Math.round(r.height),
        right: Math.round(r.right),
      });
    }
    return out;
  });

  const small = targets.filter((t) => t.h < 44);
  const wide = targets.filter((t) => t.right > 391);
  console.log(`\ntap targets under 44px tall: ${small.length}`);
  for (const t of small.slice(0, 12)) console.log(`   ${t.tag.padEnd(8)} ${String(t.h).padStart(3)}px  "${t.text}"`);
  console.log(`\nelements reaching past the right edge: ${wide.length}`);
  for (const t of wide.slice(0, 8)) console.log(`   ${t.tag.padEnd(8)} right=${t.right}  "${t.text}"`);

  // Text too small to read on a phone.
  const tiny = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('p, span, label, li, td, th, h1, h2, h3, h4')) {
      if ((el.textContent ?? '').trim() === '') continue;
      if (el.children.length > 0) continue;
      const size = Number.parseFloat(getComputedStyle(el).fontSize);
      if (size < 12) out.push({ size: Math.round(size * 10) / 10, text: (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40) });
    }
    return out;
  });
  console.log(`\ntext under 12px: ${tiny.length}`);
  for (const t of tiny.slice(0, 10)) console.log(`   ${t.size}px  "${t.text}"`);

  const screens = Math.min(Math.ceil(height / 844), 8);
  for (let i = 0; i < screens; i += 1) {
    await page.evaluate((y) => window.scrollTo(0, y), i * 844);
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}-${i + 1}.png` });
  }
  console.log(`\n${screens} screenshots written as ${OUT}-N.png`);
} finally {
  await browser.close();
}
