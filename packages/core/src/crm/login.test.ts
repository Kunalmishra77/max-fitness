import { describe, expect, it, vi } from 'vitest';
import { fakeClockAt } from '../testing/builders';
import {
  LOGIN_LOCKOUT_MINUTES,
  LOGIN_MAX_ATTEMPTS,
  SESSION_IDLE_HOURS,
  SESSION_TRUSTED_DAYS,
  elevationExpiry,
  login,
  sessionTokenHash,
  type LoginStore,
  type StaffForLogin,
} from './login';

const staff: StaffForLogin = {
  id: 'staff_1',
  gymId: 'gym_1',
  name: 'Demo Owner',
  role: 'OWNER',
  language: 'hi',
  pinHash: '$argon2id$fake',
  isActive: true,
  failedPinCount: 0,
  lockedUntil: null,
};

function fakeStore(overrides: Partial<StaffForLogin> | null = {}) {
  const calls = { failed: [] as Array<{ count: number; lockedUntil: Date | null }>, cleared: [] as Date[], sessions: [] as Array<Record<string, unknown>> };
  const store: LoginStore = {
    findStaffByMobile: () => Promise.resolve(overrides === null ? null : { ...staff, ...overrides }),
    recordFailedPin: (_id, count, lockedUntil) => (calls.failed.push({ count, lockedUntil }), Promise.resolve()),
    clearFailedPins: (_id, at) => (calls.cleared.push(at), Promise.resolve()),
    createSession: (record) => (calls.sessions.push({ ...record }), Promise.resolve()),
  };
  return { store, calls };
}

const clock = fakeClockAt('2026-09-12T10:00');
const deps = (store: LoginStore, verify: (hash: string, pin: string) => Promise<boolean>) => ({
  store,
  hasher: { verify },
  clock,
  gymId: 'gym_1',
});

const input = { mobile: '9000000001', pin: '2468', ipHash: 'iphash', userAgent: 'phone', trusted: false };

describe('login', () => {
  it('checks the PIN against the stored hash and opens a session', async () => {
    const { store, calls } = fakeStore();
    const verify = vi.fn(() => Promise.resolve(true));

    const result = await login(input, deps(store, verify));

    expect(verify).toHaveBeenCalledWith('$argon2id$fake', '2468');
    expect(result.actor).toEqual({
      staffUserId: 'staff_1',
      gymId: 'gym_1',
      role: 'OWNER',
      name: 'Demo Owner',
      language: 'hi',
      // Signing in counts as entering the PIN, for the next few minutes.
      elevatedUntil: elevationExpiry(clock.now()),
      receptionMayTakePayments: true,
    });
    // The token goes to the browser; only its hash is stored.
    expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(calls.sessions).toEqual([
      {
        staffUserId: 'staff_1',
        tokenHash: sessionTokenHash(result.token),
        expiresAt: new Date(clock.now().getTime() + SESSION_IDLE_HOURS * 3_600_000),
        ipHash: 'iphash',
        userAgent: 'phone',
        trusted: false,
      },
    ]);
    expect(calls.cleared).toEqual([clock.now()]);
  });

  it('keeps a trusted device signed in for longer', async () => {
    const { store, calls } = fakeStore();
    await login({ ...input, trusted: true }, deps(store, () => Promise.resolve(true)));
    expect(calls.sessions[0]?.['expiresAt']).toEqual(new Date(clock.now().getTime() + SESSION_TRUSTED_DAYS * 86_400_000));
  });

  it('counts a wrong PIN and says how many attempts are left', async () => {
    const { store, calls } = fakeStore({ failedPinCount: 1 });

    const error = await login(input, deps(store, () => Promise.resolve(false))).catch((e: unknown) => e);

    expect(error).toMatchObject({ code: 'INVALID_PIN', meta: { attemptsLeft: LOGIN_MAX_ATTEMPTS - 2 } });
    expect(calls.failed).toEqual([{ count: 2, lockedUntil: null }]);
    expect(calls.sessions).toEqual([]);
  });

  it('locks the account on the last attempt', async () => {
    const { store, calls } = fakeStore({ failedPinCount: LOGIN_MAX_ATTEMPTS - 1 });

    const error = await login(input, deps(store, () => Promise.resolve(false))).catch((e: unknown) => e);

    expect(error).toMatchObject({ code: 'ACCOUNT_LOCKED' });
    expect(calls.failed).toEqual([
      { count: LOGIN_MAX_ATTEMPTS, lockedUntil: new Date(clock.now().getTime() + LOGIN_LOCKOUT_MINUTES * 60_000) },
    ]);
  });

  it('refuses while locked, without checking the PIN', async () => {
    const { store } = fakeStore({ lockedUntil: new Date('2026-09-12T05:00:00Z') });
    const verify = vi.fn(() => Promise.resolve(true));

    const error = await login(input, deps(store, verify)).catch((e: unknown) => e);

    expect(error).toMatchObject({ code: 'ACCOUNT_LOCKED' });
    expect(verify).not.toHaveBeenCalled();
  });

  it('lets someone in again once the lockout has passed', async () => {
    const { store } = fakeStore({ lockedUntil: new Date('2026-09-12T04:00:00Z'), failedPinCount: 5 });
    await expect(login(input, deps(store, () => Promise.resolve(true)))).resolves.toMatchObject({ actor: { role: 'OWNER' } });
  });

  it('gives the same answer for an unknown mobile as for a wrong PIN', async () => {
    const { store } = fakeStore(null);
    const error = await login(input, deps(store, () => Promise.resolve(true))).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'INVALID_PIN' });
  });

  it('refuses a staff member who no longer works here', async () => {
    const { store } = fakeStore({ isActive: false });
    const error = await login(input, deps(store, () => Promise.resolve(true))).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'INVALID_PIN' });
  });

  it('rejects anything that is not a 4–6 digit PIN or an Indian mobile before touching the database', async () => {
    const { store } = fakeStore();
    const find = vi.spyOn(store, 'findStaffByMobile');
    await expect(login({ ...input, pin: '12' }, deps(store, () => Promise.resolve(true)))).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(login({ ...input, mobile: '12345' }, deps(store, () => Promise.resolve(true)))).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(find).not.toHaveBeenCalled();
  });
});
