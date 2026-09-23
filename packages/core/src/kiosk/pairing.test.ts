import { describe, expect, it } from 'vitest';
import { FakeClock } from '@mfp/shared';
import {
  hashDeviceToken,
  hashPairingCode,
  issuePairingCode,
  pairKioskDevice,
  PAIRING_CODE_TTL_MINUTES,
  type PairingDeviceRow,
  type PairingStore,
} from './pairing';

/**
 * Pairing a reception phone to the gym (api-specification §7; security-plan §3.4).
 *
 * The code is short enough for someone to read off a screen and type on a phone, so
 * everything else has to be tight: it lives ten minutes, is stored hashed, and is
 * spent the moment it works. The token that replaces it is shown once and never
 * stored in a form the database can give back.
 */

const NOW = new Date('2026-09-24T05:00:00Z');
const PEPPER = 'a'.repeat(32);

/** The row as the database would hold it: mutable, because pairing writes to it. */
interface StoredDevice {
  id: string;
  gymId: string;
  pairingCodeHash: string | null;
  pairingExpires: Date | null;
  status: 'ACTIVE' | 'REVOKED';
  name: string;
  tokenHash: string | null;
  appVersion: string | null;
  modelVersion: string | null;
}

function store(seed: { device?: PairingDeviceRow } = {}) {
  const devices: StoredDevice[] =
    seed.device === undefined ? [] : [{ ...seed.device, name: 'Reception phone', tokenHash: null, appVersion: null, modelVersion: null }];
  const impl: PairingStore = {
    findByPairingCodeHash: (hash) => Promise.resolve(devices.find((device) => device.pairingCodeHash === hash) ?? null),
    completePairing: (deviceId, fields) => {
      const device = devices.find((row) => row.id === deviceId);
      if (device === undefined) return Promise.resolve(false);
      device.tokenHash = fields.tokenHash;
      device.pairingCodeHash = null;
      device.pairingExpires = null;
      device.appVersion = fields.appVersion;
      device.modelVersion = fields.modelVersion;
      return Promise.resolve(true);
    },
  };
  return { devices, impl };
}

const active = {
  id: 'kiosk_1',
  gymId: 'gym_1',
  pairingCodeHash: hashPairingCode('482913', PEPPER),
  pairingExpires: new Date('2026-09-24T05:05:00Z'),
  status: 'ACTIVE' as const,
};

describe('issuePairingCode', () => {
  it('is six digits, and expires ten minutes from now', () => {
    const clock = new FakeClock(NOW);
    const issued = issuePairingCode({ clock, random: () => Buffer.from([0x12, 0x34, 0x56, 0x78]) });

    expect(issued.code).toMatch(/^\d{6}$/);
    expect(issued.expiresAt.getTime() - NOW.getTime()).toBe(PAIRING_CODE_TTL_MINUTES * 60_000);
  });

  it('uses the whole range, including codes with leading zeros', () => {
    const clock = new FakeClock(NOW);
    const zeros = issuePairingCode({ clock, random: () => Buffer.from([0, 0, 0, 0]) });

    expect(zeros.code).toBe('000000');
    expect(zeros.code).toHaveLength(6);
  });

  it('hashes the code with the pepper, so a stolen database row cannot be typed in', () => {
    const hash = hashPairingCode('482913', PEPPER);

    expect(hash).not.toContain('482913');
    expect(hash).toBe(hashPairingCode('482913', PEPPER));
    expect(hash).not.toBe(hashPairingCode('482913', 'b'.repeat(32)));
  });
});

describe('pairKioskDevice', () => {
  const pair = (s: ReturnType<typeof store>, over: { code?: string; now?: Date } = {}) =>
    pairKioskDevice(
      { code: over.code ?? '482913', deviceName: 'Reception phone', appVersion: '1.0.0', modelVersion: 'fe-v1' },
      { clock: new FakeClock(over.now ?? NOW), pepper: PEPPER, random: () => Buffer.alloc(32, 7), store: s.impl },
    );

  it('trades a live code for a token, and spends the code', async () => {
    const s = store({ device: { ...active } });

    const result = await pair(s);

    expect(result.outcome).toBe('PAIRED');
    if (result.outcome !== 'PAIRED') return;
    expect(result.deviceId).toBe('kiosk_1');
    expect(result.deviceToken).toHaveLength(64);
    // Only the hash is kept; the token itself is shown once and never stored.
    expect(s.devices[0]?.tokenHash).toBe(hashDeviceToken(result.deviceToken, PEPPER));
    expect(s.devices[0]?.tokenHash).not.toContain(result.deviceToken);
    expect(s.devices[0]?.pairingCodeHash).toBeNull();
    expect(s.devices[0]?.modelVersion).toBe('fe-v1');
  });

  it('refuses a code that does not belong to any phone', async () => {
    const s = store({ device: { ...active } });

    expect(await pair(s, { code: '111111' })).toEqual({ outcome: 'INVALID_CODE' });
    expect(s.devices[0]?.tokenHash).toBeNull();
  });

  it('refuses a code whose ten minutes have run out', async () => {
    const s = store({ device: { ...active } });

    expect(await pair(s, { now: new Date('2026-09-24T05:05:01Z') })).toEqual({ outcome: 'CODE_EXPIRED' });
    expect(s.devices[0]?.tokenHash).toBeNull();
  });

  it('accepts a code in its very last second', async () => {
    const s = store({ device: { ...active } });

    expect((await pair(s, { now: new Date('2026-09-24T05:05:00Z') })).outcome).toBe('PAIRED');
  });

  it('refuses a phone the owner has revoked', async () => {
    const s = store({ device: { ...active, status: 'REVOKED' } });

    expect(await pair(s)).toEqual({ outcome: 'REVOKED' });
    expect(s.devices[0]?.tokenHash).toBeNull();
  });

  it('cannot be paired twice with the same code', async () => {
    const s = store({ device: { ...active } });

    expect((await pair(s)).outcome).toBe('PAIRED');
    // The code was cleared by the first pairing, so the second finds nothing.
    expect(await pair(s)).toEqual({ outcome: 'INVALID_CODE' });
  });
});

describe('hashDeviceToken', () => {
  it('is peppered, so the hashes are useless in another deployment', () => {
    expect(hashDeviceToken('token', PEPPER)).toBe(hashDeviceToken('token', PEPPER));
    expect(hashDeviceToken('token', PEPPER)).not.toBe(hashDeviceToken('token', 'c'.repeat(32)));
    expect(hashDeviceToken('token', PEPPER)).not.toContain('token');
  });
});
