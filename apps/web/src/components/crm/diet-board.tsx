'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useMemo, useState, useTransition } from 'react';
import type { DietSkipReason } from '@mfp/core';
import { CRM_CARD } from '@/components/crm/crm-chrome';
import { cn } from '@/lib/cn';

/**
 * The diet plans screen (ADR-089).
 *
 * Two jobs on one screen, because they are the same job on different days: pick members and
 * ask them, and watch what came back. The list puts whoever we are waiting on at the top —
 * those are the ones where somebody may need to step in — and says plainly when a plan
 * failed and why, rather than leaving a blank where a plan should be.
 *
 * Nothing here generates a plan on its own. The questions go out, the member answers, and
 * the plan is written when there is enough to write one.
 */

export type DietStartOutcome =
  | { ok: true; started: number; skipped: ReadonlyArray<{ memberId: string; reason: DietSkipReason }> }
  | { ok: false; code: 'FORBIDDEN' | 'generic' };

export interface DietRow {
  readonly memberId: string;
  readonly fullName: string;
  readonly memberCode: string | null;
  readonly version: number | null;
  readonly planStatus: string | null;
  readonly failureReason: string | null;
  readonly goal: string | null;
  readonly dietType: string | null;
  readonly bmi: string | null;
  readonly generatedOn: string | null;
  readonly pendingQuestion: string | null;
}

export interface DietCandidate {
  readonly memberId: string;
  readonly fullName: string;
  readonly memberCode: string | null;
}

export function DietBoard({
  rows,
  candidates,
  aiReady,
  start,
  regenerate,
}: {
  readonly rows: readonly DietRow[];
  /** Active members who could be asked — the picker's list. */
  readonly candidates: readonly DietCandidate[];
  /** False when no AI key is configured: the screen says so instead of failing later. */
  readonly aiReady: boolean;
  readonly start: (memberIds: readonly string[]) => Promise<DietStartOutcome>;
  readonly regenerate: (memberId: string) => Promise<DietStartOutcome>;
}) {
  const t = useTranslations('crm.diet');
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<readonly string[]>([]);
  const [outcome, setOutcome] = useState<DietStartOutcome | null>(null);
  const [pending, begin] = useTransition();

  const found = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = needle === '' ? candidates : candidates.filter((c) => c.fullName.toLowerCase().includes(needle) || (c.memberCode ?? '').toLowerCase().includes(needle));
    return list.slice(0, 40);
  }, [candidates, query]);

  const toggle = (memberId: string) =>
    setPicked((current) => (current.includes(memberId) ? current.filter((id) => id !== memberId) : [...current, memberId]));

  const ask = () =>
    begin(async () => {
      const result = await start(picked);
      setOutcome(result);
      if (result.ok) setPicked([]);
    });

  const statusOf = (row: DietRow) => {
    if (row.pendingQuestion !== null) return { text: t('waitingOn', { question: t(`questions.${row.pendingQuestion}` as never) }), tone: 'bg-tint-fee-due-soon-bg text-semantic-fee-due-soon' };
    if (row.planStatus === 'READY') return { text: t('ready', { version: row.version ?? 1 }), tone: 'bg-tint-fee-paid-bg text-semantic-fee-paid' };
    if (row.planStatus === 'GENERATING') return { text: t('writing'), tone: 'bg-tint-fee-none-bg text-brand-stone' };
    if (row.planStatus === 'FAILED') {
      const reason = row.failureReason ?? 'generic';
      return { text: t('failed', { reason: t(`reasons.${reason}` as never) }), tone: 'bg-tint-fee-expired-bg text-semantic-fee-expired' };
    }
    if (row.planStatus === 'SUPERSEDED') return { text: t('superseded'), tone: 'bg-tint-fee-none-bg text-brand-stone' };
    return { text: t('nothingYet'), tone: 'bg-tint-fee-none-bg text-brand-stone' };
  };

  return (
    <div className="grid gap-3">
      {aiReady ? null : (
        <p role="status" className={cn(CRM_CARD, 'bg-tint-fee-due-soon-bg p-4 text-crm-body font-semibold text-semantic-fee-due-soon')}>
          {t('noKey')}
        </p>
      )}

      <section className={cn(CRM_CARD, 'p-4')} aria-labelledby="diet-ask">
        <h2 id="diet-ask" className="text-crm-body font-bold text-brand-obsidian">
          {t('askTitle')}
        </h2>
        <p className="mt-1 text-small text-brand-stone">{t('askHelp')}</p>

        <label className="mt-3 block">
          <span className="sr-only">{t('search')}</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('search')}
            className="min-h-14 w-full rounded-input border-2 border-brand-stone/40 bg-white px-4 text-crm-body"
          />
        </label>

        <ul className="mt-3 grid max-h-72 gap-1 overflow-y-auto">
          {found.map((candidate) => (
            <li key={candidate.memberId}>
              <label className="flex min-h-14 cursor-pointer items-center gap-3 rounded-input px-2 hover:bg-brand-paper">
                <input
                  type="checkbox"
                  checked={picked.includes(candidate.memberId)}
                  onChange={() => toggle(candidate.memberId)}
                  className="size-6 shrink-0 accent-brand-accent"
                />
                <span className="min-w-0 flex-1 truncate text-crm-body text-brand-obsidian">{candidate.fullName}</span>
                <span className="shrink-0 text-small text-brand-stone">{candidate.memberCode ?? '—'}</span>
              </label>
            </li>
          ))}
          {found.length === 0 ? <li className="px-2 py-4 text-crm-body text-brand-stone">{t('noneFound')}</li> : null}
        </ul>

        <button
          type="button"
          disabled={pending || picked.length === 0}
          onClick={ask}
          className="mt-3 min-h-16 w-full rounded-panel bg-brand-accent text-crm-body font-bold text-brand-white disabled:opacity-50"
        >
          {pending ? t('asking') : t('ask', { count: picked.length })}
        </button>

        {outcome === null ? null : outcome.ok ? (
          <p role="status" className="mt-3 rounded-input bg-tint-fee-paid-bg p-3 text-crm-body font-semibold text-semantic-fee-paid">
            {t('asked', { count: outcome.started })}
            {outcome.skipped.length === 0 ? '' : ` ${t('skipped', { count: outcome.skipped.length })}`}
          </p>
        ) : (
          <p role="alert" className="mt-3 rounded-input bg-tint-fee-expired-bg p-3 text-crm-body font-semibold text-semantic-fee-expired">
            {t(`errors.${outcome.code}` as never)}
          </p>
        )}
      </section>

      <section className={cn(CRM_CARD, 'overflow-hidden')} aria-labelledby="diet-list">
        <h2 id="diet-list" className="border-b border-brand-stone/15 px-4 py-3 text-crm-body font-bold text-brand-obsidian">
          {t('listTitle')}
        </h2>
        {rows.length === 0 ? (
          <p className="px-4 py-8 text-center text-crm-body text-brand-stone">{t('listEmpty')}</p>
        ) : (
          <ul>
            {rows.map((row) => {
              const status = statusOf(row);
              return (
                <li key={row.memberId} className="flex flex-wrap items-center gap-3 border-b border-brand-stone/15 px-4 py-3 last:border-0">
                  <Link href={`/crm/members/${row.memberId}`} className="min-w-0 flex-1">
                    <span className="block truncate text-crm-body font-semibold text-brand-obsidian">{row.fullName}</span>
                    <span className="block truncate text-small text-brand-stone">
                      {[row.memberCode, row.goal === null ? null : t(`goals.${row.goal}` as never), row.bmi === null ? null : t('bmi', { value: row.bmi })]
                        .filter((part) => part !== null && part !== '')
                        .join(' · ')}
                    </span>
                  </Link>
                  <span className={cn('shrink-0 rounded-full px-3 py-1 text-small font-semibold', status.tone)}>{status.text}</span>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => begin(async () => setOutcome(await regenerate(row.memberId)))}
                    className="min-h-11 shrink-0 rounded-button border-2 border-brand-stone/40 px-3 text-small font-semibold text-brand-obsidian disabled:opacity-50"
                  >
                    {row.planStatus === null ? t('generate') : t('again')}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
