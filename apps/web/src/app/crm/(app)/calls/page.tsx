import { getTranslations } from 'next-intl/server';
import { can } from '@mfp/core';
import { recordCallOutcomeAction } from '@/app/crm/actions';
import { CallOutcomeButtons } from '@/components/crm/call-outcome';
import { BottomNav, CrmHeader, FEE_TONE } from '@/components/crm/crm-chrome';
import { getContainer } from '@/lib/container';
import { requireCrmContext } from '@/lib/crm';

/**
 * Today's calls (crm-ux-blueprint §8).
 *
 * Most urgent first, each with the one reason it is on the list, the two buttons that
 * do something about it, and the six answers to "what happened?" underneath. A task
 * leaves the list the moment it is closed or snoozed.
 */

export const dynamic = 'force-dynamic';

export default async function CrmCallsPage() {
  const { actor, gym, today, reader } = await requireCrmContext();
  const t = await getTranslations('crm');
  const tasks = await reader.callTasks(gym.id, today, 50);
  const mayRecord = can(actor, 'call.outcome', getContainer().clock.now());

  return (
    <>
      <CrmHeader title={t('calls.title')} back="/crm" />
      {tasks.length === 0 ? (
        <p className="px-4 py-10 text-center text-crm-body text-brand-stone">{t('calls.empty')}</p>
      ) : (
        <ul className="divide-y divide-brand-stone/15">
          {tasks.map((task) => (
            <li key={task.id} className="bg-white p-4">
              <div className="flex items-baseline justify-between gap-3">
                <span className="truncate text-crm-body font-semibold">{task.member?.fullName ?? '—'}</span>
                <span className={`shrink-0 rounded-button px-2 py-1 text-small font-semibold ${FEE_TONE[task.member?.feeState ?? 'NONE'].chip}`}>
                  {t(`calls.reasons.${task.reason}` as never)}
                </span>
              </div>
              {task.member === null ? null : (
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <a href={`tel:${task.member.mobile}`} className="flex min-h-14 items-center justify-center rounded-panel bg-brand-obsidian text-crm-body font-semibold text-white">
                    📞 {t('profile.call')}
                  </a>
                  <a
                    href={`https://wa.me/${task.member.mobile.replace(/\D/g, '')}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex min-h-14 items-center justify-center rounded-panel border-2 border-brand-obsidian text-crm-body font-semibold text-brand-obsidian"
                  >
                    💬 {t('profile.whatsapp')}
                  </a>
                </div>
              )}
              {mayRecord ? <CallOutcomeButtons taskId={task.id} action={recordCallOutcomeAction} /> : null}
            </li>
          ))}
        </ul>
      )}
      <BottomNav active="home" />
    </>
  );
}
