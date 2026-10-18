import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { can, MAX_RANGE_DAYS, readReportPeriod } from '@mfp/core';
import { recordCallOutcomeAction } from '@/app/crm/actions';
import { CallOutcomeButtons } from '@/components/crm/call-outcome';
import { AutoRefresh } from '@/components/crm/auto-refresh';
import { BottomNav, CrmHeader, CRM_CARD, FEE_TONE, pillClass } from '@/components/crm/crm-chrome';
import { CrmIcon } from '@/components/crm/crm-icons';
import { PeriodPicker } from '@/components/crm/period-picker';
import { cn } from '@/lib/cn';
import { getContainer } from '@/lib/container';
import { requireCrmContext } from '@/lib/crm';

/**
 * Calls (crm-ux-blueprint §8; REP-004).
 *
 * **Two questions, two tabs.** *"Who do I ring now"* is the morning's work: most urgent
 * first, the one reason each is on the list, and the six answers to "what happened?".
 * A task leaves it the moment it is closed.
 *
 * *"What came of the ringing"* had no answer at all. A closed task was never seen again,
 * so nobody could say who was called last week, what they said, or whether the list is
 * worth anybody's morning. That is what **Done** is: the calls that were made over a
 * window, how each ended, and who made them.
 *
 * The outcome counts come first, because they are the finding. "Forty calls" says
 * nothing; "forty calls, twenty-six no answer" says the numbers on file are wrong, and
 * "forty calls, eighteen will renew" says the list pays for itself.
 */

export const dynamic = 'force-dynamic';

/** The outcomes worth a tile of their own, best news first. */
const OUTCOMES = ['WILL_RENEW', 'CALL_LATER', 'NO_ANSWER', 'WRONG_NUMBER', 'LEFT_GYM', 'DONE'] as const;

const OUTCOME_TONE: Record<string, string> = {
  WILL_RENEW: FEE_TONE.PAID.text,
  DONE: FEE_TONE.PAID.text,
  CALL_LATER: FEE_TONE.DUE_SOON.text,
  NO_ANSWER: FEE_TONE.DUE_SOON.text,
  WRONG_NUMBER: FEE_TONE.EXPIRED.text,
  LEFT_GYM: FEE_TONE.EXPIRED.text,
};

export default async function CrmCallsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; period?: string; from?: string; to?: string; outcome?: string }>;
}) {
  const { actor, gym, today, reader } = await requireCrmContext();
  const t = await getTranslations('crm');
  const { tab, period, from, to, outcome } = await searchParams;
  const done = tab === 'done';
  const mayRecord = can(actor, 'call.outcome', getContainer().clock.now());

  // The same reader the reports use, so a week means the same week on both screens.
  const chosen = readReportPeriod({ period, from, to }, today);
  const onlyOutcome = (OUTCOMES as readonly string[]).includes(outcome ?? '') ? outcome : undefined;

  const [tasks, history, counts] = await Promise.all([
    done ? Promise.resolve([]) : reader.callTasks(gym.id, today, 50),
    done ? reader.callHistory(gym.id, chosen.bounds, { ...(onlyOutcome === undefined ? {} : { outcome: onlyOutcome }) }) : Promise.resolve([]),
    done ? reader.callOutcomeCounts(gym.id, chosen.bounds) : Promise.resolve<Record<string, number>>({}),
  ]);

  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  const tabHref = (key: 'today' | 'done') => (key === 'today' ? '/crm/calls' : '/crm/calls?tab=done');

  return (
    <>
      {/* The engine adds tasks while the list is open (ADR-092). */}
      {done ? null : <AutoRefresh seconds={60} />}
      <CrmHeader title={t('calls.title')} subtitle={t('menu.calls.desc')} back="/crm" />

      <div className="flex flex-wrap gap-2 px-4 py-3 lg:px-0">
        <Link href={tabHref('today')} className={pillClass(!done)}>
          {t('calls.tabToday')}
        </Link>
        <Link href={tabHref('done')} className={pillClass(done)}>
          {t('calls.tabDone')}
        </Link>
      </div>

      {done ? (
        <div className="grid gap-3">
          <div className="px-4 lg:px-0">
            <PeriodPicker
              basePath="/crm/calls"
              period={chosen.period}
              from={from}
              to={to}
              extra={{ tab: 'done' }}
              problem={chosen.problem}
              maxDays={MAX_RANGE_DAYS}
            />
          </div>

          {/* The finding, before the list of it. */}
          <section className={cn(CRM_CARD, 'mx-4 p-4 lg:mx-0')} aria-label={t('calls.outcomeSummary')}>
            <p className="text-small text-brand-stone">{t('calls.madeInPeriod', { count: total })}</p>
            <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-3">
              {OUTCOMES.filter((key) => (counts[key] ?? 0) > 0).map((key) => (
                <li key={key}>
                  <Link href={`/crm/calls?tab=done&outcome=${key}`} className="block">
                    <span className={cn('block font-display text-[1.75rem] leading-none font-bold tabular', OUTCOME_TONE[key])}>{counts[key]}</span>
                    <span className="mt-1 block text-small text-brand-stone">{t(`calls.outcomes.${key}` as never)}</span>
                  </Link>
                </li>
              ))}
              {(counts['UNRECORDED'] ?? 0) === 0 ? null : (
                <li>
                  <span className="block font-display text-[1.75rem] leading-none font-bold tabular text-brand-stone">{counts['UNRECORDED']}</span>
                  <span className="mt-1 block text-small text-brand-stone">{t('calls.outcomes.UNRECORDED')}</span>
                </li>
              )}
            </ul>
            {onlyOutcome === undefined ? null : (
              <Link href="/crm/calls?tab=done" className="mt-3 inline-flex min-h-11 items-center text-body font-semibold text-brand-link">
                {t('calls.showAllOutcomes')}
              </Link>
            )}
          </section>

          {history.length === 0 ? (
            <p className="px-4 py-10 text-center text-crm-body text-brand-stone">{t('calls.noneDone')}</p>
          ) : (
            <ul className={cn(CRM_CARD, 'mx-4 overflow-hidden lg:mx-0')}>
              {history.map((call) => (
                <li key={call.id} className="border-b border-brand-stone/10 px-4 py-3 last:border-0">
                  <div className="flex items-baseline justify-between gap-3">
                    {call.member === null ? (
                      <span className="truncate text-crm-body font-semibold text-brand-ink">—</span>
                    ) : (
                      <Link href={`/crm/members/${call.member.id}`} className="truncate text-crm-body font-semibold text-brand-ink hover:underline">
                        {call.member.fullName}
                      </Link>
                    )}
                    <span className={cn('shrink-0 text-small font-semibold', OUTCOME_TONE[call.outcome ?? ''] ?? 'text-brand-stone')}>
                      {call.outcome === null ? t('calls.outcomes.UNRECORDED') : t(`calls.outcomes.${call.outcome}` as never)}
                    </span>
                  </div>
                  <p className="mt-0.5 text-small text-brand-stone">
                    {t(`calls.reasons.${call.reason}` as never)}
                    {call.doneAt === null ? '' : ` — ${new Intl.DateTimeFormat(actor.language === 'hi' ? 'hi-IN' : 'en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }).format(call.doneAt)}`}
                    {call.doneBy === null ? '' : ` · ${call.doneBy}`}
                    {call.attempts > 1 ? ` · ${t('calls.attempts', { count: call.attempts })}` : ''}
                  </p>
                  {call.note === null || call.note === '' ? null : (
                    <p className="mt-1.5 rounded-input bg-brand-paper px-3 py-2 text-small text-brand-ink">{call.note}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : tasks.length === 0 ? (
        <p className="px-4 py-10 text-center text-crm-body text-brand-stone">{t('calls.empty')}</p>
      ) : (
        <ul className="divide-y divide-brand-stone/15 lg:divide-y-0">
          {tasks.map((task) => (
            <li key={task.id} className="bg-white p-4 lg:mb-3 lg:rounded-panel lg:border lg:border-brand-stone/12">
              <div className="flex items-baseline justify-between gap-3">
                {task.member === null ? (
                  <span className="truncate text-crm-body font-semibold">—</span>
                ) : (
                  <Link href={`/crm/members/${task.member.id}`} className="truncate text-crm-body font-semibold text-brand-ink hover:underline">
                    {task.member.fullName}
                  </Link>
                )}
                <span className={`shrink-0 rounded-button px-2 py-1 text-small font-semibold ${FEE_TONE[task.member?.feeState ?? 'NONE'].chip}`}>
                  {t(`calls.reasons.${task.reason}` as never)}
                </span>
              </div>
              {task.member === null ? null : (
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <a href={`tel:${task.member.mobile}`} className="flex min-h-14 items-center justify-center gap-2 rounded-panel bg-brand-obsidian text-crm-body font-semibold text-white">
                    <CrmIcon name="calls" className="size-5" />
                    {t('profile.call')}
                  </a>
                  {/* Their thread in Max Register, not WhatsApp on the staff phone — the
                      same reasoning as ADR-126, which only reached the member profile. */}
                  <Link
                    href={`/crm/messages?member=${task.member.id}`}
                    className="flex min-h-14 items-center justify-center gap-2 rounded-panel border-2 border-brand-obsidian text-crm-body font-semibold text-brand-obsidian transition-colors hover:bg-brand-obsidian hover:text-brand-white"
                  >
                    <CrmIcon name="whatsapp" className="size-5" />
                    {t('profile.whatsapp')}
                  </Link>
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

