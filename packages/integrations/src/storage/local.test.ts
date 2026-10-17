import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
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

  /**
   * The guard is `#pathFor`, which resolves the joined path and refuses anything that is
   * not under the root.
   *
   * This test used to assert that a Windows-style key — `..\..\windows\system32` —
   * was *refused*, and it failed on every Linux and macOS machine, CI included. The
   * assertion was wrong, not the driver: on POSIX a backslash is an ordinary filename
   * character, so that string is a single path segment sitting inside the root and there
   * is nothing to refuse. It only ever passed on Windows.
   *
   * What matters is the property, which holds on both: a key may not reach outside the
   * root, and a key that merely *looks* like traversal on another platform is treated as
   * the harmless filename it actually is. Both halves are asserted, per platform, so this
   * cannot quietly start passing for the wrong reason again.
   */
  it('refuses a key that escapes the storage root, on every method', async () => {
    for (const escape of ['../../../etc/passwd', 'selfies/../../escape', '../']) {
      await expect(driver.get(escape), escape).rejects.toThrow(/outside the storage root/);
      await expect(driver.delete(escape), escape).rejects.toThrow(/outside the storage root/);
      await expect(driver.exists(escape), escape).rejects.toThrow(/outside the storage root/);
      await expect(driver.signedUrl(escape, 60), escape).rejects.toThrow(/outside the storage root/);
    }
  });

  it('treats a backslash key as a filename, because on POSIX that is what it is', async () => {
    const key = '..\\..\\windows\\system32\\config';

    if (sep === '\\') {
      // On Windows the same string really is traversal, and must be refused.
      await expect(driver.delete(key)).rejects.toThrow(/outside the storage root/);
      return;
    }

    // On POSIX it is one legal filename directly inside the root: no escape happens, so
    // deleting a file that is not there is the correct no-op, and reading it is a plain
    // missing-file error rather than a refusal.
    await expect(driver.delete(key)).resolves.toBeUndefined();
    expect(await driver.exists(key)).toBe(false);
    await expect(driver.get(key)).rejects.toThrow(/ENOENT/);
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
