import { getTranslations } from 'next-intl/server';
import { mayAfterPinEntry } from '@mfp/core';
import { PrismaAnnouncements } from '@mfp/db';
import { formatISTDate, toISTDate } from '@mfp/shared';
import { sendAnnouncementAction, unlockSettingsAction } from '@/app/crm/actions';
import { AnnouncementComposer } from '@/components/crm/announcement-composer';
import { BottomNav, CrmHeader } from '@/components/crm/crm-chrome';
import { getContainer } from '@/lib/container';
import { requireCrmContext } from '@/lib/crm';

/**
 * "सूचना भेजें" — one message to every member (ADR-079).
 *
 * The owner's alone, and hidden rather than disabled for anyone else: a receptionist
 * offered a button they can never press has been told nothing useful. Past announcements
 * are listed underneath, with how many of each actually left.
 */

export const dynamic = 'force-dynamic';

export default async function CrmAnnouncementsPage() {
  const { actor, gym } = await requireCrmContext();
  const t = await getTranslations('crm.announce');
  const { clock, prisma } = getContainer();

  if (!mayAfterPinEntry(actor, 'settings.manage', clock.now())) {
    return (
      <>
        <CrmHeader title={t('title')} back="/crm/more" />
        <p role="alert" className="m-4 rounded-panel bg-tint-fee-none-bg p-4 text-crm-body font-semibold text-brand-obsidian">
          {t('errors.notAllowed')}
        </p>
        <BottomNav active="more" />
      </>
    );
  }

  const announcements = new PrismaAnnouncements(prisma);
  const [reach, past] = await Promise.all([announcements.reachableCount(gym.id, 'ACTIVE'), announcements.recent(gym.id)]);
  const locale = actor.language;

  return (
    <>
      <CrmHeader title={t('title')} back="/crm/more" />
      <AnnouncementComposer reach={reach} send={sendAnnouncementAction} unlock={unlockSettingsAction} />

      <section className="px-4 pb-24">
        <h2 className="text-crm-body font-bold text-brand-obsidian">{t('latestTitle')}</h2>
        {past.length === 0 ? (
          <p className="mt-2 rounded-panel bg-white p-4 text-crm-body text-brand-stone">{t('empty')}</p>
        ) : (
          <ul className="mt-2 grid gap-2">
            {past.map((item) => (
              <li key={item.id} className="rounded-panel bg-white p-4 shadow-sm">
                <p className="text-crm-body text-brand-obsidian">{locale === 'hi' && item.textHi !== '' ? item.textHi : item.textEn !== '' ? item.textEn : item.textHi}</p>
                <p className="mt-1 text-small text-brand-stone">
                  {t('sentAt', { date: formatISTDate(toISTDate(item.sentAt), locale), name: item.byName })} ·{' '}
                  {t('sentCount', { sent: item.sent, total: item.recipientCount })}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <BottomNav active="more" />
    </>
  );
}
