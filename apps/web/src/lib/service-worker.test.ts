import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The service worker that ships (crm-ux-blueprint §18; Phase 4 prompt item 15).
 *
 * `public/sw.js` is a plain file with no build step, so these tests run the real file
 * rather than a copy of its logic: they evaluate it with a fake `self` and then fire the
 * events a browser would.
 *
 * What is **not** cached matters most here. Members' names, numbers and fee states come
 * back in CRM pages and in API responses, and none of that may be left in a cache on a
 * phone that gets handed around a gym (privacy-and-dpdp-compliance §4).
 */

// These tests run in a browser-like environment, where `import.meta.url` is an http URL
// and cannot locate a file. Vitest may be started from the repository root or from
// apps/web, so both are tried.
const swPath = [resolve(process.cwd(), 'public/sw.js'), resolve(process.cwd(), 'apps/web/public/sw.js')].find((candidate) =>
  existsSync(candidate),
);
if (swPath === undefined) throw new Error('public/sw.js not found from ' + process.cwd());
const source = readFileSync(swPath, 'utf8');

function load(options: { cached?: unknown; fetch?: ReturnType<typeof vi.fn> } = {}) {
  const listeners = new Map<string, (event: unknown) => unknown>();
  const cache = {
    addAll: vi.fn().mockResolvedValue(undefined),
    put: vi.fn().mockResolvedValue(undefined),
    match: vi.fn().mockResolvedValue(options.cached),
  };
  const caches = {
    open: vi.fn().mockResolvedValue(cache),
    keys: vi.fn().mockResolvedValue(['max-register-old', 'unrelated']),
    delete: vi.fn().mockResolvedValue(true),
    match: vi.fn().mockResolvedValue(options.cached),
  };
  const fetchMock = options.fetch ?? vi.fn().mockResolvedValue({ ok: true, status: 200, clone: () => ({ body: 'copy' }) });
  const self = {
    addEventListener: (type: string, handler: (event: unknown) => unknown) => listeners.set(type, handler),
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn() },
    caches,
    fetch: fetchMock,
    location: { origin: 'http://localhost:3000' },
  };
  // The worker is a plain script, not a module: run it with its globals handed in.
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, @typescript-eslint/no-unsafe-call
  new Function('self', 'caches', 'fetch', source)(self, caches, fetchMock);
  return { self, listeners, cache, caches, fetch: fetchMock };
}

const request = (url: string, extra: { method?: string; mode?: string } = {}) => ({
  url: `http://localhost:3000${url}`,
  method: extra.method ?? 'GET',
  mode: extra.mode ?? 'cors',
});

/** Fires a fetch event and returns what the worker answered with, or `undefined`. */
async function fetchEvent(loaded: ReturnType<typeof load>, req: ReturnType<typeof request>) {
  let responded: unknown;
  loaded.listeners.get('fetch')?.({
    request: req,
    respondWith: (value: unknown) => {
      responded = value;
    },
    waitUntil: (value: unknown) => value,
  });
  return responded === undefined ? undefined : await Promise.resolve(responded);
}

describe('the CRM service worker', () => {
  let loaded: ReturnType<typeof load>;
  beforeEach(() => {
    loaded = load();
  });

  it('keeps a shell to show when the phone is offline', async () => {
    const waited: unknown[] = [];
    loaded.listeners.get('install')?.({ waitUntil: (value: unknown) => waited.push(value) });
    await Promise.all(waited);

    expect(loaded.caches.open).toHaveBeenCalled();
    const precached = loaded.cache.addAll.mock.calls[0]?.[0] as string[];
    expect(precached).toContain('/crm/offline');
    expect(precached.some((url) => url.startsWith('/icons/'))).toBe(true);
  });

  it('never answers an API call from the cache', async () => {
    expect(await fetchEvent(loaded, request('/api/v1/health'))).toBeUndefined();
    expect(await fetchEvent(loaded, request('/api/v1/crm/members'))).toBeUndefined();
    expect(loaded.cache.put).not.toHaveBeenCalled();
  });

  it('never stores a CRM page, because it carries names and numbers', async () => {
    const response = await fetchEvent(loaded, request('/crm/members', { mode: 'navigate' }));
    expect(response).toMatchObject({ ok: true });
    expect(loaded.cache.put).not.toHaveBeenCalled();
  });

  it('shows the offline page when a CRM page cannot be fetched', async () => {
    const offline = { ok: true, status: 200, offlinePage: true };
    const failing = load({ cached: offline, fetch: vi.fn().mockRejectedValue(new Error('offline')) });
    expect(await fetchEvent(failing, request('/crm', { mode: 'navigate' }))).toBe(offline);
  });

  it('caches the app shell, which is versioned and holds no data', async () => {
    const response = await fetchEvent(loaded, request('/_next/static/chunks/main.js'));
    expect(response).toMatchObject({ ok: true });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(loaded.cache.put).toHaveBeenCalled();

    const fromCache = load({ cached: { ok: true, fromCache: true } });
    expect(await fetchEvent(fromCache, request('/icons/max-192.png'))).toMatchObject({ fromCache: true });
    expect(fromCache.fetch).not.toHaveBeenCalled();
  });

  it('leaves anything that is not a plain GET to the network', async () => {
    expect(await fetchEvent(loaded, request('/crm/members', { method: 'POST', mode: 'navigate' }))).toBeUndefined();
    expect(await fetchEvent(loaded, request('/crm/settings', { method: 'POST' }))).toBeUndefined();
  });

  it('throws away caches from an older version on activate', async () => {
    const waited: unknown[] = [];
    loaded.listeners.get('activate')?.({ waitUntil: (value: unknown) => waited.push(value) });
    await Promise.all(waited);

    expect(loaded.caches.delete).toHaveBeenCalledWith('max-register-old');
    expect(loaded.caches.delete).toHaveBeenCalledWith('unrelated');
    expect(loaded.self.clients.claim).toHaveBeenCalled();
  });
});
