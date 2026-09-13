/**
 * Private object storage for selfies, enrolment frames and receipt PDFs.
 *
 * CLAUDE.md §2.8: these are private objects served only through short-lived signed
 * URLs. There is no public bucket and no predictable key — a key is random, so a
 * leaked URL expires and a guessed one does not exist.
 */

export interface StoredObject {
  /** Random, unguessable key. Never derived from a member id or a name. */
  readonly key: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly mimeType: string;
}

export interface PutObjectRequest {
  readonly body: Uint8Array;
  readonly mimeType: string;
  /** Groups objects for retention sweeps, e.g. `selfies` or `receipts`. */
  readonly prefix: string;
}

export interface StorageDriver {
  readonly name: 'local' | 's3';
  put(request: PutObjectRequest): Promise<StoredObject>;
  get(key: string): Promise<Uint8Array>;
  /** Hard delete. Retention jobs rely on this actually removing the bytes. */
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  /** Short-lived read URL. TTL is capped at 5 minutes for images (security-plan.md §6). */
  signedUrl(key: string, ttlSeconds: number): Promise<string>;
}
