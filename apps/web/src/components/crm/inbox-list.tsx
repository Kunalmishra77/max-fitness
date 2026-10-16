'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { formatISTDate, toISTDate } from '@mfp/shared';
import { cn } from '@/lib/cn';
import { CrmIcon } from './crm-icons';

/**
 * The people the gym has written to, newest first (ADR-091, ADR-128).
 *
 * **Sorted by who needs a person, not by who is newest.** A member who wrote back sits
 * at the top however long ago it was, because a reminder that went out on schedule needs
 * nobody and a question does. That is the one thing this list is for.
 *
 * The search filters what is already loaded rather than asking the server. The gym has
 * tens of conversations, not thousands, and a box that answers as you type beats one
 * that is correct a round trip later.
 */

export interface InboxRow {
  readonly memberId: string;
  readonly memberName: string | null;
  /** ISO instant. */
  readonly lastAt: string;
  readonly lastPreview: string | null;
  readonly lastDirection: 'OUTBOUND' | 'INBOUND';
  readonly messages: number;
  readonly hasInbound: boolean;
  readonly photoUrl: string | null;
}

export function InboxList({ rows, selected }: { rows: readonly InboxRow[]; selected: string | null }) {
  const t = useTranslations('crm.messages');
  const locale = useLocale();
  const [query, setQuery] = useState('');

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === '') return rows;
    return rows.filter(
      (row) => (row.memberName ?? '').toLowerCase().includes(needle) || (row.lastPreview ?? '').toLowerCase().includes(needle),
    );
  }, [rows, query]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-brand-stone/15 p-3">
        <label className="relative block">
          <span className="sr-only">{t('searchPeople')}</span>
          <CrmIcon name="search" className="pointer-events-none absolute top-1/2 start-3 size-5 -translate-y-1/2 text-brand-stone" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('searchPeople')}
            className="min-h-12 w-full rounded-input border border-brand-stone/25 bg-white ps-11 pe-3 text-crm-body text-brand-ink placeholder:text-brand-stone focus:border-brand-accent focus:outline-2 focus:outline-offset-2 focus:outline-semantic-focus-ring"
          />
        </label>
      </div>

      {shown.length === 0 ? (
        <p className="p-6 text-center text-crm-body text-brand-stone">{query === '' ? t('noPeople') : t('noMatch')}</p>
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {shown.map((row) => {
            const active = row.memberId === selected;
            return (
              <li key={row.memberId}>
                <Link
                  href={`/crm/messages?member=${row.memberId}`}
                  aria-current={active ? 'true' : undefined}
                  className={cn(
                    'flex min-h-20 items-center gap-3 border-b border-brand-stone/10 px-3 py-3 transition-colors',
                    active ? 'bg-brand-paper' : 'hover:bg-brand-paper/60',
                  )}
                >
                  {row.photoUrl === null ? (
                    <span className="grid size-12 shrink-0 place-items-center rounded-full bg-brand-stone/15 text-brand-stone">
                      <CrmIcon name="members" className="size-6" />
                    </span>
                  ) : (
                    // A signed link that lapses in five minutes; nothing for the optimiser to cache.
                    <img src={row.photoUrl} alt="" width={48} height={48} className="size-12 shrink-0 rounded-full object-cover" />
                  )}

                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className="min-w-0 flex-1 truncate text-crm-body font-semibold text-brand-obsidian">
                        {row.memberName ?? t('unknownMember')}
                      </span>
                      <span className="shrink-0 text-small text-brand-stone">{formatISTDate(toISTDate(new Date(row.lastAt)), locale)}</span>
                    </span>
                    <span className="mt-0.5 flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-small text-brand-stone">
                        {/* Their words are the ones worth reading; ours are a template they
                            have already had. The arrow marks whose turn it was. */}
                        {row.lastDirection === 'INBOUND' ? '↩ ' : ''}
                        {row.lastPreview ?? t('noPreview')}
                      </span>
                      {row.hasInbound ? (
                        <span className="shrink-0 rounded-full bg-brand-accent px-2 py-0.5 text-small font-bold text-brand-white">
                          {t('replied')}
                        </span>
                      ) : (
                        <span className="shrink-0 text-small tabular text-brand-stone">{row.messages}</span>
                      )}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
