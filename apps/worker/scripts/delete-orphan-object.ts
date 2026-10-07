/**
 * Delete stored objects by key, for the case the wipe script reports and does not swallow.
 *
 * `wipe:members` deletes a member's files after the rows commit, and names any key that
 * would not go rather than pretending it did. A selfie left in a bucket after its member is
 * gone is the kind of thing nobody notices until it matters, so there is a way to finish the
 * job by hand.
 *
 * It takes several keys because that is how the failure actually arrives: the bucket is
 * unreachable for a moment and a whole wipe's worth of files is left behind at once. Running
 * this twenty-one times, pasting a key each time, is how one gets missed.
 *
 * **Run it where the bucket is reachable.** The object store is not open to the world, so
 * from a laptop this times out; inside the worker container on the server it does not.
 *
 *   pnpm --filter @mfp/worker run delete:object -- --key=selfies/abc123
 *   pnpm --filter @mfp/worker run delete:object -- --key=selfies/abc,gov-ids/def --yes
 */
import { createStorageDriver, type StorageSettings } from '@mfp/integrations/storage';

const args = process.argv.slice(2);
const keys = (args.find((arg) => arg.startsWith('--key='))?.slice('--key='.length) ?? '')
  .split(',')
  .map((one) => one.trim())
  .filter((one) => one !== '');
const commit = args.includes('--yes');

const need = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`${name} is not set`);
  return value;
};

async function main(): Promise<void> {
  // The container has no repository `.env`: its settings come from the platform, and this
  // script has to run there, where the bucket is reachable.
  try {
    process.loadEnvFile(new URL('../../../.env', import.meta.url));
  } catch {
    // Already in the environment.
  }
  if (keys.length === 0) throw new Error('Pass --key=<storage key>[,<storage key>...]');

  // The same shape `wipe:members` builds, so the two cannot drift apart.
  const settings: StorageSettings = {
    STORAGE_DRIVER: 's3',
    STORAGE_LOCAL_PATH: process.env['STORAGE_LOCAL_PATH'] ?? './storage',
    S3_ENDPOINT: need('S3_ENDPOINT'),
    S3_REGION: need('S3_REGION'),
    S3_BUCKET: need('S3_BUCKET'),
    S3_ACCESS_KEY_ID: need('S3_ACCESS_KEY_ID'),
    S3_SECRET_ACCESS_KEY: need('S3_SECRET_ACCESS_KEY'),
    LINK_TOKEN_SECRET: need('LINK_TOKEN_SECRET'),
  };
  const storage = createStorageDriver(settings);

  if (!commit) {
    console.log(`Dry run — would delete ${keys.length} object(s):`);
    for (const one of keys) console.log(`   ${one}`);
    console.log('Pass --yes.');
    return;
  }

  let gone = 0;
  const failed: string[] = [];
  for (const one of keys) {
    try {
      await storage.delete(one);
      gone += 1;
      console.log(`deleted  ${one}`);
    } catch (error) {
      // Named, not swallowed. A file nobody knows is still there is the whole problem.
      failed.push(one);
      console.log(`FAILED   ${one} — ${error instanceof Error ? error.message : 'error'}`);
    }
  }
  console.log(`
${gone} deleted, ${failed.length} left behind.`);
  if (failed.length > 0) {
    console.log('Still there:');
    for (const one of failed) console.log(`   ${one}`);
    process.exitCode = 1;
  }
}

await main();
