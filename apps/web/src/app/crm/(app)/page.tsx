import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { ISTDate } from '@mfp/shared';
import { BottomNav, CrmHeader, FEE_TONE, MemberRow, rupees } from '@/components/crm/crm-chrome';
import { LogoutButton } from '@/components/crm/logout-button';
import { can } from '@mfp/core';
import { getContainer } from '@/lib/container';
import { requireCrmContext } from '@/lib/crm';

/**
 * Home — "आज" (crm-ux-blueprint §3).
 *
 * Fixed order: tiles, calls, birthdays, money. Every tile is a link to the list behind
 * it, because a number the owner cannot open is just decoration. Money is owner-only
 * (crm-module-spec §3), so reception sees the same screen without the totals.
 */

export const dynamic = 'force-dynamic';

function monthStart(date: ISTDate): ISTDate {
  return `${date.slice(0, 8)}01` as ISTDate;
}

function previousMonthStart(date: ISTDate): ISTDate {
  const [year, month] = [Number(date.slice(0, 4)), Number(date.slice(5, 7))];
  const previous = month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
  return `${previous.year}-${String(previous.month).padStart(2, '0')}-01` as ISTDate;
}

export default async function CrmHomePage() {
  const { actor, gym, today, reader } = await requireCrmContext();
  const t = await getTranslations('crm');
  const { clock } = getContainer();

  const [counts, calls] = await Promise.all([
    reader.dashboard(gym.id, today, monthStart(today), previousMonthStart(today)),
    reader.callTasks(gym.id, today, 3),
  ]);
  const showMoney = can(actor, 'money.view', clock.now());

  const tiles = [
    { key: 'totalMembers', value: counts.activeMembers, href: '/crm/members?status=ACTIVE', tone: 'bg-white', icon: '👥' },
    { key: 'attendedToday', value: counts.attendedToday, href: '/crm/attendance', tone: 'bg-white', icon: '✅' },
    { key: 'dueThisWeek', value: counts.dueThisWeek, href: '/crm/members?fee=DUE_SOON', tone: FEE_TONE.DUE_SOON.chip, icon: '🟠', note: showMoney ? t('home.dueAmount', { amount: rupees(counts.dueThisWeekPaise) }) : undefined },
    { key: 'expired', value: counts.expired, href: '/crm/members?fee=EXPIRED', tone: FEE_TONE.EXPIRED.chip, icon: '🔴' },
  ] as const;

  return (
    <>
      <CrmHeader
        title={`${t('home.greeting')} ${actor.name}`}
        right={
          <div className="flex items-center gap-2">
            {counts.unreadAlerts > 0 ? (
              <span className="rounded-full bg-semantic-fee-expired px-2 py-1 text-small font-bold text-white">🔔 {counts.unreadAlerts}</span>
            ) : null}
            <LogoutButton label={t('login.logout')} />
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-3 p-4">
        {tiles.map((tile) => (
          <Link key={tile.key} href={tile.href} className={`flex min-h-28 flex-col justify-between rounded-panel p-4 shadow-sm ${tile.tone}`}>
            <span aria-hidden className="text-2xl leading-none">
              {tile.icon}
            </span>
            <span>
              <span className="block font-display text-display-m leading-none font-bold">{tile.value}</span>
              <span className="mt-1 block text-crm-body font-semibold">{t(`home.${tile.key}`)}</span>
              {'note' in tile && tile.note !== undefined ? <span className="mt-0.5 block text-small">{tile.note}</span> : null}
            </span>
          </Link>
        ))}
      </div>

      <section className="mt-2">
        <div className="flex items-center justify-between px-4 py-2">
          <h2 className="text-crm-body font-bold text-brand-obsidian">
            📞 {t('home.calls')} ({counts.callsToday})
          </h2>
          <Link href="/crm/calls" className="min-h-11 text-crm-body font-semibold text-brand-link">
            {t('home.seeAll')}
          </Link>
        </div>
        {calls.length === 0 ? (
          <p className="px-4 pb-3 text-crm-body text-brand-stone">{t('home.noCalls')}</p>
        ) : (
          <ul>
            {calls.map((task) =>
              task.member === null ? null : (
                <li key={task.id}>
                  <MemberRow
                    member={{
                      id: task.member.id,
                      fullName: task.member.fullName,
                      memberCode: t(`calls.reasons.${task.reason}` as never),
                      feeState: task.member.feeState,
                      daysLeft: null,
                      status: 'ACTIVE',
                    }}
                  />
                </li>
              ),
            )}
          </ul>
        )}
      </section>

      <section className="mt-4 px-4">
        <h2 className="text-crm-body font-bold text-brand-obsidian">
          🎂 {t('home.birthdays')} ({counts.birthdaysToday})
        </h2>
        {counts.birthdaysToday === 0 ? <p className="mt-1 text-crm-body text-brand-stone">{t('home.noBirthdays')}</p> : null}
      </section>

      {showMoney ? (
        <section className="mt-4 px-4">
          <h2 className="text-crm-body font-bold text-brand-obsidian">₹ {t('home.thisMonth')}</h2>
          <p className="mt-1 font-display text-display-m font-bold text-brand-obsidian">{rupees(counts.collectedThisMonthPaise)}</p>
          <p className="text-crm-body text-brand-stone">{t('home.lastMonth', { amount: rupees(counts.collectedLastMonthPaise) })}</p>
        </section>
      ) : null}

      <Link
        href="/crm/members/new"
        className="fixed right-5 bottom-24 z-20 flex size-16 items-center justify-center rounded-full bg-brand-accent text-3xl text-brand-white shadow-[var(--shadow-overlay)]"
        aria-label={t('home.addMember')}
      >
        ＋
      </Link>
      <BottomNav active="home" />
    </>
  );
}
