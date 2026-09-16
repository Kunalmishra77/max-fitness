'use client';

import { useEffect } from 'react';

/**
 * Registers the CRM's service worker (crm-ux-blueprint §18).
 *
 * Scoped to `/crm/`, so the public website is never taken over by it. Registration is
 * allowed to fail — a private window, storage switched off, an old browser — and when it
 * does the CRM simply works the way it always has, online. Nothing is logged for that:
 * it is not a fault, and the console at the desk should stay quiet.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    void navigator.serviceWorker.register('/sw.js', { scope: '/crm/' }).catch(() => undefined);
  }, []);

  return null;
}
