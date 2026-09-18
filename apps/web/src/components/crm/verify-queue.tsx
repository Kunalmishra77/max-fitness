'use client';

import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useId, useState, useTransition } from 'react';
import { formatINR, formatISTDate, type ISTDate } from '@mfp/shared';

/**
 * "जाँचें" — members who sent their details by QR (crm-ux-blueprint §9; ADR-058).
 *
 * The reference code is large, so staff compare it with the one on the member's phone
 * before anything else. When the paper register has the member, both dates stand side by
 * side and the register's is chosen; staff can pick the member's, type another, or
 * reject with a reason. A decided card says what happened and leaves the list on refresh.
 */

export interface VerifyItem {
  readonly id: string;
  readonly referenceCode: string;
  readonly fullName: string;
  readonly mobileMasked: string;
  readonly photoUrl: string | null;
  readonly planMonths: number | null;
  readonly declaredEndDate: string;
  readonly declaredAmountPaise: number | null;
  readonly register: { readonly endDate: string; readonly planMonths: number | null } | null;
}

export type VerifyResult = { readonly ok: true } | { readonly ok: false; readonly code: 'CONFLICT' | 'VALIDATION_FAILED' | 'FORBIDDEN' | 'generic' };

type Approve = (id: string, change: { approvedEndDate?: string; planMonths?: number }) => Promise<VerifyResult>;
type Reject = (id: string, reason: string) => Promise<VerifyResult>;

export function VerifyQueue({ items, approve, reject }: { items: readonly VerifyItem[]; approve: Approve; reject: Reject }) {
  const t = useTranslations('crm.verify');
  // A decided request drops out of the server's list on the refresh that follows, but
  // its card stays until the page is left, so staff see what they just did.
  const [shown, setShown] = useState(items);
  const [lastItems, setLastItems] = useState(items);
  if (items !== lastItems) {
    setLastItems(items);
    const known = new Set(shown.map((item) => item.id));
    setShown([...shown, ...items.filter((item) => !known.has(item.id))]);
  }

  if (shown.length === 0) {
    return <p className="m-4 rounded-panel bg-white p-6 text-center text-crm-body text-brand-stone">{t('empty')}</p>;
  }
  return (
    <ul className="grid gap-3 p-4 pb-24">
      {shown.map((item) => (
        <li key={item.id}>
          <VerifyCard item={item} approve={approve} reject={reject} />
        </li>
      ))}
    </ul>
  );
}

function VerifyCard({ item, approve, reject }: { item: VerifyItem; approve: Approve; reject: Reject }) {
  const t = useTranslations('crm.verify');
  const locale = useLocale();
  const router = useRouter();
  const id = useId();
  const [chosen, setChosen] = useState(item.register?.endDate ?? item.declaredEndDate);
  const [mode, setMode] = useState<'idle' | 'date' | 'reject'>('idle');
  const [customDate, setCustomDate] = useState(chosen);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<'approved' | 'rejected' | null>(null);
  const [pending, start] = useTransition();
  const show = (date: string) => formatISTDate(date as ISTDate, locale);

  const run = (action: () => Promise<VerifyResult>, outcome: 'approved' | 'rejected') => {
    setError(null);
    start(async () => {
      const result = await action();
      if (result.ok) {
        setDone(outcome);
        router.refresh();
        return;
      }
      setError(
        result.code === 'CONFLICT'
          ? t('errors.conflict')
          : result.code === 'VALIDATION_FAILED'
            ? t('errors.invalid')
            : result.code === 'FORBIDDEN'
              ? t('errors.notAllowed')
              : t('errors.failed'),
      );
    });
  };

  const button = 'min-h-14 flex-1 rounded-panel px-3 text-crm-body font-bold disabled:opacity-50';

  return (
    <article aria-labelledby={`${id}-name`} className="rounded-panel bg-white p-4 shadow-sm">
      <div className="flex gap-4">
        {item.photoUrl === null ? (
          <span className="flex size-24 shrink-0 items-center justify-center rounded-panel bg-tint-fee-none-bg text-small text-brand-stone">{t('noPhoto')}</span>
        ) : (
          // A signed, short-lived URL to a private file: next/image would cache it.
          <img src={item.photoUrl} alt={item.fullName} width={96} height={96} className="size-24 shrink-0 rounded-panel object-cover" />
        )}
        <div className="min-w-0">
          <h2 id={`${id}-name`} className="text-crm-body font-bold text-brand-obsidian">
            {item.fullName}
          </h2>
          <p className="text-small text-brand-stone">{item.mobileMasked}</p>
          <p className="mt-1 text-small">{item.planMonths === null ? t('planUnknown') : t('plan', { count: item.planMonths })}</p>
          <p className="mt-2 inline-flex items-baseline gap-2 rounded-input bg-brand-obsidian px-3 py-1 text-white">
            <span className="text-small">{t('reference')}</span>
            <span className="font-display text-title font-bold tracking-wider">{item.referenceCode}</span>
          </p>
        </div>
      </div>

      {done !== null ? (
        <p role="status" className="mt-4 rounded-input bg-tint-fee-paid-bg p-3 text-crm-body font-semibold text-semantic-fee-paid">
          {done === 'approved' ? t('approved') : t('rejected')}
        </p>
      ) : (
        <>
          {item.register === null ? (
            <div className="mt-4">
              <p className="text-small font-semibold text-brand-stone">{t('declared')}</p>
              <p className="mt-1 rounded-input border-2 border-brand-obsidian px-4 py-3 text-center font-display text-display-m font-bold text-brand-obsidian">
                {show(item.declaredEndDate)}
              </p>
            </div>
          ) : (
            <fieldset className="mt-4 grid gap-2">
              <legend className="sr-only">{t('declared')}</legend>
              {(
                [
                  [item.register.endDate, t('inRegister')],
                  [item.declaredEndDate, t('memberSaid')],
                ] as const
              ).map(([date, label]) => (
                <label
                  key={label}
                  className={`flex min-h-14 items-center gap-3 rounded-input border-2 px-4 text-crm-body ${chosen === date ? 'border-brand-obsidian bg-tint-fee-none-bg font-bold' : 'border-brand-stone/30'}`}
                >
                  <input type="radio" name={`${id}-date`} checked={chosen === date} onChange={() => setChosen(date)} className="size-5 accent-brand-obsidian" />
                  {`${label}: ${show(date)}`}
                </label>
              ))}
            </fieldset>
          )}

          {item.declaredAmountPaise === null ? null : (
            <p className="mt-3 text-crm-body">
              {t('lastAmount')}: <span className="font-semibold">{formatINR(item.declaredAmountPaise, { showPaise: false })}</span>
            </p>
          )}

          {error === null ? null : (
            <p role="alert" className="mt-3 rounded-input bg-tint-fee-expired-bg p-3 text-crm-body font-medium text-semantic-fee-expired">
              {error}
            </p>
          )}

          {mode === 'date' ? (
            <div className="mt-4 grid gap-3">
              <div>
                <label htmlFor={`${id}-custom`} className="block text-crm-body font-semibold">
                  {t('dateLabel')}
                </label>
                <input
                  id={`${id}-custom`}
                  type="date"
                  value={customDate}
                  onChange={(event) => setCustomDate(event.target.value)}
                  className="mt-1 min-h-14 w-full rounded-input border-2 border-brand-stone/40 bg-white px-4 text-crm-body"
                />
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={pending || customDate === ''}
                  onClick={() => run(() => approve(item.id, { approvedEndDate: customDate }), 'approved')}
                  className={`${button} bg-semantic-fee-paid text-white`}
                >
                  {t('approveWithDate')}
                </button>
                <button type="button" onClick={() => setMode('idle')} className={`${button} text-brand-stone`}>
                  {t('cancel')}
                </button>
              </div>
            </div>
          ) : mode === 'reject' ? (
            <div className="mt-4 grid gap-3">
              <div>
                <label htmlFor={`${id}-reason`} className="block text-crm-body font-semibold">
                  {t('reason')}
                </label>
                <input
                  id={`${id}-reason`}
                  type="text"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  className="mt-1 min-h-14 w-full rounded-input border-2 border-brand-stone/40 bg-white px-4 text-crm-body"
                />
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={pending || reason.trim() === ''}
                  onClick={() => run(() => reject(item.id, reason.trim()), 'rejected')}
                  className={`${button} bg-semantic-fee-expired text-white`}
                >
                  {t('reject')}
                </button>
                <button type="button" onClick={() => setMode('idle')} className={`${button} text-brand-stone`}>
                  {t('cancel')}
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={pending}
                onClick={() => run(() => approve(item.id, { approvedEndDate: chosen }), 'approved')}
                className={`${button} bg-semantic-fee-paid text-white`}
              >
                {t('correct')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setCustomDate(chosen);
                  setMode('date');
                }}
                className={`${button} border-2 border-brand-obsidian text-brand-obsidian`}
              >
                {t('changeDate')}
              </button>
              <button type="button" onClick={() => setMode('reject')} className={`${button} border-2 border-semantic-fee-expired text-semantic-fee-expired`}>
                {t('notRight')}
              </button>
            </div>
          )}
        </>
      )}
    </article>
  );
}
