// Copies MediaPipe's WASM runtime from node_modules into public/mediapipe/wasm, so the
// selfie face check is served from our own origin (signup-and-payment-flow.md §2.3) —
// no request to a Google CDN from a member's phone. The files are ~11 MB each and are
// regenerated from the pinned package on every dev/build, so they are not committed.
import { copyFile, mkdir, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const source = join(dirname(require.resolve('@mediapipe/tasks-vision')), 'wasm');
const target = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'mediapipe', 'wasm');

// SIMD build for current browsers; the no-SIMD build is MediaPipe's own fallback for old ones.
const FILES = ['vision_wasm_internal.js', 'vision_wasm_internal.wasm', 'vision_wasm_nosimd_internal.js', 'vision_wasm_nosimd_internal.wasm'];

await mkdir(target, { recursive: true });
for (const file of FILES) {
  const from = join(source, file);
  const to = join(target, file);
  const [a, b] = await Promise.all([stat(from), stat(to).catch(() => null)]);
  if (b !== null && b.size === a.size && b.mtimeMs >= a.mtimeMs) continue;
  await copyFile(from, to);
}
process.stdout.write(`[mediapipe] WASM runtime ready in public/mediapipe/wasm (${FILES.length} files)\n`);
