/**
 * Settings for a script, wherever it is being run from.
 *
 * On a laptop they come from the repository's `.env`. Inside the worker container there
 * is no such file — Coolify puts the settings in the environment itself — and a script
 * that insists on reading one crashes on the line before it does anything useful.
 *
 * That is exactly what `wipe:members` did on 2026-10-15: it could only ever be run from
 * a laptop, which is the machine furthest from the bucket it has to delete photographs
 * out of, and the deletion it half-finished left thirteen of them behind.
 *
 * Anything already in the environment wins. A container's settings are the real ones.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function loadScriptEnv(): void {
  const path = fileURLToPath(new URL('../../../.env', import.meta.url));
  if (existsSync(path)) process.loadEnvFile(path);
}
