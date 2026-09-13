// Generates e2e/fixtures/face.y4m and face.jpg: a drawn, face-like test pattern for
// Chrome's fake camera and for the file-upload fallback (testing-strategy.md §3,
// journeys 3–4). No photograph of any real person is used.
// Run by the Playwright global setup (e2e/global-setup.ts); the files are not committed.
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const W = 640;
const H = 480;
// Chrome loops the file, so one still frame is enough and keeps it small.
const FRAMES = 1;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <radialGradient id="skin" cx="50%" cy="45%" r="60%">
      <stop offset="0%" stop-color="#e8b894"/><stop offset="70%" stop-color="#c98f6b"/><stop offset="100%" stop-color="#a86f50"/>
    </radialGradient>
    <radialGradient id="bg" cx="50%" cy="40%" r="80%"><stop offset="0%" stop-color="#9fb3c8"/><stop offset="100%" stop-color="#52606d"/></radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <g transform="translate(320 240) scale(1.45) translate(-320 -225)">
  <rect x="235" y="330" width="170" height="160" fill="#b27a58"/>
  <ellipse cx="320" cy="400" rx="230" ry="110" fill="#34495e"/>
  <ellipse cx="320" cy="215" rx="112" ry="142" fill="url(#skin)"/>
  <path d="M208 190 Q215 60 320 62 Q425 60 432 190 Q420 110 320 105 Q220 110 208 190Z" fill="#2b1d16"/>
  <ellipse cx="206" cy="225" rx="16" ry="30" fill="#c08560"/><ellipse cx="434" cy="225" rx="16" ry="30" fill="#c08560"/>
  <path d="M250 172 Q275 160 298 170" stroke="#2b1d16" stroke-width="7" fill="none" stroke-linecap="round"/>
  <path d="M342 170 Q365 160 390 172" stroke="#2b1d16" stroke-width="7" fill="none" stroke-linecap="round"/>
  <ellipse cx="275" cy="200" rx="22" ry="12" fill="#fff"/><ellipse cx="365" cy="200" rx="22" ry="12" fill="#fff"/>
  <circle cx="275" cy="200" r="9" fill="#3b2a20"/><circle cx="365" cy="200" r="9" fill="#3b2a20"/>
  <circle cx="275" cy="200" r="4" fill="#000"/><circle cx="365" cy="200" r="4" fill="#000"/>
  <path d="M320 205 Q312 245 300 258 Q320 268 340 258 Q328 245 320 205Z" fill="#b57a58"/>
  <path d="M280 298 Q320 322 360 298 Q320 308 280 298Z" fill="#8e3b3b"/>
  <ellipse cx="258" cy="262" rx="22" ry="12" fill="#d9967a" opacity="0.5"/><ellipse cx="382" cy="262" rx="22" ry="12" fill="#d9967a" opacity="0.5"/>
  </g>
</svg>`;

const { data } = await sharp(Buffer.from(svg)).removeAlpha().raw().toBuffer({ resolveWithObject: true });

// BT.601 full-range RGB → YUV 4:2:0.
const y = Buffer.alloc(W * H);
const u = Buffer.alloc((W / 2) * (H / 2));
const v = Buffer.alloc((W / 2) * (H / 2));
for (let row = 0; row < H; row += 1) {
  for (let col = 0; col < W; col += 1) {
    const i = (row * W + col) * 3;
    const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
    y[row * W + col] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    if (row % 2 === 0 && col % 2 === 0) {
      const j = (row / 2) * (W / 2) + col / 2;
      u[j] = Math.max(0, Math.min(255, Math.round(128 - 0.168736 * r - 0.331264 * g + 0.5 * b)));
      v[j] = Math.max(0, Math.min(255, Math.round(128 + 0.5 * r - 0.418688 * g - 0.081312 * b)));
    }
  }
}

const frame = Buffer.concat([Buffer.from('FRAME\n'), y, u, v]);
const header = Buffer.from(`YUV4MPEG2 W${W} H${H} F15:1 Ip A1:1 C420jpeg\n`);
await mkdir(new URL('../e2e/fixtures/', import.meta.url), { recursive: true });
await writeFile(new URL('../e2e/fixtures/face.y4m', import.meta.url), Buffer.concat([header, ...Array(FRAMES).fill(frame)]));
// The same drawing as a photo, for the phone-camera fallback (journey 4).
await sharp(Buffer.from(svg)).jpeg({ quality: 85 }).toFile(fileURLToPath(new URL('../e2e/fixtures/face.jpg', import.meta.url)));
