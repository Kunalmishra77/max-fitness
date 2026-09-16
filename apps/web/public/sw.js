/*
 * Max Register's service worker (crm-ux-blueprint §18; Phase 4 prompt item 15).
 *
 * It caches the app shell — the versioned build files, the icons and one offline page —
 * and nothing else. CRM pages and API responses carry members' names, numbers and fee
 * states, and a gym's phone gets handed around, so none of that is ever written to a
 * cache (privacy-and-dpdp-compliance §4). Offline, the owner sees a page that says so in
 * Hindi rather than the browser's dinosaur.
 *
 * Plain JavaScript with no build step, so `apps/web/src/lib/service-worker.test.ts` runs
 * this very file.
 */

const VERSION = 'max-register-v1';

/** Fetched on install, so the offline page is there the first time the network is not. */
const SHELL = ['/crm/offline', '/icons/max-192.png', '/icons/max-512.png', '/crm/manifest.webmanifest'];

/** Versioned or brand-owned files: no member data, safe to keep. */
function isShellAsset(pathname) {
  return (
    pathname.startsWith('/_next/static/') ||
    pathname.startsWith('/icons/') ||
    pathname.startsWith('/fonts/') ||
    pathname === '/crm/manifest.webmanifest'
  );
}

async function cacheFirst(request) {
  const cache = await caches.open(VERSION);
  const hit = await cache.match(request);
  if (hit) return hit;

  const response = await fetch(request);
  if (response && response.ok) cache.put(request, response.clone());
  return response;
}

async function networkThenOfflinePage(request) {
  try {
    return await fetch(request);
  } catch {
    const cache = await caches.open(VERSION);
    const offline = await cache.match('/crm/offline');
    // Without the offline page there is nothing useful to show; say so plainly.
    return offline ?? new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  // A POST is a payment, a save or a sign-in: never ours to answer.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // The API answers with member data and must not even be intercepted.
  if (url.pathname.startsWith('/api/')) return;

  if (isShellAsset(url.pathname)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // A page: always from the network, and the offline page only when that fails. The
  // page itself is never cached, because it holds the members it just listed.
  if (request.mode === 'navigate') {
    event.respondWith(networkThenOfflinePage(request));
  }
});
