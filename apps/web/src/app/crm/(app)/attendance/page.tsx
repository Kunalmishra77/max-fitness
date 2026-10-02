import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { can } from '@mfp/core';
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
 * Attendance — "हाज़िरी" (crm-ux-blueprint §11).
 *
 * Until the kiosk exists every visit is marked here, so the search box and the mark
 * button come first; today's list is underneath, newest at the top, and the "नहीं आ रहे"
 * tab is the one worth calling — members who have paid but stopped coming.
 */

export const dynamic = 'force-dynamic';

export default async function CrmAttendancePage({ searchParams }: { searchParams: Promise<{ q?: string; tab?: string }> }) {
  const { actor, gym, today, reader } = await requireCrmContext();
  const t = await getTranslations('crm');
  const { clock } = getContainer();
  const { q, tab } = await searchParams;

  const mayMark = can(actor, 'attendance.manual', clock.now());
  const search = (q ?? '').trim();
  const absent = tab === 'absent';

  // Both tabs are counted whichever is open: a tab label that says how many is the
  // difference between reception checking and reception knowing (ADR-097).
  const [events, absentMembers, matches] = await Promise.all([
    reader.attendanceToday(gym.id, today),
    reader.absentMembers(gym.id, today, gym.settings.attendance.absentDaysThreshold),
    search === '' ? Promise.resolve([]) : reader.members(gym.id, today, { search, limit: 10 }),
  ]);

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
      </div>

      {absent ? (
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
