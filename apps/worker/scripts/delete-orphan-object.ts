/**
 * Delete one stored object by key, for the case the wipe script reports and does not swallow.
 *
 * `wipe:members` deletes a member's files after the rows commit, and names any key that
 * would not go rather than pretending it did. A selfie left in a bucket after its member
 * is gone is the kind of thing nobody notices until it matters, so there is a way to
 * finish the job by hand.
 *
 *   pnpm --filter @mfp/worker run delete:object -- --key=selfies/abc123
 *   pnpm --filter @mfp/worker run delete:object -- --key=selfies/abc123 --yes
 */
import { createStorageDriver, type StorageSettings } from '@mfp/integrations/storage';

const args = process.argv.slice(2);
const key = args.find((arg) => arg.startsWith('--key='))?.slice('--key='.length)?.trim() ?? '';
const commit = args.includes('--yes');

const need = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`${name} is not set`);
  return value;
};

async function main(): Promise<void> {
  process.loadEnvFile(new URL('../../../.env', import.meta.url));
  if (key === '') throw new Error('Pass --key=<storage key>');

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
    console.log(`Dry run — would delete ${key}. Pass --yes.`);
    return;
  }
  await storage.delete(key);
  console.log(`Deleted ${key}`);
}

await main();
