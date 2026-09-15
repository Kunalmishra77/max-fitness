import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveStorageRoot } from './storage-root';

function workspace(): { root: string; web: string; worker: string } {
  const root = mkdtempSync(join(tmpdir(), 'mfp-storage-'));
  writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages: []\n');
  const web = join(root, 'apps', 'web');
  const worker = join(root, 'apps', 'worker');
  mkdirSync(web, { recursive: true });
  mkdirSync(worker, { recursive: true });
  return { root, web, worker };
}

describe('resolveStorageRoot', () => {
  it('gives the web app and the worker the same folder for a relative path', () => {
    const { root, web, worker } = workspace();
    expect(resolveStorageRoot('./storage', web)).toBe(join(root, 'storage'));
    expect(resolveStorageRoot('./storage', worker)).toBe(join(root, 'storage'));
  });

  it('keeps an absolute path as it is', () => {
    const absolute = resolve(tmpdir(), 'mfp-data', 'storage');
    expect(resolveStorageRoot(absolute, workspace().web)).toBe(absolute);
  });

  it('falls back to the working directory outside a workspace', () => {
    const lonely = mkdtempSync(join(tmpdir(), 'mfp-lonely-'));
    expect(resolveStorageRoot('./storage', lonely)).toBe(join(lonely, 'storage'));
  });
});
