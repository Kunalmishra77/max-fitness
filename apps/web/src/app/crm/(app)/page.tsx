import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { formatISTDate, type ISTDate } from '@mfp/shared';
import { can } from '@mfp/core';
import { setCrmLanguageAction } from '@/app/crm/actions';
import { BottomNav, CrmHeader, FEE_TONE, MemberRow, rupees } from '@/components/crm/crm-chrome';
import { CrmIcon, type CrmIconName } from '@/components/crm/crm-icons';
import { LanguageSwitch } from '@/components/crm/language-switch';
import { LogoutButton } from '@/components/crm/logout-button';
import { getContainer } from '@/lib/container';
import { requireCrmContext, verificationDeps } from '@/lib/crm';
import { cn } from '@/lib/cn';

/**
 * Home — "आज" (crm-ux-blueprint §3; ADR-062).
 *
 * Quick actions first, then four tiles that each say what their number means, then the
 * day's calls and, beside them on a computer, birthdays and (owner only) the month's
 * money. Every tile is a link to the list behind it.
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
  const locale = (await getLocale()) === 'en' ? 'en' : 'hi';
  const { clock } = getContainer();
  const now = clock.now();

  const showVerify = can(actor, 'verification.approve', now);
  const [counts, calls, waiting] = await Promise.all([
    reader.dashboard(gym.id, today, monthStart(today), previousMonthStart(today)),
    reader.callTasks(gym.id, today, 5),
    showVerify ? verificationDeps().queue.count(gym.id) : Promise.resolve(0),
  ]);
  const showMoney = can(actor, 'money.view', now);

  const tiles: ReadonlyArray<{ key: 'totalMembers' | 'attendedToday' | 'dueThisWeek' | 'expired'; value: number; href: string; icon: CrmIconName; tone: string; note?: string }> = [
    { key: 'totalMembers', value: counts.activeMembers, href: '/crm/members?status=ACTIVE', icon: 'members', tone: 'bg-brand-obsidian text-brand-white' },
    { key: 'attendedToday', value: counts.attendedToday, href: '/crm/attendance', icon: 'attendance', tone: FEE_TONE.PAID.chip },
    {
      key: 'dueThisWeek',
      value: counts.dueThisWeek,
      href: '/crm/members?fee=DUE_SOON',
      icon: 'fees',
      tone: FEE_TONE.DUE_SOON.chip,
      ...(showMoney ? { note: t('home.dueAmount', { amount: rupees(counts.dueThisWeekPaise) }) } : {}),
    },
    { key: 'expired', value: counts.expired, href: '/crm/members?fee=EXPIRED', icon: 'bell', tone: FEE_TONE.EXPIRED.chip },
  ];

  const quick: ReadonlyArray<{ key: string; href: string; icon: CrmIconName; badge?: number }> = [
    { key: 'addMember', href: '/crm/members/new', icon: 'plus' },
    { key: 'takeFees', href: '/crm/members?fee=EXPIRED', icon: 'fees' },
    { key: 'markAttendance', href: '/crm/attendance', icon: 'attendance' },
    ...(showVerify ? [{ key: 'verify', href: '/crm/verify', icon: 'verify' as const, ...(waiting > 0 ? { badge: waiting } : {}) }] : []),
  ];

  return (
    <>
      <CrmHeader
        brand
        title={`${t('home.greeting')}, ${actor.name}`}
        subtitle={t('home.todayIs', { date: formatISTDate(today, locale) })}
        right={
          <div className="flex items-center gap-2">
            {counts.unreadAlerts > 0 ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-brand-accent px-2.5 py-1 text-small font-bold text-brand-white">
                <CrmIcon name="bell" className="size-4" />
                <span className="sr-only">{t('home.alerts', { count: counts.unreadAlerts })}</span>
                <span aria-hidden>{counts.unreadAlerts}</span>
              </span>
            ) : null}
            <span className="hidden sm:block lg:hidden">
              <LanguageSwitch current={locale} change={setCrmLanguageAction} />
            </span>
            <span className="lg:hidden">
              <LogoutButton label={t('shell.logout')} className="text-brand-mist hover:text-brand-white" />
            </span>
          </div>
        }
      />

      <div className="grid gap-6 p-4 lg:p-0">
        {/* The language switch lives in the top bar on wider phones and in the sidebar on computers. */}
        <div className="sm:hidden">
          <LanguageSwitch current={locale} change={setCrmLanguageAction} tone="light" />
        </div>

        <section aria-labelledby="quick-heading">
          <h2 id="quick-heading" className="sr-only">
            {t('home.quickTitle')}
          </h2>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {quick.map((item) => (
              <li key={item.key}>
                <Link
                  href={item.href}
                  className="group relative flex min-h-16 items-center gap-3 rounded-panel border border-brand-stone/15 bg-white px-4 py-3 font-semibold text-brand-obsidian shadow-sm transition-all hover:-translate-y-0.5 hover:border-brand-accent hover:shadow-md"
                >
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-accent/10 text-brand-accent transition-colors group-hover:bg-brand-accent group-hover:text-brand-white">
                    <CrmIcon name={item.icon} className="size-5" />
                  </span>
                  <span className="text-body leading-tight">{t(`home.quick.${item.key}` as never)}</span>
                  {item.badge === undefined ? null : (
                    <span className="absolute -top-2 -right-2 rounded-full bg-brand-accent px-2 py-0.5 text-small font-bold text-brand-white">{item.badge}</span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
          {tiles.map((tile) => (
            <li key={tile.key}>
              <Link
                href={tile.href}
                className={cn(
                  'flex h-full min-h-36 flex-col justify-between gap-3 rounded-panel p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md lg:p-5',
                  tile.tone,
                )}
              >
                <span className="flex items-center justify-between">
                  <span className="text-crm-body font-semibold">{t(`home.${tile.key}`)}</span>
                  <CrmIcon name={tile.icon} className="size-6 opacity-80" />
                </span>
                <span>
                  <span className="block font-display text-[2.75rem] leading-none font-bold tabular">{tile.value}</span>
                  <span className="mt-1 block text-small opacity-80">{tile.note ?? t(`home.help.${tile.key}`)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>

        <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <section aria-labelledby="calls-heading" className="overflow-hidden rounded-panel border border-brand-stone/15 bg-white shadow-sm">
            <div className="flex items-start justify-between gap-3 border-b border-brand-stone/15 px-4 py-3">
              <div className="flex gap-3">
                <span className="mt-0.5 flex size-9 items-center justify-center rounded-full bg-brand-accent/10 text-brand-accent">
                  <CrmIcon name="calls" className="size-5" />
                </span>
                <div>
                  <h2 id="calls-heading" className="text-crm-body font-bold text-brand-obsidian">
                    {t('home.calls')} ({counts.callsToday})
                  </h2>
                  <p className="text-small text-brand-stone">{t('home.callsHelp')}</p>
                </div>
              </div>
              <Link href="/crm/calls" className="inline-flex min-h-11 items-center gap-1 text-body font-semibold whitespace-nowrap text-brand-link">
                {t('home.seeAll')}
                <CrmIcon name="chevron" className="size-4" />
              </Link>
            </div>
            {calls.length === 0 ? (
              <p className="px-4 py-6 text-crm-body text-brand-stone">{t('home.noCalls')}</p>
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

          <div className="grid content-start gap-6">
            <section aria-labelledby="birthdays-heading" className="rounded-panel border border-brand-stone/15 bg-white p-4 shadow-sm">
              <div className="flex gap-3">
                <span className="flex size-9 items-center justify-center rounded-full bg-tint-birthday-bg text-semantic-birthday">
                  <CrmIcon name="cake" className="size-5" />
                </span>
                <div>
                  <h2 id="birthdays-heading" className="text-crm-body font-bold text-brand-obsidian">
                    {t('home.birthdays')} ({counts.birthdaysToday})
                  </h2>
                  <p className="text-small text-brand-stone">{counts.birthdaysToday === 0 ? t('home.noBirthdays') : t('home.birthdaysHelp')}</p>
                </div>
              </div>
            </section>

            {showMoney ? (
              <section aria-labelledby="money-heading" className="relative overflow-hidden rounded-panel bg-brand-obsidian p-5 text-brand-white shadow-sm">
                <span aria-hidden className="absolute -top-10 -right-10 size-40 rounded-full bg-brand-accent/25 blur-2xl" />
                <h2 id="money-heading" className="relative text-crm-body font-bold">
                  {t('home.thisMonth')}
                </h2>
                <p className="relative text-small text-brand-mist">{t('home.moneyHelp')}</p>
                <p className="relative mt-3 font-display text-[2.75rem] leading-none font-bold tabular">{rupees(counts.collectedThisMonthPaise)}</p>
                <p className="relative mt-2 text-small text-brand-mist">{t('home.lastMonth', { amount: rupees(counts.collectedLastMonthPaise) })}</p>
                {can(actor, 'money.view', now) ? (
                  <Link href="/crm/reports" className="relative mt-4 inline-flex min-h-11 items-center gap-1 text-body font-semibold text-brand-accent-glow">
                    {t('menu.reports.label')}
                    <CrmIcon name="chevron" className="size-4" />
                  </Link>
                ) : null}
              </section>
            ) : null}
          </div>
        </div>
      </div>

      <Link
        href="/crm/members/new"
        className="fixed right-5 bottom-24 z-20 flex size-16 items-center justify-center rounded-full bg-brand-accent text-brand-white shadow-[0_12px_30px_-8px_rgb(217_15_31/0.8)] transition-transform hover:scale-105 lg:hidden"
        aria-label={t('home.addMember')}
      >
        <CrmIcon name="plus" className="size-8" />
      </Link>
      <BottomNav active="home" />
    </>
  );
}
