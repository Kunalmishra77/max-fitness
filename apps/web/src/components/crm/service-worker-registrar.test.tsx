import { render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ServiceWorkerRegistrar } from './service-worker-registrar';

/**
 * Registering the worker (crm-ux-blueprint §18).
 *
 * The CRM only: the scope keeps it off the public website, where a cached shell would be
 * no help. A browser without service workers — or a private window that refuses them —
 * must still get a working CRM, and must not see an error.
 */

const original = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');

afterEach(() => {
  if (original === undefined) Reflect.deleteProperty(navigator, 'serviceWorker');
  else Object.defineProperty(navigator, 'serviceWorker', original);
  vi.restoreAllMocks();
});

function withServiceWorker(register: ReturnType<typeof vi.fn>) {
  Object.defineProperty(navigator, 'serviceWorker', { value: { register }, configurable: true });
}

describe('ServiceWorkerRegistrar', () => {
  it('registers the worker for the CRM only', async () => {
    const register = vi.fn().mockResolvedValue({});
    withServiceWorker(register);

    render(<ServiceWorkerRegistrar />);

    await waitFor(() => expect(register).toHaveBeenCalledWith('/sw.js', { scope: '/crm/' }));
  });

  it('renders nothing, and says nothing, where service workers are unavailable', () => {
    Reflect.deleteProperty(navigator, 'serviceWorker');
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const { container } = render(<ServiceWorkerRegistrar />);

    expect(container.childNodes).toHaveLength(0);
    expect(errors).not.toHaveBeenCalled();
  });

  it('carries on when the browser refuses to register it', async () => {
    const register = vi.fn().mockRejectedValue(new Error('denied'));
    withServiceWorker(register);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    render(<ServiceWorkerRegistrar />);

    await waitFor(() => expect(register).toHaveBeenCalled());
    // A refusal is normal (a private window, storage switched off), not an app error.
    expect(errors).not.toHaveBeenCalled();
  });
});
