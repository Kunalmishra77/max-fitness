import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * Before any browser launches.
 *
 * **The refusal comes first.** These journeys drive the real application: they fill the
 * QR form, take payments and send WhatsApp. Until 2026-10-18 they did all of that against
 * `DATABASE_URL`, which is the gym's live register — tolerable while the gym was in demo
 * mode, and not tolerable since the owner turned demo off, cleared the allowlist and put
 * live Razorpay keys in. A test sign-up would now message a real person.
 *
 * `scripts/e2e-env.mjs` points the suite at `mfp_test` and forces `DEMO_MODE`. This is
 * the check that it was used: run `playwright test` straight and the environment is not
 * there, so the suite stops here instead of on a member's phone.
 */

const TEST_DB = 'mfp_test';

function refuseUnlessIsolated(): void {
  const url = process.env['DATABASE_URL'];
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL is not set. Start the suite with `pnpm --filter @mfp/web run test:e2e`, which isolates it.');
  }
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    throw new Error('DATABASE_URL is not a URL — refusing to run against an unknown database.');
  }
  if (!path.endsWith(`/${TEST_DB}`)) {
    throw new Error(
      `The end-to-end suite writes members, takes payments and sends WhatsApp. DATABASE_URL points at "${path.slice(1)}", not ${TEST_DB}.\n` +
        'Run `pnpm --filter @mfp/web run test:e2e`, which points it at the test database and forces DEMO_MODE.',
    );
  }
  if (process.env['DEMO_MODE'] !== 'true') {
    throw new Error('DEMO_MODE is not true. The suite must not be able to send a real message.');
  }
}

/** Draws the fake-camera fixtures before any browser launches (they are passed as Chrome flags). */
export default function globalSetup(): void {
  refuseUnlessIsolated();
  execFileSync(process.execPath, [fileURLToPath(new URL('../scripts/make-face-fixture.mjs', import.meta.url))], { stdio: 'inherit' });
}
