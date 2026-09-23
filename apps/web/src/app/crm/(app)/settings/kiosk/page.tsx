import { getLocale, getTranslations } from 'next-intl/server';
import { kioskIsOffline, mayAfterPinEntry } from '@mfp/core';
import { PrismaKioskDevices } from '@mfp/db';
import { pairKioskAction, revokeKioskAction, setKioskShadowModeAction, unlockSettingsAction } from '@/app/crm/actions';
import { BottomNav, CrmHeader } from '@/components/crm/crm-chrome';
import { KioskDevices, type KioskDeviceItem, type KioskHealthView } from '@/components/crm/kiosk-devices';
import { getContainer } from '@/lib/container';
import { requireCrmContext } from '@/lib/crm';

/**
 * "हाज़िरी वाला फ़ोन" — pairing and watching the attendance phone (Phase 7).
 *
 * Owner-only, behind the PIN, because a pairing code is a way into the gym's member
 * list and revoking stops a working phone dead. Whether the phone is late is decided
 * here rather than on the phone's word for it: the server knows what time it is.
 */

export const dynamic = 'force-dynamic';

const number = (health: Record<string, unknown> | null, key: string, fallback: number): number => {
  const value = health?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
};

const flag = (health: Record<string, unknown> | null, key: string, fallback: boolean): boolean => {
  const value = health?.[key];
  return typeof value === 'boolean' ? value : fallback;
};

/** "2 minutes ago" — the only form of a timestamp anyone acts on. */
function ago(from: Date, now: Date, locale: 'en' | 'hi'): string {
  const minutes = Math.max(0, Math.round((now.getTime() - from.getTime()) / 60_000));
  const format = new Intl.RelativeTimeFormat(locale === 'en' ? 'en-IN' : 'hi-IN', { numeric: 'auto' });
  if (minutes < 60) return format.format(-minutes, 'minute');
  if (minutes < 60 * 24) return format.format(-Math.round(minutes / 60), 'hour');
  return format.format(-Math.round(minutes / (60 * 24)), 'day');
}

export default async function KioskSettingsPage() {
  const { actor, gym } = await requireCrmContext();
  const t = await getTranslations('crm');
  const locale = (await getLocale()) === 'en' ? 'en' : 'hi';
  const { clock, prisma } = getContainer();
  const now = clock.now();

  if (!mayAfterPinEntry(actor, 'settings.manage', now)) {
    return (
      <>
        <CrmHeader title={t('kiosk.title')} back="/crm/settings" />
        <p role="alert" className="m-4 rounded-panel bg-tint-fee-none-bg p-4 text-crm-body font-semibold text-brand-obsidian">
          {t('verify.errors.notAllowed')}
        </p>
        <BottomNav active="more" />
      </>
    );
  }

  const windowMinutes = gym.settings.attendance.kioskOfflineAlertMinutes;
  const devices = await new PrismaKioskDevices(prisma).list(gym.id);

  const items: KioskDeviceItem[] = devices
    .filter((device) => device.status === 'ACTIVE')
    .map((device) => {
      const health: KioskHealthView | null =
        device.lastHeartbeat === null
          ? null
          : {
              battery: number(device.lastHeartbeat, 'battery', 0),
              charging: flag(device.lastHeartbeat, 'charging', false),
              temperatureC: number(device.lastHeartbeat, 'temperatureC', 0),
              queueSize: number(device.lastHeartbeat, 'queueSize', 0),
              cameraOk: flag(device.lastHeartbeat, 'cameraOk', true),
            };

      return {
        id: device.id,
        name: device.name,
        status: device.status,
        paired: device.paired,
        // A phone that has never beaten is not "late" — it is waiting to be paired.
        offline: device.paired && kioskIsOffline({ lastSeenAt: device.lastSeenAt }, now, windowMinutes),
        shadowMode: device.shadowMode,
        appVersion: device.appVersion,
        lastSeenLabel: device.lastSeenAt === null ? null : ago(device.lastSeenAt, now, locale),
        health,
        pairingCode: null,
      };
    });

  return (
    <>
      <CrmHeader title={t('kiosk.title')} subtitle={t('kiosk.helper')} back="/crm/settings" />
      <div className="grid gap-4 p-4 pb-24 lg:p-0">
        <KioskDevices devices={items} pair={pairKioskAction} revoke={revokeKioskAction} setShadowMode={setKioskShadowModeAction} unlock={unlockSettingsAction} />
      </div>
      <BottomNav active="more" />
    </>
  );
}
