/*
 * Home-screen icons for Max Register (crm-ux-blueprint §18).
 *
 * Renders `src/app/icon.svg` — the placeholder mark until the gym's own logo arrives —
 * into the PNG sizes a manifest needs. Run it again after the real logo lands:
 *
 *   node scripts/make-pwa-icons.mjs
 *
 * The maskable icon keeps the mark inside the circle Android crops to: the safe area is
 * the middle 80%, so the mark is drawn at 60% of the canvas on the plate-navy ground.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const source = resolve(here, '../src/app/icon.svg');
const outDir = resolve(here, '../public/icons');
const PLATE_NAVY = '#14213D';

const svg = await readFile(source);
await mkdir(outDir, { recursive: true });

/** The mark fills the canvas; the icon already has the navy plate behind it. */
async function plain(size) {
  const png = await sharp(svg, { density: 384 }).resize(size, size).png().toBuffer();
  await writeFile(resolve(outDir, `max-${size}.png`), png);
  return `max-${size}.png ${png.length} bytes`;
}

async function maskable(size) {
  const inner = Math.round(size * 0.6);
  const mark = await sharp(svg, { density: 384 }).resize(inner, inner).png().toBuffer();
  const png = await sharp({ create: { width: size, height: size, channels: 4, background: PLATE_NAVY } })
    .composite([{ input: mark, top: Math.round((size - inner) / 2), left: Math.round((size - inner) / 2) }])
    .png()
    .toBuffer();
  await writeFile(resolve(outDir, `max-maskable-${size}.png`), png);
  return `max-maskable-${size}.png ${png.length} bytes`;
}

console.log([await plain(192), await plain(512), await maskable(512)].join('\n'));
