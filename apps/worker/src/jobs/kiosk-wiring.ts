import { GymSettingsSchema, type Clock } from '@mfp/shared';
import { PrismaKioskDevices, type PrismaClient } from '@mfp/db';
import type { Logger } from '../logger';
import { runKioskOfflineCheck } from './kiosk';

/**
 * The `kiosk-offline-check` schedule, wired to the database (BR-12).
 *
 * The alert row is all this job writes. The owner hears about it through the same
 * `owner-alerts` job as everything else, which is also what stops a quiet phone
 * buzzing them alongside three other things at once (ADR-065).
 */

const ALERT_LOOKBACK_HOURS = 24;

export function kioskOfflineHandler(deps: { prisma: PrismaClient; clock: Clock; log: Logger; gymSlug: string }): () => Promise<void> {
  return async () => {
    const devices = new PrismaKioskDevices(deps.prisma);

    const result = await runKioskOfflineCheck({
      clock: deps.clock,
      gymId: async () => {
        const gym = await deps.prisma.gym.findUnique({ where: { slug: deps.gymSlug }, select: { id: true } });
        if (gym === null) throw new Error(`No gym for slug ${deps.gymSlug}`);
        return gym.id;
      },
      windowMinutes: async () => {
        const gym = await deps.prisma.gym.findUniqueOrThrow({ where: { slug: deps.gymSlug }, select: { settings: true } });
        return GymSettingsSchema.parse(gym.settings).attendance.kioskOfflineAlertMinutes;
      },
      pairedDevices: (gymId) => devices.offlineCandidates(gymId, new Date(deps.clock.now().getTime() - ALERT_LOOKBACK_HOURS * 3_600_000)),
      alertOffline: async (deviceId, deviceName, minutesOffline) => {
        const gym = await deps.prisma.gym.findUniqueOrThrow({ where: { slug: deps.gymSlug }, select: { id: true } });
        await deps.prisma.alert.create({
          data: { gymId: gym.id, type: 'KIOSK_OFFLINE', title: 'crm.alerts.kioskOffline', params: { deviceId, deviceName, minutesOffline } },
        });
      },
      log: deps.log,
    });

    if (result.alerted > 0) deps.log.info(result, 'kiosk offline check');
  };
}
