/*
 * Website photos from the gym's own Google Business Profile uploads (ADR-057).
 *
 * Reads `assets/photos/gbp/manifest.json` and, for each photo, writes AVIF and WebP in
 * the site's widths to `public/media/photos/`, plus `src/content/site-photos.generated.json`
 * with the sizes that exist. Files are re-encoded from pixels, so no camera metadata
 * (location, device) reaches the website. Nothing is ever enlarged.
 *
 *   node scripts/build-site-photos.mjs
 *
 * Manifest entry: { "id", "source", "rotate"?: 90|180|270,
 *                   "crop"?: { "left", "top", "width", "height" } as fractions of the upright photo }
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const sourceDir = resolve(here, '../../../assets/photos/gbp');
const outDir = resolve(here, '../public/media/photos');
const dataFile = resolve(here, '../src/content/site-photos.generated.json');
const WIDTHS = [640, 1080, 1600];

const manifest = JSON.parse(await readFile(resolve(sourceDir, 'manifest.json'), 'utf8'));
await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

const data = {};
for (const entry of manifest) {
  if (!/^[a-z0-9-]+$/.test(entry.id)) throw new Error(`Bad photo id: ${entry.id}`);

  // Upright first (EXIF), then any turn the photo needs, then the crop.
  let upright = sharp(await readFile(resolve(sourceDir, entry.source))).rotate();
  if (entry.rotate) upright = sharp(await upright.toBuffer()).rotate(entry.rotate);
  let buffer = await upright.toBuffer();
  let { width, height } = await sharp(buffer).metadata();
  if (entry.crop) {
    const box = {
      left: Math.round(entry.crop.left * width),
      top: Math.round(entry.crop.top * height),
      width: Math.round(entry.crop.width * width),
      height: Math.round(entry.crop.height * height),
    };
    buffer = await sharp(buffer).extract(box).toBuffer();
    ({ width, height } = box);
  }

  const widths = [...new Set([...WIDTHS.filter((w) => w < width), Math.min(width, WIDTHS.at(-1))])].sort((a, b) => a - b);
  for (const w of widths) {
    const resized = sharp(buffer).resize({ width: w, withoutEnlargement: true });
    await resized.clone().avif({ quality: 55, effort: 4 }).toFile(resolve(outDir, `${entry.id}-${w}.avif`));
    await resized.clone().webp({ quality: 78 }).toFile(resolve(outDir, `${entry.id}-${w}.webp`));
  }
  const largest = widths.at(-1);
  data[entry.id] = { id: entry.id, width: largest, height: Math.round((height * largest) / width), widths };
  console.log(`${entry.id}: ${widths.join('/')} px`);
}

await writeFile(dataFile, `${JSON.stringify(data, null, 2)}\n`);
console.log(`${Object.keys(data).length} photos → ${outDir}`);
