import { createHash } from 'node:crypto';
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { beforeEach, describe, expect, it } from 'vitest';
import { S3StorageDriver, type S3Sender } from './s3';

/**
 * Object storage in a Supabase Storage bucket through its S3-compatible endpoint (ADR-055).
 *
 * The bucket is private. The driver keeps every rule the local driver keeps — random
 * keys, a content hash, hard deletes, and reads only through our own short-lived signed
 * URL — so switching drivers changes where the bytes live and nothing else. The S3
 * client is replaced here by an in-memory one; `s3.live.test.ts` talks to the real bucket.
 */

const SECRET = 's'.repeat(48);
const BUCKET = 'member-media';
const NOW = new Date('2026-09-16T10:00:00Z');

const notFound = (name: string) => Object.assign(new Error(name), { name, $metadata: { httpStatusCode: 404 } });

class FakeS3 implements S3Sender {
  readonly objects = new Map<string, { body: Uint8Array; contentType: string | undefined }>();
  readonly sent: unknown[] = [];
  failure: Error | null = null;

  send(command: unknown): Promise<unknown> {
    this.sent.push(command);
    if (this.failure !== null) return Promise.reject(this.failure);

    if (command instanceof PutObjectCommand) {
      const { Bucket, Key, Body, ContentType } = command.input;
      this.objects.set(`${Bucket}/${Key}`, { body: Body as Uint8Array, contentType: ContentType });
      return Promise.resolve({});
    }
    if (command instanceof GetObjectCommand) {
      const found = this.objects.get(`${command.input.Bucket}/${command.input.Key}`);
      if (found === undefined) return Promise.reject(notFound('NoSuchKey'));
      return Promise.resolve({ Body: { transformToByteArray: () => Promise.resolve(found.body) } });
    }
    if (command instanceof HeadObjectCommand) {
      return this.objects.has(`${command.input.Bucket}/${command.input.Key}`) ? Promise.resolve({}) : Promise.reject(notFound('NotFound'));
    }
    if (command instanceof DeleteObjectCommand) {
      this.objects.delete(`${command.input.Bucket}/${command.input.Key}`);
      return Promise.resolve({});
    }
    return Promise.reject(new Error('unexpected command'));
  }
}

describe('S3StorageDriver', () => {
  let s3: FakeS3;
  let driver: S3StorageDriver;
  const body = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);

  beforeEach(() => {
    s3 = new FakeS3();
    driver = new S3StorageDriver({ client: s3, bucket: BUCKET, urlSigningSecret: SECRET, now: () => NOW });
  });

  it('writes to the private bucket under a random key in the prefix, with its type and hash', async () => {
    const first = await driver.put({ body, mimeType: 'image/jpeg', prefix: 'selfies' });
    const second = await driver.put({ body, mimeType: 'image/jpeg', prefix: 'selfies' });

    expect(driver.name).toBe('s3');
    expect(first.key).toMatch(/^selfies\/[A-Za-z0-9_-]{32}$/);
    expect(second.key).not.toBe(first.key);
    expect(first).toMatchObject({ sizeBytes: 4, mimeType: 'image/jpeg', sha256: createHash('sha256').update(body).digest('hex') });
    expect(s3.objects.get(`${BUCKET}/${first.key}`)).toEqual({ body, contentType: 'image/jpeg' });
  });

  it('reads back what it wrote, and refuses a key that is not there', async () => {
    const { key } = await driver.put({ body, mimeType: 'image/jpeg', prefix: 'receipts' });

    expect(await driver.get(key)).toEqual(body);
    await expect(driver.get('receipts/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')).rejects.toThrow();
  });

  it('says whether an object exists, but does not hide a real failure as "missing"', async () => {
    const { key } = await driver.put({ body, mimeType: 'image/jpeg', prefix: 'selfies' });

    expect(await driver.exists(key)).toBe(true);
    expect(await driver.exists('selfies/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')).toBe(false);

    s3.failure = Object.assign(new Error('AccessDenied'), { name: 'AccessDenied', $metadata: { httpStatusCode: 403 } });
    await expect(driver.exists(key)).rejects.toThrow('AccessDenied');
  });

  it('deletes for good, and deleting twice is not an error', async () => {
    const { key } = await driver.put({ body, mimeType: 'image/jpeg', prefix: 'selfies' });

    await driver.delete(key);
    await driver.delete(key);

    expect(await driver.exists(key)).toBe(false);
  });

  it('refuses a traversing prefix or a malformed key before asking the bucket anything', async () => {
    await expect(driver.put({ body, mimeType: 'image/jpeg', prefix: '../other' })).rejects.toThrow();
    await expect(driver.get('../../secret')).rejects.toThrow();
    await expect(driver.delete('selfies/../receipts/x')).rejects.toThrow();
    await expect(driver.exists('')).rejects.toThrow();

    expect(s3.sent).toHaveLength(0);
  });

  it('hands out our own short-lived signed link, never a bucket URL', async () => {
    const { key } = await driver.put({ body, mimeType: 'image/jpeg', prefix: 'selfies' });

    const url = new URL(await driver.signedUrl(key, 300), 'https://gym.example');
    expect(url.pathname).toBe('/api/v1/files');
    expect(url.searchParams.get('key')).toBe(key);

    const expires = Number(url.searchParams.get('expires'));
    const sig = url.searchParams.get('sig') ?? '';
    expect(expires).toBe(NOW.getTime() / 1000 + 300);
    expect(driver.verifySignedUrl(key, expires, sig)).toBe(true);
    expect(driver.verifySignedUrl(key, expires, `${sig.slice(0, -1)}x`)).toBe(false);
    expect(driver.verifySignedUrl('selfies/other', expires, sig)).toBe(false);

    const later = new S3StorageDriver({ client: s3, bucket: BUCKET, urlSigningSecret: SECRET, now: () => new Date(NOW.getTime() + 301_000) });
    expect(later.verifySignedUrl(key, expires, sig)).toBe(false);
  });
});
