import { createHash, randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import type { PutObjectRequest, StorageDriver, StoredObject } from '@mfp/core/ports';

/**
 * Local filesystem storage (ADR-008, override 6).
 *
 * Selfies and face-related media are the most sensitive data this system holds
 * (security-plan.md §1: "very high"), so the rules are strict:
 *
 * - **Keys are random**, never derived from a member id or name. A key that
 *   encodes who it belongs to is an enumeration attack waiting to happen.
 * - **Nothing is served from the filesystem directly.** Reads go through
 *   `/api/v1/files/[id]`, which checks authorisation and a short-lived signed URL.
 *   There is no static route into `STORAGE_LOCAL_PATH`.
 * - **Every path is checked** to stay inside the root, so a crafted key cannot
 *   traverse out with `../`.
 */

export interface LocalStorageOptions {
  /** `STORAGE_LOCAL_PATH`, e.g. `./storage`. Git-ignored. */
  readonly rootPath: string;
  /** Signs read URLs. Use `LINK_TOKEN_SECRET`. */
  readonly urlSigningSecret: string;
  /** Base path the signed URL points at. */
  readonly publicBasePath?: string;
  /** For deterministic tests. */
  readonly now?: () => Date;
}

const KEY_BYTES = 24; // 32 base64url characters

export class LocalStorageDriver implements StorageDriver {
  readonly name = 'local' as const;
  readonly #root: string;
  readonly #secret: string;
  readonly #basePath: string;
  readonly #now: () => Date;

  constructor(options: LocalStorageOptions) {
    this.#root = resolve(options.rootPath);
    this.#secret = options.urlSigningSecret;
    this.#basePath = options.publicBasePath ?? '/api/v1/files';
    this.#now = options.now ?? (() => new Date());
  }

  async put(request: PutObjectRequest): Promise<StoredObject> {
    const key = `${sanitisePrefix(request.prefix)}/${randomBytes(KEY_BYTES).toString('base64url')}`;
    const path = this.#pathFor(key);

    await mkdir(dirname(path), { recursive: true });
    // `wx` fails rather than overwriting. With 24 random bytes a collision is not
    // going to happen, but silently replacing someone's selfie if it did would be
    // a great deal worse than an error.
    await writeFile(path, request.body, { flag: 'wx' });

    return {
      key,
      sizeBytes: request.body.byteLength,
      sha256: createHash('sha256').update(request.body).digest('hex'),
      mimeType: request.mimeType,
    };
  }

  async get(key: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(this.#pathFor(key)));
  }

  /** Hard delete — the retention jobs in database-design.md §7 rely on the bytes going. */
  async delete(key: string): Promise<void> {
    await rm(this.#pathFor(key), { force: true });
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.#pathFor(key));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * A short-lived signed URL. security-plan.md §6 caps image TTLs at 5 minutes;
   * the caller passes the TTL and the route enforces the ceiling.
   */
  signedUrl(key: string, ttlSeconds: number): Promise<string> {
    const expires = Math.floor(this.#now().getTime() / 1000) + ttlSeconds;
    const signature = signKey(this.#secret, key, expires);
    const params = new URLSearchParams({ key, expires: String(expires), sig: signature });
    return Promise.resolve(`${this.#basePath}?${params.toString()}`);
  }

  /** Verify a signed URL's parameters. Used by the file route before reading anything. */
  verifySignedUrl(key: string, expires: number, signature: string): boolean {
    if (Math.floor(this.#now().getTime() / 1000) >= expires) return false;
    const expected = signKey(this.#secret, key, expires);
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  /** Resolve a key to an absolute path, refusing anything that escapes the root. */
  #pathFor(key: string): string {
    const path = resolve(join(this.#root, key));
    if (path !== this.#root && !path.startsWith(this.#root + sep)) {
      throw new Error('Refusing to access a path outside the storage root');
    }
    return path;
  }
}

function signKey(secret: string, key: string, expires: number): string {
  return createHmac('sha256', secret).update(`${key}|${expires}`).digest('base64url');
}

function sanitisePrefix(prefix: string): string {
  // Check the raw value first: stripping characters before looking for `..` would
  // turn `../etc` into `etc` and let a traversal attempt through silently.
  if (prefix.includes('..')) {
    throw new Error('Invalid storage prefix');
  }
  const cleaned = prefix.replace(/[^a-zA-Z0-9/_-]/g, '').replace(/^\/+|\/+$/g, '');
  if (cleaned.length === 0) {
    throw new Error('Invalid storage prefix');
  }
  return cleaned;
}
