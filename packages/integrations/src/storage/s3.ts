import { createHash } from 'node:crypto';
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { PutObjectRequest, StorageDriver, StoredObject } from '@mfp/core/ports';
import { assertObjectKey, newObjectKey, SignedFileUrls } from './keys';

/**
 * Object storage in a private Supabase Storage bucket, through its S3-compatible
 * endpoint (TRD §4 "S3-compatible"; ADR-055).
 *
 * Only the S3 protocol is used — no supabase-js, no anon or service-role key: the
 * bucket is reached with Storage's own S3 access keys. The driver keeps the local
 * driver's rules (random keys, a content hash, hard deletes, keys checked before any
 * request), and reads still go through our own signed `/api/v1/files` link, so the
 * bucket stays private and nothing depends on the provider's presigned URLs.
 */

/** The one method the driver needs from `S3Client`, so tests can supply their own. */
export interface S3Sender {
  send(command: unknown): Promise<unknown>;
}

export interface S3StorageOptions {
  readonly client: S3Sender;
  readonly bucket: string;
  /** Signs read URLs. Use `LINK_TOKEN_SECRET`. */
  readonly urlSigningSecret: string;
  readonly publicBasePath?: string;
  /** For deterministic tests. */
  readonly now?: () => Date;
}

interface GetObjectOutputLike {
  readonly Body?: { transformToByteArray(): Promise<Uint8Array> };
}

function isNotFound(error: unknown): boolean {
  const { name, $metadata } = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return name === 'NotFound' || name === 'NoSuchKey' || $metadata?.httpStatusCode === 404;
}

export class S3StorageDriver implements StorageDriver {
  readonly name = 's3' as const;
  readonly #client: S3Sender;
  readonly #bucket: string;
  readonly #urls: SignedFileUrls;

  constructor(options: S3StorageOptions) {
    this.#client = options.client;
    this.#bucket = options.bucket;
    this.#urls = new SignedFileUrls({
      secret: options.urlSigningSecret,
      ...(options.publicBasePath === undefined ? {} : { basePath: options.publicBasePath }),
      ...(options.now === undefined ? {} : { now: options.now }),
    });
  }

  async put(request: PutObjectRequest): Promise<StoredObject> {
    const key = newObjectKey(request.prefix);
    await this.#client.send(
      new PutObjectCommand({
        Bucket: this.#bucket,
        Key: key,
        Body: request.body,
        ContentType: request.mimeType,
        // Never meant to sit in a shared cache, even if a URL to it ever leaked.
        CacheControl: 'private, no-store',
      }),
    );
    return {
      key,
      sizeBytes: request.body.byteLength,
      sha256: createHash('sha256').update(request.body).digest('hex'),
      mimeType: request.mimeType,
    };
  }

  async get(key: string): Promise<Uint8Array> {
    const output = (await this.#client.send(new GetObjectCommand({ Bucket: this.#bucket, Key: assertObjectKey(key) }))) as GetObjectOutputLike;
    if (output.Body === undefined) throw new Error('Stored object has no body');
    return await output.Body.transformToByteArray();
  }

  /** Hard delete. S3 answers the same whether or not the object was there. */
  async delete(key: string): Promise<void> {
    await this.#client.send(new DeleteObjectCommand({ Bucket: this.#bucket, Key: assertObjectKey(key) }));
  }

  /** `false` only for "not there": a permission or network failure is not an answer. */
  async exists(key: string): Promise<boolean> {
    const checked = assertObjectKey(key);
    try {
      await this.#client.send(new HeadObjectCommand({ Bucket: this.#bucket, Key: checked }));
      return true;
    } catch (error) {
      if (isNotFound(error)) return false;
      throw error;
    }
  }

  signedUrl(key: string, ttlSeconds: number): Promise<string> {
    return Promise.resolve(this.#urls.sign(key, ttlSeconds));
  }

  /** Used by the file route before reading anything. */
  verifySignedUrl(key: string, expires: number, signature: string): boolean {
    return this.#urls.verify(key, expires, signature);
  }
}

export interface S3ConnectionOptions {
  /** Supabase: `https://<project-ref>.storage.supabase.co/storage/v1/s3`. */
  readonly endpoint: string;
  /** The project's region, e.g. `ap-south-1` for Mumbai. */
  readonly region: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
}

export function createS3Client(options: S3ConnectionOptions): S3Client {
  return new S3Client({
    endpoint: options.endpoint,
    region: options.region,
    // Supabase (like most S3-compatible stores) addresses buckets by path, not subdomain.
    forcePathStyle: true,
    credentials: { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey },
    // Newer SDKs add CRC checksums to every request by default; S3-compatible services
    // do not all accept them, so they are sent only where the protocol requires them.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
}
