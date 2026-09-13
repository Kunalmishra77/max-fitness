import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** Draws the fake-camera fixtures before any browser launches (they are passed as Chrome flags). */
export default function globalSetup(): void {
  execFileSync(process.execPath, [fileURLToPath(new URL('../scripts/make-face-fixture.mjs', import.meta.url))], { stdio: 'inherit' });
}
