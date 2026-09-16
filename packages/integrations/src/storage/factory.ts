import type { StorageDriver } from '@mfp/core/ports';
import { LocalStorageDriver } from './local';
import { createS3Client, S3StorageDriver } from './s3';
import { resolveStorageRoot } from './storage-root';

/**
 * Where the bytes live (system-architecture.md §3; ADR-055).
 *
 * The web app and the worker both build their driver here, so they cannot disagree: a
 * selfie the website stored must be one the worker can delete. Building the S3 driver
 * opens no connection; the bucket is contacted only to read or write.
 */

export interface StorageSettings {
  readonly STORAGE_DRIVER: 'local' | 's3';
  readonly STORAGE_LOCAL_PATH: string;
  readonly S3_ENDPOINT: string;
  readonly S3_REGION: string;
  readonly S3_BUCKET: string;
  readonly S3_ACCESS_KEY_ID: string;
  readonly S3_SECRET_ACCESS_KEY: string;
  /** Signs the short-lived read links, whichever driver serves them. */
  readonly LINK_TOKEN_SECRET: string;
}

export function createStorageDriver(settings: StorageSettings): StorageDriver {
  if (settings.STORAGE_DRIVER === 's3') {
    return new S3StorageDriver({
      client: createS3Client({
        endpoint: settings.S3_ENDPOINT,
        region: settings.S3_REGION,
        accessKeyId: settings.S3_ACCESS_KEY_ID,
        secretAccessKey: settings.S3_SECRET_ACCESS_KEY,
      }),
      bucket: settings.S3_BUCKET,
      urlSigningSecret: settings.LINK_TOKEN_SECRET,
    });
  }
  return new LocalStorageDriver({
    rootPath: resolveStorageRoot(settings.STORAGE_LOCAL_PATH),
    urlSigningSecret: settings.LINK_TOKEN_SECRET,
  });
}
