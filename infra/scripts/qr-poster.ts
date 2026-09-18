/**
 * The reception QR standee, drawn as SVG (assets/reception-qr/README.md; qr-onboarding-flow §1).
 *
 * Pure layout: the caller hands in the QR's module matrix (from the `qrcode` library at
 * error correction Q), so the drawing can be tested without it. Sizes are millimetres, so
 * a print shop gets the code at exactly 9 cm on A4. The QR is pure black on white with a
 * four-module quiet zone; the colours around it are the brand's (design-tokens.json).
 */

export const POSTER_SIZES = {
  A4: { width: 210, height: 297, qrMm: 90 },
  A5: { width: 148, height: 210, qrMm: 64 },
} as const;
export type PosterSize = keyof typeof POSTER_SIZES;

const QUIET_MODULES = 4;
const NAVY = '#14213D';
const RED = '#D62828';
const CHALK = '#F2F3EF';
const GREY = '#5C6272';

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

export function buildPosterSvg(input: { qr: QrMatrix; size: PosterSize; demo: boolean; url: string }): string {
  const { width, height, qrMm } = POSTER_SIZES[input.size];
  // Everything is laid out on A4 and scaled, so the A5 card is the same poster, smaller.
  const k = width / 210;
  const mm = (value: number) => Number((value * k).toFixed(2));
  const modulesAcross = input.qr.size + 2 * QUIET_MODULES;
  const scale = Number((qrMm / modulesAcross).toFixed(4));
  const qrX = Number(((width - qrMm) / 2).toFixed(2));
  const qrY = mm(92);
  const below = qrY + qrMm;
  const text = (y: number, size: number, weight: number, fill: string, content: string, family = 'Khand, Arial, sans-serif') =>
    `<text x="${width / 2}" y="${y}" text-anchor="middle" font-family="${family}" font-size="${size}" font-weight="${weight}" fill="${fill}">${escape(content)}</text>`;
  const hindi = "'Noto Sans Devanagari', 'Mukta', sans-serif";

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}mm" height="${height}mm" viewBox="0 0 ${width} ${height}">`,
    `<rect width="${width}" height="${height}" fill="${CHALK}"/>`,
    `<rect width="${width}" height="${mm(8)}" fill="${RED}"/>`,
    // The wordmark, until the owner's logo file arrives (assets/brand).
    text(mm(34), mm(20), 700, NAVY, 'MAX FITNESS'),
    text(mm(43), mm(6), 600, GREY, 'Indirapuram · Since 2000'),
    text(mm(62), mm(11), 700, NAVY, 'Scan once. Train stress-free.'),
    text(mm(77), mm(9), 700, NAVY, 'एक बार स्कैन करें।', hindi),
    // Under the code, never over it: a tint across the modules can stop a scan.
    input.demo
      ? `<text x="${width / 2}" y="${height / 2}" text-anchor="middle" font-family="Khand, Arial, sans-serif" font-size="${mm(60)}" font-weight="700" fill="${RED}" fill-opacity="0.18" transform="rotate(-35 ${width / 2} ${height / 2})">DEMO</text>`
      : '',
    `<rect x="${qrX - mm(4)}" y="${qrY - mm(4)}" width="${qrMm + mm(8)}" height="${qrMm + mm(8)}" rx="${mm(4)}" fill="#FFFFFF" stroke="${NAVY}" stroke-width="${mm(1)}"/>`,
    `<g id="qr" transform="translate(${qrX} ${qrY}) scale(${scale})">`,
    `<rect width="${modulesAcross}" height="${modulesAcross}" fill="#FFFFFF"/>`,
    `<path d="${qrPath(input.qr)}" fill="#000000" shape-rendering="crispEdges"/>`,
    `</g>`,
    text(below + mm(20), mm(7), 600, NAVY, 'Already a member? Confirm your details & fee date.'),
    text(below + mm(30), mm(7), 600, NAVY, 'New? Join in 2 minutes.'),
    text(below + mm(42), mm(6.2), 600, NAVY, 'पहले से मेंबर? अपनी जानकारी और फीस की तारीख दें।', hindi),
    text(below + mm(51), mm(6.2), 600, NAVY, 'नए हैं? 2 मिनट में जॉइन करें।', hindi),
    `<rect x="${mm(20)}" y="${height - mm(30)}" width="${width - mm(40)}" height="${mm(0.6)}" fill="${RED}"/>`,
    text(height - mm(20), mm(5.2), 500, GREY, 'Open camera → point at the code  ·  Help? Ask reception.'),
    text(height - mm(12), mm(3.6), 400, GREY, input.url),
    `</svg>`,
    '',
  ].join('\n');
}
