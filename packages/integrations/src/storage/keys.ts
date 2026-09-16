import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * What every storage driver agrees on (security-plan.md §3.1; CLAUDE.md §2.8).
 *
 * - **Keys are random** and never derived from a member id or a name.
 * - **A key has one shape**, `prefix/object`, and anything else is refused before any
 *   file or bucket is touched — a crafted key cannot traverse with `../`.
 * - **Reads go through our own signed link** to `/api/v1/files`, whichever driver holds
 *   the bytes, so the link expires in minutes and the bucket is never public.
 */

const KEY_BYTES = 24; // 32 base64url characters

/** `prefix/object`, the prefix possibly nested, the object the random part. */
const OBJECT_KEY = /^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\/[A-Za-z0-9_-]{16,64}$/;

export function sanitisePrefix(prefix: string): string {
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

export function newObjectKey(prefix: string): string {
  return `${sanitisePrefix(prefix)}/${randomBytes(KEY_BYTES).toString('base64url')}`;
}

export function assertObjectKey(key: string): string {
  if (!OBJECT_KEY.test(key)) throw new Error('Invalid storage key');
  return key;
}

/**
 * Short-lived read links, signed with `LINK_TOKEN_SECRET`. security-plan.md §6 caps
 * image TTLs at 5 minutes; the caller passes the TTL.
 */
export class SignedFileUrls {
  readonly #secret: string;
  readonly #basePath: string;
  readonly #now: () => Date;

  constructor(options: { readonly secret: string; readonly basePath?: string; readonly now?: () => Date }) {
    this.#secret = options.secret;
    this.#basePath = options.basePath ?? '/api/v1/files';
    this.#now = options.now ?? (() => new Date());
  }

  sign(key: string, ttlSeconds: number): string {
    const expires = Math.floor(this.#now().getTime() / 1000) + ttlSeconds;
    const params = new URLSearchParams({ key, expires: String(expires), sig: this.#mac(key, expires) });
    return `${this.#basePath}?${params.toString()}`;
  }

  verify(key: string, expires: number, signature: string): boolean {
    if (Math.floor(this.#now().getTime() / 1000) >= expires) return false;
    const a = Buffer.from(this.#mac(key, expires));
    const b = Buffer.from(signature);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  #mac(key: string, expires: number): string {
    return createHmac('sha256', this.#secret).update(`${key}|${expires}`).digest('base64url');
  }
}
