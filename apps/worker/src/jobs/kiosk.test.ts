import { describe, expect, it, vi } from 'vitest';
import type { Clock } from '@mfp/shared';
import { runKioskOfflineCheck, type KioskOfflineDeps } from './kiosk';

/**
 * The job that notices the reception phone has gone quiet (BR-12; crm-module-spec §4).
 *
 * It runs every ten minutes during gym hours, so the hard part is not spotting the
 * silence — it is telling the owner once, rather than every ten minutes until someone
 * walks over and looks at the phone.
 */

const NOW = new Date('2026-09-24T09:00:00Z');
const clock: Clock = { now: () => NOW };
const minutes = (n: number) => new Date(NOW.getTime() - n * 60_000);

function deps(devices: Array<{ id: string; name: string; lastSeenAt: Date | null; alertedAt: Date | null }>, windowMinutes = 30) {
  const alerted: string[] = [];
  const impl: KioskOfflineDeps = {
    clock,
    gymId: () => Promise.resolve('gym_1'),
    windowMinutes: () => Promise.resolve(windowMinutes),
    pairedDevices: () => Promise.resolve(devices),
    alertOffline: (deviceId, deviceName, minutesOffline) => {
      alerted.push(`${deviceId}:${deviceName}:${minutesOffline}`);
      return Promise.resolve();
    },
    log: { warn: vi.fn() },
  };
  return { alerted, impl };
}

describe('runKioskOfflineCheck', () => {
  it('says nothing while the phone keeps beating', async () => {
    const d = deps([{ id: 'k1', name: 'Reception phone', lastSeenAt: minutes(5), alertedAt: null }]);

    expect(await runKioskOfflineCheck(d.impl)).toEqual({ checked: 1, alerted: 0 });
    expect(d.alerted).toEqual([]);
  });

  it('tells the owner once the silence passes the window', async () => {
    const d = deps([{ id: 'k1', name: 'Reception phone', lastSeenAt: minutes(45), alertedAt: null }]);

    expect(await runKioskOfflineCheck(d.impl)).toEqual({ checked: 1, alerted: 1 });
    expect(d.alerted).toEqual(['k1:Reception phone:45']);
  });

  it('does not say it again ten minutes later', async () => {
    // The owner was told at 8:50; the phone is still quiet, and that is not news.
    const d = deps([{ id: 'k1', name: 'Reception phone', lastSeenAt: minutes(45), alertedAt: minutes(10) }]);

    expect(await runKioskOfflineCheck(d.impl)).toEqual({ checked: 1, alerted: 0 });
    expect(d.alerted).toEqual([]);
  });

  it('says it again after the phone has come back and gone quiet once more', async () => {
    // Alerted an hour ago, then beat half an hour ago, then went quiet again.
    const d = deps([{ id: 'k1', name: 'Reception phone', lastSeenAt: minutes(40), alertedAt: minutes(90) }]);

    expect(await runKioskOfflineCheck(d.impl)).toEqual({ checked: 1, alerted: 1 });
  });

  it('leaves a phone that has never been seen to the pairing screen', async () => {
    const d = deps([{ id: 'k1', name: 'Reception phone', lastSeenAt: null, alertedAt: null }]);

    expect(await runKioskOfflineCheck(d.impl)).toEqual({ checked: 1, alerted: 0 });
    expect(d.alerted).toEqual([]);
  });

  it('checks every phone the gym has', async () => {
    const d = deps([
      { id: 'k1', name: 'Reception phone', lastSeenAt: minutes(45), alertedAt: null },
      { id: 'k2', name: 'Spare phone', lastSeenAt: minutes(2), alertedAt: null },
    ]);

    expect(await runKioskOfflineCheck(d.impl)).toEqual({ checked: 2, alerted: 1 });
    expect(d.alerted).toEqual(['k1:Reception phone:45']);
  });
});
