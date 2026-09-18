/**
 * Writes the reception QR standee (A4) and counter card (A5) as print-ready SVG
 * (qr-onboarding-flow §1; assets/reception-qr/README.md; ADR-060).
 *
 *   pnpm qr:poster -- --origin https://max-fitness-kappa.vercel.app --demo
 *   pnpm qr:poster -- --origin https://maxfitness.in --source counter2
 *
 * The code is error correction Q, so a scratch or a fold still scans. Output goes to
 * assets/reception-qr/, one pair of files per origin and source.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';
import { buildPosterSvg, receptionQrUrl, type PosterSize } from './qr-poster';

const SOURCES = ['reception', 'counter2', 'flyer'] as const;

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main() {
  const origin = arg('origin');
  if (origin === undefined) throw new Error('Pass --origin https://your-domain');
  const source = (arg('source') ?? 'reception') as (typeof SOURCES)[number];
  if (!SOURCES.includes(source)) throw new Error(`--source is one of ${SOURCES.join(', ')}`);
  const gymSlug = arg('gym') ?? 'max-fitness-indirapuram';
  const demo = process.argv.includes('--demo');

  const url = receptionQrUrl(origin, gymSlug, source);
  const code = QRCode.create(url, { errorCorrectionLevel: 'Q' });
  const size = code.modules.size;
  const modules = Array.from({ length: size * size }, (_, i) => code.modules.get(Math.floor(i / size), i % size) === 1);

  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const outDir = join(root, 'assets', 'reception-qr');
  await mkdir(outDir, { recursive: true });
  const host = new URL(origin).hostname.replace(/[^a-z0-9.-]/gi, '');

  for (const paper of ['A4', 'A5'] as PosterSize[]) {
    const file = join(outDir, `qr-${source}-${paper.toLowerCase()}${demo ? '-demo' : ''}-${host}.svg`);
    await writeFile(file, buildPosterSvg({ qr: { size, modules }, size: paper, demo, url }), 'utf8');
    console.log(`wrote ${file}`);
  }
  console.log(`link: ${url}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
