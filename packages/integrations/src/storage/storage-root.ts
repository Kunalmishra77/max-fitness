import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

/**
 * Where `STORAGE_LOCAL_PATH` points on disk.
 *
 * The web app runs with `apps/web` as its working directory and the worker with
 * `apps/worker`, so a relative `./storage` would name two different folders — a receipt
 * PDF the worker stores would be invisible to the web app. A relative path is therefore
 * taken from the workspace root (the folder holding `pnpm-workspace.yaml`); an absolute
 * path, as production uses, is left alone.
 */
export function resolveStorageRoot(configured: string, cwd: string = process.cwd()): string {
  if (isAbsolute(configured)) return configured;

  let dir = resolve(cwd);
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return resolve(dir, configured);
    const parent = dirname(dir);
    if (parent === dir) return resolve(cwd, configured);
    dir = parent;
  }
}
