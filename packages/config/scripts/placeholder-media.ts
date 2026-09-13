/**
 * Placeholder hero media, until the real footage is shot (assets-checklist §3–4).
 *
 * Phase 2 rules: no stock people, no burned-in text. So each loop is abstract — a
 * Plate Navy field with slow-moving bars in the brand's red, wall blue and chalk —
 * and it pans on a sine curve so frame 7 s meets frame 0 and the loop is seamless.
 *
 * Output follows assets/videos/README.md naming, into apps/web/public/media/hero/:
 *   hero{n}-720.{mp4,webm}                 1280×720 desktop
 *   hero{n}-mobile-720x1280.{mp4,webm}     portrait
 *   hero{n}-poster.{avif,webp}             desktop poster (first frame)
 *   hero{n}-mobile-poster.{avif,webp}      portrait poster
 *
 * Re-run any time: `pnpm --filter @mfp/config run placeholder-media`. Requires ffmpeg
 * on PATH. Replace the files with real footage using the same names — no code change.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const outDir = join(repoRoot, 'apps', 'web', 'public', 'media', 'hero');

const NAVY = '0x14213D';
const RED = '0xD62828';
const BLUE = '0x2F5DAA';
const CHALK = '0xF2F3EF';
const SECONDS = 7;

interface Bar {
  readonly at: number; // position along the long axis, 0..1
  readonly across: number; // position across, 0..1
  readonly thickness: number; // 0..1 of the short side
  readonly length: number; // 0..1 of the short side
  readonly colour: string;
  readonly alpha: number;
}

/** Three compositions: red-led, blue-led, mixed. Gold is reserved for the champion section. */
const SLIDES: readonly (readonly Bar[])[] = [
  [
    { at: 0.06, across: 0.25, thickness: 0.12, length: 0.5, colour: RED, alpha: 1 },
    { at: 0.14, across: 0.33, thickness: 0.05, length: 0.34, colour: CHALK, alpha: 0.16 },
    { at: 0.36, across: 0.17, thickness: 0.18, length: 0.66, colour: BLUE, alpha: 0.85 },
    { at: 0.47, across: 0.42, thickness: 0.07, length: 0.16, colour: RED, alpha: 0.55 },
    { at: 0.68, across: 0.28, thickness: 0.14, length: 0.44, colour: CHALK, alpha: 0.12 },
    { at: 0.8, across: 0.2, thickness: 0.09, length: 0.58, colour: RED, alpha: 0.85 },
  ],
  [
    { at: 0.05, across: 0.2, thickness: 0.16, length: 0.6, colour: BLUE, alpha: 0.95 },
    { at: 0.24, across: 0.38, thickness: 0.06, length: 0.24, colour: RED, alpha: 0.7 },
    { at: 0.4, across: 0.24, thickness: 0.1, length: 0.52, colour: CHALK, alpha: 0.14 },
    { at: 0.58, across: 0.14, thickness: 0.2, length: 0.72, colour: BLUE, alpha: 0.7 },
    { at: 0.78, across: 0.35, thickness: 0.08, length: 0.3, colour: RED, alpha: 0.9 },
  ],
  [
    { at: 0.08, across: 0.3, thickness: 0.1, length: 0.4, colour: CHALK, alpha: 0.18 },
    { at: 0.2, across: 0.18, thickness: 0.14, length: 0.64, colour: RED, alpha: 0.9 },
    { at: 0.42, across: 0.3, thickness: 0.12, length: 0.4, colour: BLUE, alpha: 0.9 },
    { at: 0.6, across: 0.22, thickness: 0.06, length: 0.56, colour: CHALK, alpha: 0.14 },
    { at: 0.74, across: 0.26, thickness: 0.16, length: 0.48, colour: RED, alpha: 0.75 },
  ],
];

function run(args: string[]): void {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
  if (result.error !== undefined) {
    throw new Error(`Could not run ffmpeg (${result.error.message}). Install ffmpeg and put it on PATH.`);
  }
  if (result.status !== 0) {
    throw new Error(`ffmpeg exited with status ${String(result.status)}`);
  }
}

/**
 * Build the filter graph. Bars are drawn on a canvas 1.5× the output along the pan
 * axis; a crop then glides across it on a sine wave with a period of exactly one loop.
 */
function filter(bars: readonly Bar[], orientation: 'landscape' | 'portrait'): { source: string; graph: string } {
  const [outW, outH] = orientation === 'landscape' ? [1280, 720] : [720, 1280];
  const [canvasW, canvasH] = orientation === 'landscape' ? [1920, 720] : [720, 1920];
  const shortSide = Math.min(outW, outH);
  const panRange = orientation === 'landscape' ? canvasW - outW : canvasH - outH;
  const half = panRange / 2;

  const boxes = bars.map((bar) => {
    const thickness = Math.round(bar.thickness * shortSide);
    const length = Math.round(bar.length * shortSide);
    const along = Math.round(bar.at * (orientation === 'landscape' ? canvasW : canvasH));
    const across = Math.round(bar.across * shortSide);
    const [x, y, w, h] = orientation === 'landscape' ? [along, across, thickness, length] : [across, along, length, thickness];
    return `drawbox=x=${x}:y=${y}:w=${w}:h=${h}:color=${bar.colour}@${bar.alpha}:t=fill`;
  });

  const pan = `${half}+${half}*sin(2*PI*t/${SECONDS})`;
  const crop = orientation === 'landscape' ? `crop=${outW}:${outH}:x='${pan}':y=0` : `crop=${outW}:${outH}:x=0:y='${pan}'`;

  // A faint static grain, applied before the crop so it pans with the bars. A flat
  // placeholder compresses to under 1 KB, which Chrome treats as a low-entropy image
  // and skips as a Largest Contentful Paint candidate. Real photo posters are well
  // above that threshold, so the grain makes the performance budget measure what the
  // real hero will do. It is the same every frame, so the video stays small.
  const grain = 'noise=alls=10:allf=u';

  return {
    source: `color=c=${NAVY}:s=${canvasW}x${canvasH}:r=30:d=${SECONDS}`,
    graph: [...boxes, grain, crop, 'format=yuv420p'].join(','),
  };
}

function encode(index: number, bars: readonly Bar[], orientation: 'landscape' | 'portrait'): string[] {
  const base = orientation === 'landscape' ? `hero${index}-720` : `hero${index}-mobile-720x1280`;
  const poster = orientation === 'landscape' ? `hero${index}-poster` : `hero${index}-mobile-poster`;
  const { source, graph } = filter(bars, orientation);
  const mp4 = join(outDir, `${base}.mp4`);
  const webm = join(outDir, `${base}.webm`);

  run(['-f', 'lavfi', '-i', source, '-vf', graph, '-an', '-c:v', 'libx264', '-profile:v', 'high', '-crf', '28', '-preset', 'slow', '-movflags', '+faststart', mp4]);
  run(['-f', 'lavfi', '-i', source, '-vf', graph, '-an', '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '40', '-row-mt', '1', webm]);
  run(['-i', mp4, '-frames:v', '1', '-c:v', 'libwebp', '-quality', '75', join(outDir, `${poster}.webp`)]);
  // CRF 18: at 32 the AV1 encoder smooths the grain away and the poster drops back under 1 KB.
  run(['-i', mp4, '-frames:v', '1', '-c:v', 'libaom-av1', '-still-picture', '1', '-crf', '18', join(outDir, `${poster}.avif`)]);

  return [mp4, webm, join(outDir, `${poster}.webp`), join(outDir, `${poster}.avif`)];
}

function main(): void {
  mkdirSync(outDir, { recursive: true });
  const written: string[] = [];
  SLIDES.forEach((bars, i) => {
    written.push(...encode(i + 1, bars, 'landscape'), ...encode(i + 1, bars, 'portrait'));
  });
  for (const file of written) {
    const kb = (statSync(file).size / 1024).toFixed(0);
    console.log(`  ${file.slice(repoRoot.length + 1).replace(/\\/g, '/')}  ${kb} KB`);
  }
  console.log(`Wrote ${written.length} placeholder hero files (budget: ≤ 1.5 MB mobile, ≤ 3 MB desktop per clip).`);
}

main();
