import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalStorageDriver } from './local';

const SECRET = 'l'.repeat(48);

describe('LocalStorageDriver', () => {
  let root: string;
  let driver: LocalStorageDriver;
  let now: Date;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'mfp-storage-'));
    now = new Date('2026-09-10T10:00:00Z');
    driver = new LocalStorageDriver({ rootPath: root, urlSigningSecret: SECRET, now: () => now });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const body = () => new TextEncoder().encode('a pretend jpeg');

  it('stores an object and reports its size and hash', async () => {
    const stored = await driver.put({ body: body(), mimeType: 'image/jpeg', prefix: 'selfies' });

    expect(stored.sizeBytes).toBe(body().byteLength);
    expect(stored.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.mimeType).toBe('image/jpeg');
    expect(await driver.exists(stored.key)).toBe(true);
  });

  it('round-trips the bytes exactly', async () => {
    const stored = await driver.put({ body: body(), mimeType: 'image/jpeg', prefix: 'selfies' });
    expect(new TextDecoder().decode(await driver.get(stored.key))).toBe('a pretend jpeg');
  });

  it('generates random keys — never derived from the member', async () => {
    const a = await driver.put({ body: body(), mimeType: 'image/jpeg', prefix: 'selfies' });
    const b = await driver.put({ body: body(), mimeType: 'image/jpeg', prefix: 'selfies' });

    expect(a.key).not.toBe(b.key);
    expect(a.key.startsWith('selfies/')).toBe(true);
    // 24 random bytes as base64url.
    expect(a.key.slice('selfies/'.length)).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });

  it('hard-deletes, because the retention jobs depend on the bytes going', async () => {
    const stored = await driver.put({ body: body(), mimeType: 'image/jpeg', prefix: 'selfies' });
    await driver.delete(stored.key);

    expect(await driver.exists(stored.key)).toBe(false);
    await expect(driver.get(stored.key)).rejects.toThrow();
  });

  it('is idempotent on delete', async () => {
    await expect(driver.delete('selfies/not-there')).resolves.toBeUndefined();
  });

  it('reports a missing object rather than throwing from exists()', async () => {
    expect(await driver.exists('selfies/nope')).toBe(false);
  });

  it('refuses a key that tries to escape the storage root', async () => {
    await expect(driver.get('../../../etc/passwd')).rejects.toThrow(/outside the storage root/);
    await expect(driver.delete('..\\..\\windows\\system32\\config')).rejects.toThrow(
      /outside the storage root/,
    );
  });

  it('refuses a prefix containing traversal or nothing usable', async () => {
    await expect(driver.put({ body: body(), mimeType: 'image/jpeg', prefix: '../etc' })).rejects.toThrow(
      /Invalid storage prefix/,
    );
    await expect(driver.put({ body: body(), mimeType: 'image/jpeg', prefix: '!!!' })).rejects.toThrow(
      /Invalid storage prefix/,
    );
  });

  it('never writes outside the root directory', async () => {
    const stored = await driver.put({ body: body(), mimeType: 'image/jpeg', prefix: 'selfies' });
    const onDisk = await readFile(join(root, stored.key));
    expect(onDisk.byteLength).toBe(body().byteLength);
  });
});

describe('signed URLs', () => {
  let root: string;
  let driver: LocalStorageDriver;
  let now: Date;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'mfp-storage-'));
    now = new Date('2026-09-10T10:00:00Z');
    driver = new LocalStorageDriver({ rootPath: root, urlSigningSecret: SECRET, now: () => now });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('points at the authorising API route, never at the filesystem', async () => {
    const url = await driver.signedUrl('selfies/abc', 300);
    expect(url.startsWith('/api/v1/files?')).toBe(true);
    expect(url).not.toContain(root);
  });

  it('carries the key, an expiry and a signature', async () => {
    const url = await driver.signedUrl('selfies/abc', 300);
    const params = new URLSearchParams(url.split('?')[1]);

    expect(params.get('key')).toBe('selfies/abc');
    expect(Number(params.get('expires'))).toBe(Math.floor(now.getTime() / 1000) + 300);
    expect(params.get('sig')).toBeTruthy();
  });

  it('verifies its own signature', async () => {
    const url = await driver.signedUrl('selfies/abc', 300);
    const params = new URLSearchParams(url.split('?')[1]);

    expect(
      driver.verifySignedUrl('selfies/abc', Number(params.get('expires')), params.get('sig') as string),
    ).toBe(true);
  });

  it('rejects a signature lifted onto a different key', async () => {
    const url = await driver.signedUrl('selfies/abc', 300);
    const params = new URLSearchParams(url.split('?')[1]);

    expect(
      driver.verifySignedUrl('selfies/someone-else', Number(params.get('expires')), params.get('sig') as string),
    ).toBe(false);
  });

  it('rejects an extended expiry', async () => {
    const url = await driver.signedUrl('selfies/abc', 300);
    const params = new URLSearchParams(url.split('?')[1]);

    expect(driver.verifySignedUrl('selfies/abc', 99_999_999_999, params.get('sig') as string)).toBe(false);
  });

  it('rejects a tampered signature, whatever its length', () => {
    expect(driver.verifySignedUrl('selfies/abc', Math.floor(now.getTime() / 1000) + 300, 'nope')).toBe(false);
    expect(driver.verifySignedUrl('selfies/abc', Math.floor(now.getTime() / 1000) + 300, '')).toBe(false);
  });

  it('expires — a leaked URL stops working', async () => {
    const url = await driver.signedUrl('selfies/abc', 300);
    const params = new URLSearchParams(url.split('?')[1]);
    const expires = Number(params.get('expires'));
    const sig = params.get('sig') as string;

    now = new Date(now.getTime() + 299_000);
    expect(driver.verifySignedUrl('selfies/abc', expires, sig)).toBe(true);

    now = new Date(now.getTime() + 2_000);
    expect(driver.verifySignedUrl('selfies/abc', expires, sig)).toBe(false);
  });

  it('honours a custom public base path', async () => {
    const custom = new LocalStorageDriver({
      rootPath: root,
      urlSigningSecret: SECRET,
      publicBasePath: '/files',
      now: () => now,
    });
    expect((await custom.signedUrl('k', 60)).startsWith('/files?')).toBe(true);
  });
});

describe('storage root isolation', () => {
  it('cannot read a file placed just outside the root', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'mfp-outside-'));
    const root = join(parent, 'storage');
    await mkdir(root, { recursive: true });
    await writeFile(join(parent, 'secret.txt'), 'do not read me');

    const driver = new LocalStorageDriver({ rootPath: root, urlSigningSecret: SECRET });
    await expect(driver.get('../secret.txt')).rejects.toThrow(/outside the storage root/);

    await rm(parent, { recursive: true, force: true });
  });
});
