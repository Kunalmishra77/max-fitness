/**
 * Write the two environment blocks to paste into Coolify, one per application.
 *
 * Coolify's variables are per-application and are entered by hand, which is forty-odd
 * chances to mistype a secret. This reads the working `.env`, applies the differences
 * production needs, and writes two files to paste in one go.
 *
 * The files land in `secrets/`, which `.gitignore` excludes. They hold real credentials:
 * read them, paste them, and they can be deleted.
 *
 *   pnpm --filter @mfp/worker run make:coolify-env
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Never carried to production: a test database, a shadow database, a seed's fake today. */
const DROP = new Set(['TEST_DATABASE_URL', 'SHADOW_DATABASE_URL', 'SEED_TODAY', 'ALLOW_DEMO_IN_PRODUCTION', 'STORAGE_LOCAL_PATH']);

/** What production says regardless of what the working file says. */
const OVERRIDE: Readonly<Record<string, string>> = {
  NODE_ENV: 'production',
  DEMO_MODE: 'false',
  APP_URL: 'https://maxfitnessgym.co.in',
  LOG_LEVEL: 'info',
  // The working file says `local`, which is right for a laptop and catastrophic on a
  // container: member photos would be written to the container's own filesystem and lost
  // on the next redeploy. Production is always object storage.
  STORAGE_DRIVER: 's3',
};

/** Set on the worker only. */
const WORKER_ONLY: Readonly<Record<string, string>> = {
  WORKER_ID: 'coolify-1',
  WORKER_CONCURRENCY: '2',
  WORKER_DB_POOL_MAX: '5',
};

/** The web app never reads these. */
const WEB_DROP = new Set(Object.keys(WORKER_ONLY));

function main(): void {
  const root = join(fileURLToPath(new URL('../../..', import.meta.url)));
  const lines = readFileSync(join(root, '.env'), 'utf8').split(/\r?\n/);

  const values = new Map<string, string>();
  for (const line of lines) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (match?.[1] !== undefined) values.set(match[1], match[2] ?? '');
  }
  for (const [key, value] of Object.entries(OVERRIDE)) values.set(key, value);

  // A value supplied on the command line wins over the working file. That is how the live
  // Razorpay credentials reach these blocks without ever being written into the repository:
  //
  //   RAZORPAY_KEY_ID=... RAZORPAY_KEY_SECRET=... pnpm ... run make:coolify-env
  for (const key of [...values.keys()]) {
    const supplied = process.env[key];
    if (supplied !== undefined && supplied !== '' && !(key in OVERRIDE)) values.set(key, supplied);
  }

  const render = (keys: string[]) =>
    keys
      .filter((key) => !DROP.has(key))
      .map((key) => `${key}=${values.get(key) ?? ''}`)
      .join('\n');

  const all = [...values.keys()].sort();

  // The web app talks to the transaction pooler, which suits short request-shaped queries.
  const web = render(all.filter((key) => !WEB_DROP.has(key)));

  // The worker holds longer transactions, so its DATABASE_URL is the session pooler —
  // the same address as DIRECT_URL. Transaction mode would break its prepared statements.
  const workerValues = new Map(values);
  const direct = values.get('DIRECT_URL');
  if (direct !== undefined && direct !== '') workerValues.set('DATABASE_URL', direct);
  for (const [key, value] of Object.entries(WORKER_ONLY)) workerValues.set(key, value);
  const worker = [...workerValues.keys()]
    .sort()
    .filter((key) => !DROP.has(key))
    .map((key) => `${key}=${workerValues.get(key) ?? ''}`)
    .join('\n');

  const dir = join(root, 'secrets');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'coolify-web.env'), `${web}\n`, 'utf8');
  writeFileSync(join(dir, 'coolify-worker.env'), `${worker}\n`, 'utf8');

  const count = (block: string) => block.split('\n').filter((line) => line.trim() !== '').length;
  console.log(`secrets/coolify-web.env      ${count(web)} variables`);
  console.log(`secrets/coolify-worker.env   ${count(worker)} variables (DATABASE_URL = the session pooler)`);
  console.log('\nThese hold real credentials and are outside git. Paste them into Coolify, then delete them.');

  // Named, not printed: a missing one is worth knowing about before the first deploy fails.
  const empty = all.filter((key) => !DROP.has(key) && (values.get(key) ?? '') === '');
  if (empty.length > 0) console.log(`\nEmpty, so set in Coolify by hand if they are needed: ${empty.join(', ')}`);
}

main();
