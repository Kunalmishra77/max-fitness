/*
 * Hero slides from the gym's own photos, until the owner's film is cut (ADR-061).
 *
 * Writes public/media/hero/hero{n}-poster.{avif,webp} (landscape, 1600×900) and
 * hero{n}-mobile-poster.{avif,webp} (portrait, 720×1280) from assets/photos/gbp, with the
 * same turns and crops as the gallery, graded darker and less saturated so white text and
 * gold read over them. The hero animates them slowly (Ken Burns), so the page moves like a
 * film without loading one. Nothing is enlarged past its source.
 *
 *   node scripts/build-hero-posters.mjs
 */
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const sourceDir = resolve(here, '../../../assets/photos/gbp');
const outDir = resolve(here, '../public/media/hero');
const manifest = JSON.parse(await readFile(resolve(sourceDir, 'manifest.json'), 'utf8'));

/** Which photo each slide uses, per orientation. Slide order matches hero.tsx. */
const SLIDES = [
  // The trainer photo is a portrait video frame: keep it tall, cutting above the timestamp near the bottom.
  { n: 1, landscape: 'functional-turf', portrait: 'trainer-spot', portraitCrop: { left: 0, top: 0, width: 1, height: 0.82 } },
  { n: 2, landscape: 'floor-treadmills', portrait: 'floor-treadmills' },
  { n: 3, landscape: 'cardio-crossfit', portrait: 'cardio-crossfit' },
];

async function upright(id, cropOverride) {
  const entry = manifest.find((item) => item.id === id);
  if (entry === undefined) throw new Error(`No photo ${id} in the manifest`);
  let image = sharp(await readFile(resolve(sourceDir, entry.source))).rotate();
  if (entry.rotate) image = sharp(await image.toBuffer()).rotate(entry.rotate);
  // The gallery's crops remove things like a video timestamp; the hero keeps them out too.
  const crop = cropOverride ?? (id === 'cardio-crossfit' ? undefined : entry.crop);
  if (crop) {
    const buffer = await image.toBuffer();
    const { width, height } = await sharp(buffer).metadata();
    image = sharp(buffer).extract({
      left: Math.round(crop.left * width),
      top: Math.round(crop.top * height),
      width: Math.round(crop.width * width),
      height: Math.round(crop.height * height),
    });
  }
  return image.toBuffer();
}

async function write(buffer, width, height, name) {
  const { width: w, height: h } = await sharp(buffer).metadata();
  // Never enlarge: take the largest box of the right shape that the photo holds.
  const scale = Math.min(1, w / width, h / height);
  const graded = sharp(buffer)
    .resize(Math.round(width * scale), Math.round(height * scale), { fit: 'cover', position: sharp.strategy.attention })
    .modulate({ brightness: 0.82, saturation: 0.72 })
    .linear(1.08, -10);
  await graded.clone().avif({ quality: 52, effort: 6 }).toFile(resolve(outDir, `${name}.avif`));
  await graded.clone().webp({ quality: 74 }).toFile(resolve(outDir, `${name}.webp`));
  console.log(`${name} ${Math.round(width * scale)}x${Math.round(height * scale)}`);
}

for (const slide of SLIDES) {
  await write(await upright(slide.landscape), 1600, 900, `hero${slide.n}-poster`);
  await write(await upright(slide.portrait, slide.portraitCrop), 720, 1280, `hero${slide.n}-mobile-poster`);
}
