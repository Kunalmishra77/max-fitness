import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import {
  attendanceStats,
  can,
  customRange,
  fillMissingDays,
  firstOfMonth,
  isAttendancePreset,
  isDomainError,
  lastOfMonth,
  MAX_RANGE_DAYS,
  monthCalendar,
  rangeForPreset,
  type AttendancePreset,
  type AttendanceRange,
} from '@mfp/core';
import { addDays, compareISTDates, formatISTDate, isISTDate, type ISTDate } from '@mfp/shared';
import { AttendanceCalendar } from '@/components/crm/attendance-calendar';
import { markAttendanceAction, undoAttendanceAction } from '@/app/crm/actions';
import { AttendanceMarker } from '@/components/crm/attendance-marker';
import { AutoRefresh } from '@/components/crm/auto-refresh';
import { BottomNav, CrmHeader, FEE_TONE, CRM_CARD, pillClass } from '@/components/crm/crm-chrome';
import { CrmIcon } from '@/components/crm/crm-icons';
import { cn } from '@/lib/cn';
import { MemberSearch } from '@/components/crm/member-search';
import { getContainer } from '@/lib/container';
import { requireCrmContext } from '@/lib/crm';

/**
 * Attendance — "हाज़िरी" (crm-ux-blueprint §11; ATT-001 … ATT-005).
 *
 * Until the kiosk exists every visit is marked here, so the search box and the mark
 * button come first; today's list is underneath, newest at the top, and the "नहीं आ रहे"
 * tab is the one worth calling — members who have paid but stopped coming.
 *
 * **The third tab is the register the gym had been building and could not read.** Every
 * check-in since the kiosk went in was stored and nothing in the CRM could show a day
 * that was not today, so "how many came last Tuesday" — let alone "was October busier
 * than September" — had no answer. History gives it a month at a glance, a range, the
 * figures for that range, and the list for whichever day is tapped.
 *
 * Two details worth not undoing. The calendar and the filters are **links, not state**:
 * the view is in the query string, so it survives a reload, the back button behaves, and
 * a receptionist can send the owner the URL of a particular day. And the whole history
 * view renders on the server with no JavaScript, which on a reception phone on a bad
 * connection is the difference between a calendar and a blank rectangle.
 */

export const dynamic = 'force-dynamic';

export default async function CrmAttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; tab?: string; date?: string; preset?: string; from?: string; to?: string }>;
}) {
  const { actor, gym, today, reader } = await requireCrmContext();
  const t = await getTranslations('crm');
  const { clock } = getContainer();
  const { q, tab, date, preset, from, to } = await searchParams;

  const mayMark = can(actor, 'attendance.manual', clock.now());
  const search = (q ?? '').trim();
  const absent = tab === 'absent';
  const history = tab === 'history';

  /**
   * Which range the history view is showing.
   *
   * A bad `from`/`to` from a hand-edited URL is not an error page: the range falls back
   * to this month and the reason is shown above the figures. `customRange` is the only
   * thing that decides, so the screen and an export of the same URL cannot disagree.
   */
  const chosenPreset: AttendancePreset = isAttendancePreset(preset) ? preset : 'THIS_MONTH';
  let range: AttendanceRange;
  let rangeProblem: string | null = null;
  if (chosenPreset === 'CUSTOM' && isISTDate(from) && isISTDate(to)) {
    try {
      range = customRange(from, to, today);
    } catch (error) {
      range = rangeForPreset('THIS_MONTH', today);
      rangeProblem = isDomainError(error) && String(error.message).includes('too long') ? t('attendance.rangeTooLong', { days: MAX_RANGE_DAYS }) : t('attendance.rangeFuture');
    }
  } else {
    range = rangeForPreset(chosenPreset === 'CUSTOM' ? 'THIS_MONTH' : chosenPreset, today);
  }

  /**
   * Which day's list is open, and therefore which month the calendar shows.
   *
   * Defaults to the last day of the range rather than the first: opening "last month"
   * on the 1st and being shown the 1st is less useful than being shown the day it ended.
   * A date beyond today is pulled back, so a typed URL cannot ask for tomorrow's list.
   */
  const requested = isISTDate(date) ? date : null;
  const selected: ISTDate = requested !== null && compareISTDates(requested, today) <= 0 ? requested : compareISTDates(range.to, today) > 0 ? today : range.to;
  // The calendar always shows whole months, which is usually wider than the range.
  const calendarFrom = firstOfMonth(selected);
  const calendarTo = lastOfMonth(selected);

  // Both tabs are counted whichever is open: a tab label that says how many is the
  // difference between reception checking and reception knowing (ADR-097).
  const [events, absentMembers, matches] = await Promise.all([
    reader.attendanceOn(gym.id, history ? selected : today),
    reader.absentMembers(gym.id, today, gym.settings.attendance.absentDaysThreshold),
    search === '' ? Promise.resolve([]) : reader.members(gym.id, today, { search, limit: 10 }),
  ]);

  /**
   * Three queries, and only when the tab is open.
   *
   * The unique-member figure cannot come from the daily counts: adding up each day's
   * distinct members counts a regular five times over, so it is its own query. The
   * calendar's month is fetched separately from the range because they are usually
   * different spans — "last week" is five cells of a month the owner still wants to see.
   */
  const [dailyCounts, calendarCounts, uniqueMembers] = history
    ? await Promise.all([
        reader.attendanceDailyCounts(gym.id, range.from, range.to),
        reader.attendanceDailyCounts(gym.id, calendarFrom, calendarTo),
        reader.attendanceUniqueMembers(gym.id, range.from, range.to),
      ])
    : [[], [], 0];

  const stats = attendanceStats(range, today, fillMissingDays(range, today, dailyCounts));
  const weeks = monthCalendar(selected, today, calendarCounts);
  const locale = actor.language === 'hi' ? 'hi-IN' : 'en-IN';
  const dayLabel = (value: ISTDate) => formatISTDate(value, locale, { year: true });

  /** Tapping a day keeps the range; only the open day changes. */
  const historyHref = (day: string) => {
    const params = new URLSearchParams({ tab: 'history', preset: chosenPreset, date: day });
    if (chosenPreset === 'CUSTOM') {
      params.set('from', range.from);
      params.set('to', range.to);
    }
    return `/crm/attendance?${params.toString()}`;
  };

  /**
   * Choosing a preset deliberately drops the pinned day.
   *
   * Otherwise picking "last month" while the 16th is open leaves the 16th open and the
   * figures above it describing a month it is not in. With no `date`, the server defaults
   * the open day to the end of the new range, which is the day somebody wants to see.
   */
  const presetHref = (key: AttendancePreset) => `/crm/attendance?tab=history&preset=${key}`;

  // Null when that month has not happened: the arrow is then not drawn at all.
  const previousMonth = addDays(calendarFrom, -1);
  const nextMonthStart = addDays(calendarTo, 1);

  const time = (at: Date) =>
    new Intl.DateTimeFormat(actor.language === 'hi' ? 'hi-IN' : 'en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit' }).format(at);

  const tabClass = (active: boolean) =>
    pillClass(active);

  return (
    <>
      {/* Arrivals land here from the kiosk, not from this screen (ADR-092). */}
      <AutoRefresh seconds={30} />
      <CrmHeader title={t('attendance.title')} subtitle={t('menu.attendance.desc')} back="/crm" />

      {mayMark ? (
        <div className={cn(CRM_CARD, 'px-4 pt-3 pb-4')}>
          <MemberSearch placeholder={t('attendance.search')} initial={search} basePath="/crm/attendance" />
          {matches.length === 0 ? null : (
            <ul className="mt-3 divide-y divide-brand-stone/15">
              {matches.map((member) => (
                <li key={member.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <span className="min-w-0">
                    <Link href={`/crm/members/${member.id}`} className="block truncate text-crm-body font-semibold text-brand-ink">
                      {member.fullName}
                    </Link>
                    <span className="block text-small text-brand-stone">{member.memberCode ?? '—'}</span>
                  </span>
                  <AttendanceMarker memberId={member.id} name={member.fullName} mark={markAttendanceAction} undo={undoAttendanceAction} />
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      <div className="flex gap-2 px-4 py-3">
        <Link href="/crm/attendance" className={tabClass(!absent)}>
          {t('attendance.tabToday')} <span className="tabular opacity-70">{events.length}</span>
        </Link>
        <Link href="/crm/attendance?tab=absent" className={tabClass(absent)}>
          {t('attendance.tabAbsent')} <span className="tabular opacity-70">{absentMembers.length}</span>
        </Link>
        <Link href={`/crm/attendance?tab=history&preset=THIS_MONTH&date=${today}`} className={tabClass(history)}>
          {t('attendance.tabHistory')}
        </Link>
      </div>

      {history ? (
        <>
          {/* Presets as links, so the chosen range is in the URL and shareable. */}
          <section aria-label={t('attendance.historyTitle')} className={cn(CRM_CARD, 'px-4 pt-4 pb-4')}>
            <div className="flex flex-wrap gap-2">
              {(['TODAY', 'YESTERDAY', 'THIS_WEEK', 'LAST_WEEK', 'THIS_MONTH', 'LAST_MONTH', 'THIS_YEAR', 'LAST_YEAR'] as const).map((key) => (
                <Link key={key} href={presetHref(key)} className={pillClass(chosenPreset === key)}>
                  {t(`attendance.presets.${key}` as never)}
                </Link>
              ))}
            </div>

            {/**
             * Custom dates are a plain GET form, which is why there is no client component
             * here: the browser builds the query string, the server reads it, and the
             * result is a URL that can be reloaded or sent to somebody.
             */}
            <form method="get" action="/crm/attendance" className="mt-4 flex flex-wrap items-end gap-3">
              <input type="hidden" name="tab" value="history" />
              <input type="hidden" name="preset" value="CUSTOM" />
              <label className="flex flex-col gap-1 text-small font-semibold text-brand-stone">
                {t('attendance.rangeFrom')}
                <input
                  type="date"
                  name="from"
                  defaultValue={range.from}
                  max={today}
                  className="min-h-14 rounded-input border-2 border-brand-stone/40 bg-white px-3 text-crm-body text-brand-ink"
                />
              </label>
              <label className="flex flex-col gap-1 text-small font-semibold text-brand-stone">
                {t('attendance.rangeTo')}
                <input
                  type="date"
                  name="to"
                  defaultValue={range.to}
                  max={today}
                  className="min-h-14 rounded-input border-2 border-brand-stone/40 bg-white px-3 text-crm-body text-brand-ink"
                />
              </label>
              <button type="submit" className="min-h-14 rounded-button bg-brand-obsidian px-6 text-crm-body font-bold text-white">
                {t('attendance.rangeApply')}
              </button>
            </form>

            {rangeProblem === null ? null : (
              <p role="alert" className="mt-3 rounded-panel bg-tint-fee-none-bg p-3 text-crm-body font-semibold text-brand-obsidian">
                {rangeProblem}
              </p>
            )}

            <p className="mt-4 text-small text-brand-stone">{t('attendance.rangeLabel', { from: dayLabel(range.from), to: dayLabel(range.to) })}</p>
          </section>

          {/* The four figures the owner asks for, in the order they ask (ATT-005). */}
          <section className={cn(CRM_CARD, 'mt-3 grid grid-cols-2 gap-px bg-brand-stone/15 lg:grid-cols-4')}>
            {[
              { label: t('attendance.statVisits'), value: String(stats.visits) },
              { label: t('attendance.statUnique'), value: String(uniqueMembers) },
              { label: t('attendance.statAverage'), value: String(stats.averagePerDay) },
              {
                label: t('attendance.statBusiest'),
                value: stats.busiest === null ? t('attendance.statNone') : `${dayLabel(stats.busiest.date)} · ${stats.busiest.visits}`,
              },
            ].map((tile) => (
              <div key={tile.label} className="bg-white p-4">
                <p className="text-small font-semibold text-brand-stone">{tile.label}</p>
                <p className="tabular mt-1 font-display text-title font-bold text-brand-obsidian">{tile.value}</p>
              </div>
            ))}
          </section>

          <div className={cn(CRM_CARD, 'mt-3')}>
            <AttendanceCalendar
              weeks={weeks}
              selected={selected}
              today={today}
              previousMonth={previousMonth}
              nextMonth={compareISTDates(nextMonthStart, today) > 0 ? null : nextMonthStart}
              monthLabel={formatISTDate(calendarFrom, locale, { year: true })}
              weekdayLabels={t('attendance.weekdays').split(',')}
              previousLabel={t('attendance.prevMonth')}
              nextLabel={t('attendance.nextMonth')}
              todayLabel={t('attendance.goToday')}
              hrefFor={historyHref}
              visitsLabel={(visits) => t('attendance.visits', { count: visits })}
            />
          </div>

          {/* ATT-007: whatever range is on screen, as rows. */}
          <div className="flex flex-wrap items-center gap-3 px-4 py-4">
            <a
              href={`/crm/attendance/export?from=${range.from}&to=${range.to}`}
              className="flex min-h-14 items-center justify-center gap-2 rounded-button border-2 border-brand-obsidian px-5 text-crm-body font-bold text-brand-obsidian"
            >
              <CrmIcon name="reports" className="size-5" />
              {t('attendance.exportCsv')}
            </a>
            <span className="text-small text-brand-stone">{t('attendance.exportHint')}</span>
          </div>

          <h3 className="px-4 pb-2 font-display text-title font-bold text-brand-obsidian">{dayLabel(selected)}</h3>
          <p className="px-4 pb-2 text-crm-body text-brand-stone">{t('attendance.visits', { count: events.length })}</p>
          {events.length === 0 ? (
            <p className="px-4 py-8 text-center text-crm-body text-brand-stone">{t('attendance.dayEmpty')}</p>
          ) : (
            <ul className="divide-y divide-brand-stone/15">
              {events.map((event) => (
                <li key={event.id} className="flex items-baseline justify-between gap-3 bg-white p-4">
                  <span className="min-w-0">
                    <Link href={`/crm/members/${event.memberId}`} className="block truncate text-crm-body font-semibold text-brand-ink">
                      {event.fullName}
                    </Link>
                    <span className="block text-small text-brand-stone">{event.memberCode ?? '—'}</span>
                  </span>
                  <span className="shrink-0 text-small text-brand-stone">
                    {time(event.capturedAt)} · {t(`attendance.method${event.method}` as never)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : absent ? (
        absentMembers.length === 0 ? (
          <p className="px-4 py-8 text-center text-crm-body text-brand-stone">{t('attendance.absentEmpty')}</p>
        ) : (
          <ul className="divide-y divide-brand-stone/15">
            {absentMembers.map((member) => (
              <li key={member.id} className="flex flex-wrap items-center justify-between gap-3 bg-white p-4 transition-colors hover:bg-brand-paper">
                <span className="min-w-0">
                  <Link href={`/crm/members/${member.id}`} className="block truncate text-crm-body font-semibold text-brand-ink">
                    {member.fullName}
                  </Link>
                  <span className={`block text-small font-semibold ${FEE_TONE[member.feeState].text}`}>
                    {member.daysAway === null ? t('attendance.absentNever') : t('attendance.absentSince', { count: member.daysAway })}
                  </span>
                </span>
                <a
                  href={`tel:${member.mobile}`}
                  className="flex min-h-14 shrink-0 items-center justify-center gap-2 rounded-panel bg-brand-obsidian px-4 text-crm-body font-semibold text-white"
                >
                  <CrmIcon name="calls" className="size-5" />
                  {t('profile.call')}
                </a>
              </li>
            ))}
          </ul>
        )
      ) : (
        <>
          <p className="px-4 pb-2 text-crm-body font-bold text-brand-obsidian">{t('attendance.todayCount', { count: events.length })}</p>
          {events.length === 0 ? (
            <p className="px-4 py-8 text-center text-crm-body text-brand-stone">{t('attendance.empty')}</p>
          ) : (
            <ul className="divide-y divide-brand-stone/15">
              {events.map((event) => (
                <li key={event.id} className="flex items-baseline justify-between gap-3 bg-white p-4">
                  <span className="min-w-0">
                    <Link href={`/crm/members/${event.memberId}`} className="block truncate text-crm-body font-semibold text-brand-ink">
                      {event.fullName}
                    </Link>
                    <span className="block text-small text-brand-stone">{event.memberCode ?? '—'}</span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <span className="text-small text-brand-stone">
                      {time(event.capturedAt)} · {t(`attendance.method${event.method}` as never)}
                    </span>
                    {event.feeState === 'PAID' ? null : (
                      <span className={cn('rounded-full px-2 py-0.5 text-small font-semibold', FEE_TONE[event.feeState].chip)}>
                        {event.feeState === 'NONE' || event.daysLeft === null
                          ? t(`feeState.${event.feeState}`)
                          : event.daysLeft < 0
                            ? t('feeState.overdue', { count: Math.abs(event.daysLeft) })
                            : event.daysLeft === 0
                              ? t('feeState.dueToday')
                              : t('feeState.daysLeft', { count: event.daysLeft })}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <BottomNav active="attendance" />
    </>
  );
}
