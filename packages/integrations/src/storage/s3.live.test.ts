import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createS3Client, S3StorageDriver } from './s3';

/**
 * The Supabase bucket itself (ADR-055). Runs only with `S3_LIVE_TEST=1`, so an ordinary
 * `pnpm test` never touches the network; the connection comes from the root `.env`.
 *
 * It proves what the in-memory tests cannot: that the keys work, that the SDK's
 * requests are accepted by Supabase's S3 endpoint, that a delete really removes the
 * object, and that the bucket is private — the same object is not served at the
 * public object URL.
 */

try {
  process.loadEnvFile(fileURLToPath(new URL('../../../../.env', import.meta.url)));
} catch {
  // No .env: rely on the process environment.
}

const env = process.env;
const live = env['S3_LIVE_TEST'] === '1';

describe.skipIf(!live)('S3StorageDriver against the Supabase bucket', () => {
  const endpoint = env['S3_ENDPOINT'] ?? '';
  const bucket = env['S3_BUCKET'] ?? '';
  // Built inside the tests: the SDK refuses a missing region as soon as the client is
  // created, and a skipped suite must not fail while it is being collected.
  const makeDriver = () =>
    new S3StorageDriver({
      client: createS3Client({
        endpoint,
        region: env['S3_REGION'] ?? '',
        accessKeyId: env['S3_ACCESS_KEY_ID'] ?? '',
        secretAccessKey: env['S3_SECRET_ACCESS_KEY'] ?? '',
      }),
      bucket,
      urlSigningSecret: 'l'.repeat(48),
    });

  it('writes, reads back, deletes, and the object is gone', async () => {
    const driver = makeDriver();
    const text = `live check ${new Date().toISOString()}`;
    const stored = await driver.put({ body: new TextEncoder().encode(text), mimeType: 'text/plain', prefix: 'healthcheck' });
    try {
      expect(await driver.exists(stored.key)).toBe(true);
      expect(new TextDecoder().decode(await driver.get(stored.key))).toBe(text);
    } finally {
      await driver.delete(stored.key);
    }
    expect(await driver.exists(stored.key)).toBe(false);
  }, 60_000);

  it('keeps the bucket private: the public object URL does not serve what was written', async () => {
    const driver = makeDriver();
    const stored = await driver.put({ body: new TextEncoder().encode('private'), mimeType: 'text/plain', prefix: 'healthcheck' });
    try {
      const publicUrl = `${endpoint.replace(/\/s3\/?$/, '')}/object/public/${bucket}/${stored.key}`;
      const response = await fetch(publicUrl);
      expect(response.status).not.toBe(200);
    } finally {
      await driver.delete(stored.key);
    }
  }, 60_000);
});
