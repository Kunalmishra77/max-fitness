/**
 * The reception QR standee, drawn as SVG (assets/reception-qr/README.md; qr-onboarding-flow §1).
 *
 * Pure layout: the caller hands in the QR's module matrix (from the `qrcode` library at
 * error correction Q), so the drawing can be tested without it. Sizes are millimetres, so
 * a print shop gets the code at exactly 9 cm on A4. The QR is pure black on white with a
 * four-module quiet zone; the colours around it are the brand's (design-tokens.json).
 */

export const POSTER_SIZES = {
  // 110 mm on A4. The code is the only thing on this sheet that has a job, and a bigger one
  // scans from further away and through a worse camera — which at a gym door is every camera.
  A4: { width: 210, height: 297, qrMm: 110 },
  A5: { width: 148, height: 210, qrMm: 78 },
} as const;
export type PosterSize = keyof typeof POSTER_SIZES;

const QUIET_MODULES = 4;
// The logo's colours (ADR-061): black, logo red, a light paper ground and a neutral grey.
const NAVY = '#0A0A0B';
const RED = '#ED1021';
const CHALK = '#F4F4F5';
const GREY = '#66676B';

export interface QrMatrix {
  readonly size: number;
  /** Row-major, `true` for a dark module. */
  readonly modules: readonly boolean[];
}

/** The static link on every poster; `src` tells the reports which poster was scanned. */
export function receptionQrUrl(origin: string, gymSlug: string, source: 'reception' | 'counter2' | 'flyer'): string {
  const base = new URL(origin);
  if (base.protocol !== 'https:') throw new Error('The poster link must be https');
  const url = new URL('/qr', base);
  url.search = new URLSearchParams({ src: source, g: gymSlug, utm_source: 'qr', utm_medium: 'poster' }).toString();
  return url.toString();
}

const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** One path for all dark modules: small file, crisp at any print size. */
function qrPath(qr: QrMatrix): string {
  const parts: string[] = [];
  for (let row = 0; row < qr.size; row += 1) {
    for (let col = 0; col < qr.size; col += 1) {
      if (qr.modules[row * qr.size + col] === true) parts.push(`M${col + QUIET_MODULES} ${row + QUIET_MODULES}h1v1h-1z`);
    }
  }
  return parts.join('');
}

export interface PosterLogo {
  readonly dataUri: string;
  /** Width divided by height. */
  readonly aspect: number;
}

export function buildPosterSvg(input: { qr: QrMatrix; size: PosterSize; demo: boolean; url: string; logo?: PosterLogo }): string {
  const { width, height, qrMm } = POSTER_SIZES[input.size];
  // Everything is laid out on A4 and scaled, so the A5 card is the same poster, smaller.
  const k = width / 210;
  const mm = (value: number) => Number((value * k).toFixed(2));
  const modulesAcross = input.qr.size + 2 * QUIET_MODULES;
  const scale = Number((qrMm / modulesAcross).toFixed(4));
  const qrX = Number(((width - qrMm) / 2).toFixed(2));

  const text = (y: number, size: number, weight: number, fill: string, content: string, spacing = 0) =>
    `<text x="${width / 2}" y="${y}" text-anchor="middle" font-family="Khand, 'Arial Narrow', Arial, sans-serif" font-size="${size}" font-weight="${weight}" fill="${fill}"${spacing === 0 ? '' : ` letter-spacing="${spacing}"`}>${escape(content)}</text>`;
  const body = (y: number, size: number, weight: number, fill: string, content: string) =>
    `<text x="${width / 2}" y="${y}" text-anchor="middle" font-family="Hind, Arial, sans-serif" font-size="${size}" font-weight="${weight}" fill="${fill}">${escape(content)}</text>`;

  // ── The dark head ────────────────────────────────────────────────────────
  // A block rather than a thin rule: on a wall at three metres this is what a member sees
  // first, and it is what makes a white sheet of paper look like the gym's.
  const headH = mm(72);
  const logoH = mm(34);
  const logoW = input.logo === undefined ? 0 : Number((logoH * input.logo.aspect).toFixed(2));

  // ── The code ─────────────────────────────────────────────────────────────
  const qrY = headH + mm(26);
  const below = qrY + qrMm;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}mm" height="${height}mm" viewBox="0 0 ${width} ${height}">`,
    `<rect width="${width}" height="${height}" fill="#FFFFFF"/>`,

    `<rect width="${width}" height="${headH}" fill="${NAVY}"/>`,
    `<rect y="${headH}" width="${width}" height="${mm(2.4)}" fill="${RED}"/>`,
    ...(input.logo === undefined
      ? [text(mm(42), mm(22), 700, '#FFFFFF', 'MAX FITNESS GYM', mm(0.6))]
      : [
          `<image href="${input.logo.dataUri}" x="${Number((width / 2 - logoW / 2).toFixed(2))}" y="${mm(12)}" width="${logoW}" height="${logoH}"/>`,
          text(mm(58), mm(11), 700, '#FFFFFF', 'MAX FITNESS GYM', mm(0.5)),
          body(mm(66), mm(4.6), 500, '#A3A5A9', 'Indirapuram · Since 2000'),
        ]),

    // The instruction above the code, not below it: somebody walking up reads downward, and
    // by the time their eye reaches the code they should already know what it is for.
    text(headH + mm(17), mm(13), 700, NAVY, 'SCAN TO JOIN', mm(0.8)),

    input.demo
      ? `<text x="${width / 2}" y="${height / 2}" text-anchor="middle" font-family="Khand, Arial, sans-serif" font-size="${mm(60)}" font-weight="700" fill="${RED}" fill-opacity="0.18" transform="rotate(-35 ${width / 2} ${height / 2})">DEMO</text>`
      : '',

    // White, framed, with its quiet zone inside the frame. Nothing is ever drawn over the
    // modules: a tint across them is the classic way to make a poster that will not scan.
    `<rect x="${qrX - mm(5)}" y="${qrY - mm(5)}" width="${qrMm + mm(10)}" height="${qrMm + mm(10)}" rx="${mm(3)}" fill="#FFFFFF" stroke="${NAVY}" stroke-width="${mm(0.8)}"/>`,
    `<g id="qr" transform="translate(${qrX} ${qrY}) scale(${scale})">`,
    `<rect width="${modulesAcross}" height="${modulesAcross}" fill="#FFFFFF"/>`,
    `<path d="${qrPath(input.qr)}" fill="#000000" shape-rendering="crispEdges"/>`,
    `</g>`,

    // One line, and it has to answer both people who will stand here — the newcomer and the
    // member who has been coming for six years. Two lines of instructions is one too many.
    body(below + mm(16), mm(6.4), 600, NAVY, 'New here, or already a member — start here.'),
    body(below + mm(25), mm(4.8), 400, GREY, 'Open the camera and point it at the code.'),

    // ── Thank you ────────────────────────────────────────────────────────────
    `<rect x="${mm(42)}" y="${height - mm(44)}" width="${width - mm(84)}" height="${mm(0.5)}" fill="${RED}"/>`,
    ...(input.logo === undefined
      ? []
      : [
          `<image href="${input.logo.dataUri}" x="${Number((width / 2 - (mm(13) * input.logo.aspect) / 2).toFixed(2))}" y="${height - mm(38)}" width="${Number((mm(13) * input.logo.aspect).toFixed(2))}" height="${mm(13)}" opacity="0.9"/>`,
        ]),
    text(height - mm(16), mm(8), 700, NAVY, 'THANK YOU', mm(1.2)),
    // The bare domain, not the link inside the code. That link carries tracking parameters
    // forty characters long; printed, nobody reads it and nobody could type it. What a
    // person stuck at a dead camera needs is somewhere they can actually get to.
    body(height - mm(9), mm(4), 500, GREY, new URL(input.url).host),
    `</svg>`,
    '',
  ].join('\n');
}
