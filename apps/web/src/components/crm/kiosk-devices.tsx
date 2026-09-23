'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';
import { CrmIcon } from './crm-icons';

/**
 * The attendance phone, as the owner manages it (crm-module-spec §4; Phase 7).
 *
 * The phone lives on a wall where nobody looks at it, so this card has one job: say
 * whether it is working, in words the owner can act on. A dead camera is called out on
 * its own, because a phone with a dead camera looks exactly like a phone that is fine —
 * it is on, it is charging, it is beating, and it recognises nobody.
 */

export interface KioskHealthView {
  readonly battery: number;
  readonly charging: boolean;
  readonly temperatureC: number;
  readonly queueSize: number;
  readonly cameraOk: boolean;
}

export interface KioskDeviceItem {
  readonly id: string;
  readonly name: string;
  readonly status: 'ACTIVE' | 'REVOKED';
  readonly paired: boolean;
  readonly offline: boolean;
  readonly shadowMode: boolean;
  readonly appVersion: string | null;
  readonly lastSeenLabel: string | null;
  readonly health: KioskHealthView | null;
  /** Set only while a freshly issued code is still live. */
  readonly pairingCode: string | null;
}

export type KioskActionResult = { ok: true; code?: string } | { ok: false };

export function KioskDevices({
  devices,
  pair,
  revoke,
  setShadowMode,
}: {
  readonly devices: readonly KioskDeviceItem[];
  readonly pair: (deviceId: string | null) => Promise<KioskActionResult>;
  readonly revoke: (deviceId: string) => Promise<KioskActionResult>;
  readonly setShadowMode: (deviceId: string, shadowMode: boolean) => Promise<KioskActionResult>;
}) {
  const t = useTranslations('crm.kiosk');
  const [code, setCode] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (work: () => Promise<KioskActionResult>) =>
    startTransition(async () => {
      const result = await work();
      if (result.ok && result.code !== undefined) setCode(result.code);
    });

  return (
    <div className="grid gap-4">
      {code === null ? null : (
        <div role="status" className="rounded-panel bg-brand-obsidian p-5 text-center text-brand-white">
          <p className="text-small text-brand-mist">{t('codeHelp')}</p>
          {/* Big enough to read from the other side of the desk. */}
          <p className="mt-2 font-display text-[3rem] leading-none font-bold tracking-[0.2em] tabular">{code}</p>
          <p className="mt-2 text-small text-brand-mist">{t('codeExpires')}</p>
        </div>
      )}

      {devices.length === 0 ? (
        <div className="rounded-panel border border-brand-stone/15 bg-white p-6 text-center">
          <p className="text-crm-body font-semibold text-brand-obsidian">{t('none')}</p>
          <p className="mt-1 text-small text-brand-stone">{t('noneHelp')}</p>
          <button type="button" onClick={() => run(() => pair(null))} disabled={pending} className="mt-4 min-h-14 rounded-button bg-brand-accent px-6 text-crm-body font-semibold text-brand-white disabled:opacity-60">
            {t('pair')}
          </button>
        </div>
      ) : (
        devices.map((device) => {
          // Green means working and red means broken. A phone that has not finished
          // pairing is neither, and either colour would be a lie the owner acts on.
          const state = !device.paired ? 'waiting' : device.offline ? 'broken' : 'working';
          const chip =
            state === 'working' ? 'bg-tint-fee-paid-bg text-semantic-fee-paid' : state === 'broken' ? 'bg-tint-fee-expired-bg text-semantic-fee-expired' : 'bg-tint-fee-none-bg text-brand-stone';
          const label = state === 'working' ? 'text-semantic-fee-paid' : state === 'broken' ? 'text-semantic-fee-expired' : 'text-brand-stone';

          return (
          <article key={device.id} aria-label={device.name} className="rounded-panel border border-brand-stone/15 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center gap-3">
              <span className={cn('flex size-10 items-center justify-center rounded-full', chip)}>
                <CrmIcon name="attendance" className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-crm-body font-bold text-brand-obsidian">{device.name}</p>
                <p className={cn('text-small font-semibold', label)}>
                  {state === 'waiting' ? t('notPaired') : state === 'broken' ? t('offline') : t('working')}
                </p>
              </div>
              {device.lastSeenLabel === null ? null : <p className="text-small text-brand-stone">{t('lastSeen', { when: device.lastSeenLabel })}</p>}
            </div>

            {device.health === null ? null : (
              <div className="mt-3 grid gap-1 text-small text-brand-stone">
                <p>{t('battery', { percent: device.health.battery, charging: device.health.charging ? t('charging') : t('onBattery') })}</p>
                <p>{t('temperature', { degrees: device.health.temperatureC })}</p>
                {device.health.queueSize > 0 ? <p>{t('queue', { count: device.health.queueSize })}</p> : null}
                {device.health.cameraOk ? null : <p className="font-semibold text-semantic-fee-expired">{t('cameraBroken')}</p>}
              </div>
            )}

            {device.shadowMode ? <p className="mt-3 rounded-input bg-tint-fee-due-soon-bg p-3 text-small font-semibold text-semantic-fee-due-soon">{t('shadow')}</p> : null}

            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" onClick={() => run(() => pair(device.id))} disabled={pending} className="min-h-14 rounded-button border-2 border-brand-obsidian px-4 text-crm-body font-semibold text-brand-obsidian disabled:opacity-60">
                {t('pairAgain')}
              </button>
              <button type="button" onClick={() => run(() => setShadowMode(device.id, !device.shadowMode))} disabled={pending} className="min-h-14 rounded-button border-2 border-brand-stone/30 px-4 text-crm-body font-semibold text-brand-obsidian disabled:opacity-60">
                {device.shadowMode ? t('startGreeting') : t('watchOnly')}
              </button>
              {confirming === device.id ? (
                <button type="button" onClick={() => run(() => revoke(device.id))} disabled={pending} className="min-h-14 rounded-button bg-semantic-fee-expired px-4 text-crm-body font-semibold text-brand-white disabled:opacity-60">
                  {t('revokeConfirm')}
                </button>
              ) : (
                <button type="button" onClick={() => setConfirming(device.id)} className="min-h-14 rounded-button px-4 text-crm-body font-semibold text-semantic-fee-expired">
                  {t('revoke')}
                </button>
              )}
            </div>
          </article>
          );
        })
      )}
    </div>
  );
}
