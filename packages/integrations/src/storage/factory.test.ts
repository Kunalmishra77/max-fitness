import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createStorageDriver } from './factory';

/**
 * One place decides where the bytes live (system-architecture.md §3; ADR-055).
 *
 * The web app and the worker both call this, so they can never disagree about the
 * driver — a selfie written by one must be readable by the other.
 */

const settings = {
  STORAGE_DRIVER: 'local' as 'local' | 's3',
  STORAGE_LOCAL_PATH: mkdtempSync(join(tmpdir(), 'mfp-storage-')),
  S3_ENDPOINT: 'https://abcdefghijklmnop.storage.supabase.co/storage/v1/s3',
  S3_REGION: 'ap-south-1',
  S3_BUCKET: 'member-media',
  S3_ACCESS_KEY_ID: 'id',
  S3_SECRET_ACCESS_KEY: 'secret',
  LINK_TOKEN_SECRET: 'l'.repeat(48),
};

describe('createStorageDriver', () => {
  it('uses the local folder unless told otherwise', () => {
    expect(createStorageDriver(settings).name).toBe('local');
  });

  it('uses the S3 bucket when the driver is s3, without connecting yet', async () => {
    const driver = createStorageDriver({ ...settings, STORAGE_DRIVER: 's3' });
    expect(driver.name).toBe('s3');
    // Signing a link is local work: the bucket is only contacted to read or write.
    expect(await driver.signedUrl('selfies/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 60)).toMatch(/^\/api\/v1\/files\?/);
  });
});
