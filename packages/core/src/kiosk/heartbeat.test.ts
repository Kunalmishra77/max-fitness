import { describe, expect, it } from 'vitest';
import { FakeClock } from '@mfp/shared';
import { kioskIsOffline, recordHeartbeat, type HeartbeatStore } from './heartbeat';

/**
 * The kiosk's health beat (api-specification §7; attendance spec §11).
 *
 * The phone is on a wall where nobody looks at it, so the only way anyone learns it
 * has stopped working is that it stops saying it is working. The beat carries the
 * things that actually go wrong on a wall-mounted phone — heat, a dead camera, a full
 * disk, a queue that is not draining — and the reply is where the server gets to tell
 * a device that it has been revoked.
 */

const NOW = new Date('2026-09-24T05:00:00Z');

const health = { battery: 92, charging: true, temperatureC: 36.5, queueSize: 0, cameraOk: true, freeStorageMb: 12_000, appVersion: '1.0.0', fps: 12 };

function store(status: 'ACTIVE' | 'REVOKED' = 'ACTIVE') {
  const saved: Array<{ deviceId: string; at: Date; health: Record<string, unknown> }> = [];
  const impl: HeartbeatStore = {
    device: (deviceId) => Promise.resolve({ id: deviceId, gymId: 'gym_1', status, shadowMode: true }),
    save: (deviceId, at, beat) => {
      saved.push({ deviceId, at, health: beat });
      return Promise.resolve();
    },
  };
  return { saved, impl };
}

describe('recordHeartbeat', () => {
  it('records the beat and answers with the server’s own time', async () => {
    const s = store();

    const result = await recordHeartbeat({ deviceId: 'kiosk_1', health }, { clock: new FakeClock(NOW), store: s.impl });

    expect(result).toEqual({ ok: true, serverTime: NOW, commands: [], shadowMode: true });
    expect(s.saved).toEqual([{ deviceId: 'kiosk_1', at: NOW, health }]);
  });

  it('tells a revoked phone to wipe itself and forget the gym', async () => {
    const s = store('REVOKED');

    const result = await recordHeartbeat({ deviceId: 'kiosk_1', health }, { clock: new FakeClock(NOW), store: s.impl });

    expect(result).toMatchObject({ ok: true, commands: ['WIPE_AND_UNPAIR'] });
    // The beat is still recorded: the owner wants to see that the phone heard.
    expect(s.saved).toHaveLength(1);
  });

  it('says nothing to a device it does not know', async () => {
    const s = store();
    s.impl.device = () => Promise.resolve(null);

    expect(await recordHeartbeat({ deviceId: 'gone', health }, { clock: new FakeClock(NOW), store: s.impl })).toEqual({ ok: false });
    expect(s.saved).toEqual([]);
  });
});

describe('kioskIsOffline', () => {
  const minutes = (n: number) => new Date(NOW.getTime() - n * 60_000);

  it('is fine while the beats keep coming', () => {
    expect(kioskIsOffline({ lastSeenAt: minutes(4) }, NOW, 10)).toBe(false);
  });

  it('is offline once the silence passes the window', () => {
    expect(kioskIsOffline({ lastSeenAt: minutes(11) }, NOW, 10)).toBe(true);
  });

  it('treats the window itself as still fine, not as late', () => {
    expect(kioskIsOffline({ lastSeenAt: minutes(10) }, NOW, 10)).toBe(false);
  });

  it('counts a phone that has never beaten as offline', () => {
    expect(kioskIsOffline({ lastSeenAt: null }, NOW, 10)).toBe(true);
  });
});
