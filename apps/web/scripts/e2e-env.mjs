/**
 * The environment the end-to-end suite is allowed to run in.
 *
 *   node apps/web/scripts/e2e-env.mjs -- <command...>
 *
 * The browser journeys drive the **real application**: they fill the QR form, take
 * payments and send WhatsApp. Until now they did all of that against `DATABASE_URL`,
 * which is the gym's live register — tolerable while the gym was in demo mode, and not
 * tolerable from 2026-10-16, when the owner turned demo off, cleared the allowlist and
 * put live Razorpay keys in. A test sign-up would now message a real person.
 *
 * So this is the only way they are started. It takes the repository's `.env`, points the
 * database at `mfp_test`, forces `DEMO_MODE`, and **refuses to run** if the result still
 * looks like production. A guard that can be forgotten is not a guard, so the suite does
 * not get a path around it.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const TEST_DB = 'mfp_test';

process.loadEnvFile(fileURLToPath(new URL('../../../.env', import.meta.url)));

/** Same host and credentials, a different database. */
function onTestDatabase(value) {
  if (value === undefined || value === '') return undefined;
  const url = new URL(value);
  url.pathname = `/${TEST_DB}`;
  return url.toString();
}

const env = {
  ...process.env,
  NODE_ENV: 'development',
  DATABASE_URL: onTestDatabase(process.env['DATABASE_URL']),
  DIRECT_URL: onTestDatabase(process.env['DIRECT_URL']),
  // Nothing may leave the machine: no WhatsApp, no Razorpay, no OTP.
  DEMO_MODE: 'true',
  /**
   * The suite runs against `next dev`, and React's development build needs `eval()`.
   * The CSP deliberately withholds `'unsafe-eval'` — correct for production, where React
   * never calls it — so an enforced policy stops the application booting and every
   * journey fails on a blank page. Report-only still sends the header and still records
   * what it would have blocked.
   *
   * **The enforced policy is therefore not covered here.** It needs a production build
   * and a browser, which is REL/SEC-013's job, not this suite's.
   */
  CSP_REPORT_ONLY: 'true',
  WHATSAPP_PROVIDER: 'simulator',
  WHATSAPP_ALLOWLIST: '',
};

/**
 * The check that makes the rest of it true. A typo in `.env`, a renamed variable, a
 * future edit that drops a line — any of them would quietly aim the suite at the
 * register again, and the first sign of it would be a member's phone buzzing.
 */
for (const name of ['DATABASE_URL', 'DIRECT_URL']) {
  const value = env[name];
  if (value === undefined) throw new Error(`${name} is not set — refusing to run the suite`);
  if (!new URL(value).pathname.endsWith(`/${TEST_DB}`)) {
    throw new Error(`${name} does not point at ${TEST_DB} — refusing to run the suite against the live register`);
  }
}
if (env['DEMO_MODE'] !== 'true') throw new Error('DEMO_MODE must be true for the suite');

const argv = process.argv.slice(2);
const command = argv[0] === '--' ? argv.slice(1) : argv;
if (command.length === 0) throw new Error('Nothing to run. Usage: node e2e-env.mjs -- <command...>');

console.log(`[e2e] database ${TEST_DB}, DEMO_MODE=true, nothing leaves this machine`);

const child = spawn(command[0], command.slice(1), { stdio: 'inherit', shell: true, env });
child.on('exit', (code) => process.exit(code ?? 1));
