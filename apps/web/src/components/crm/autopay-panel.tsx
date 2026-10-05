'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { cn } from '@/lib/cn';

/**
 * A member's standing instruction, on their profile (ADR-105).
 *
 * The panel is built around one question the desk actually gets asked: **is this member's
 * fee going to arrive by itself?** So the status line is the loudest thing in it, and the
 * one status that matters most — halted — is the one that looks wrong, because a halted
 * mandate is otherwise invisible: the member still shows as paid up and nothing else about
 * their record has changed.
 *
 * A mandate that has been created but not authorised shows its link rather than a tick. The
 * member has not signed anything yet, and saying they have is the mistake that would stop
 * the gym chasing a fee that is never coming.
 */

export type AutopayResult =
  | { ok: true; status: string; shortUrl: string | null; firstChargeOn: string | null; alreadyLive: boolean }
  | { ok: false; code: 'FORBIDDEN' | 'UNAVAILABLE' | 'NO_PLAN' | 'NOT_FOUND' | 'INTERNAL' };

export interface AutopayView {
  readonly id: string;
  readonly status: string;
  readonly amount: string;
  readonly intervalMonths: number;
  readonly shortUrl: string | null;
  readonly nextChargeOn: string | null;
  readonly chargeCount: number;
  readonly authorised: boolean;
}

/** Which statuses read as good, which as a problem, and which as "not yet". */
const TONE: Readonly<Record<string, 'live' | 'waiting' | 'problem' | 'done'>> = {
  ACTIVE: 'live',
  AUTHENTICATED: 'live',
  PENDING: 'waiting',
  CREATED: 'waiting',
  HALTED: 'problem',
  PAUSED: 'problem',
  CANCELLED: 'done',
  COMPLETED: 'done',
  EXPIRED: 'done',
};

const CHIP: Readonly<Record<'live' | 'waiting' | 'problem' | 'done', string>> = {
  live: 'bg-semantic-fee-paid text-white',
  waiting: 'bg-tint-fee-due-bg text-semantic-fee-due',
  problem: 'bg-semantic-fee-expired text-white',
  done: 'bg-tint-fee-none-bg text-brand-stone',
};

export function AutopayPanel({
  memberId,
  mandate,
  canManage,
  available,
  onStart,
  onCancel,
}: {
  memberId: string;
  mandate: AutopayView | null;
  canManage: boolean;
  /** False in DEMO_MODE, where there is no gateway to make a real mandate with. */
  available: boolean;
  onStart: (memberId: string) => Promise<AutopayResult>;
  onCancel: (memberId: string, mandateId: string) => Promise<AutopayResult>;
}) {
  const t = useTranslations('crm.autopay');
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();

  const run = (work: () => Promise<AutopayResult>) => {
    setError(null);
    start(async () => {
      const result = await work();
      if (result.ok) {
        setConfirming(false);
        if (result.shortUrl !== null) setLink(result.shortUrl);
        router.refresh();
      } else {
        setError(
          result.code === 'FORBIDDEN'
            ? t('notAllowed')
            : result.code === 'UNAVAILABLE'
              ? t('unavailable')
              : result.code === 'NO_PLAN'
                ? t('noPlan')
                : t('failed'),
        );
      }
    });
  };

  const tone = mandate === null ? 'done' : (TONE[mandate.status] ?? 'done');
  const shownLink = link ?? mandate?.shortUrl ?? null;

  return (
    <section className="mt-3 bg-white px-4 py-4 lg:rounded-panel lg:border lg:border-brand-stone/15 lg:px-6 lg:shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-crm-body font-bold text-brand-obsidian">{t('title')}</h2>
        {mandate === null ? null : (
          <span className={cn('rounded-full px-2.5 py-0.5 text-small font-semibold', CHIP[tone])}>{t(`status.${mandate.status}` as never)}</span>
        )}
      </div>

      {mandate === null ? (
        <p className="mt-2 text-crm-body text-brand-stone">{t('none')}</p>
      ) : (
        <dl className="mt-3 space-y-2">
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-small text-brand-stone">{t('amount')}</dt>
            <dd className="text-crm-body font-semibold text-brand-obsidian">
              {t('everyMonths', { amount: mandate.amount, count: mandate.intervalMonths })}
            </dd>
          </div>
          {mandate.nextChargeOn === null ? null : (
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-small text-brand-stone">{mandate.authorised ? t('nextCharge') : t('firstCharge')}</dt>
              <dd className="text-crm-body font-semibold text-brand-obsidian">{mandate.nextChargeOn}</dd>
            </div>
          )}
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-small text-brand-stone">{t('taken')}</dt>
            <dd className="text-crm-body text-brand-obsidian">{t('takenCount', { count: mandate.chargeCount })}</dd>
          </div>
        </dl>
      )}

      {/* The one status worth explaining on the screen rather than leaving as a word. */}
      {mandate?.status === 'HALTED' ? <p className="mt-3 rounded-input bg-tint-fee-expired-bg px-3 py-2 text-crm-body text-semantic-fee-expired">{t('haltedHelp')}</p> : null}
      {mandate !== null && !mandate.authorised ? <p className="mt-3 text-crm-body text-brand-stone">{t('notAuthorisedHelp')}</p> : null}

      {shownLink === null ? null : (
        <div className="mt-3">
          <p className="text-small text-brand-stone">{t('linkLabel')}</p>
          <a
            href={shownLink}
            target="_blank"
            rel="noreferrer noopener"
            className="mt-1 block min-h-[56px] break-all rounded-input border border-brand-stone/25 px-3 py-3 text-crm-body font-semibold text-brand-crimson underline decoration-brand-crimson/40 underline-offset-2"
          >
            {shownLink}
          </a>
        </div>
      )}

      {error === null ? null : (
        <p role="alert" className="mt-3 text-crm-body font-semibold text-semantic-fee-expired">
          {error}
        </p>
      )}

      {!canManage ? null : !available ? (
        <p className="mt-3 text-crm-body text-brand-stone">{t('unavailable')}</p>
      ) : (
        <div className="mt-4 flex flex-wrap gap-2">
          {mandate === null || tone === 'done' || tone === 'problem' ? (
            <button
              type="button"
              onClick={() => run(() => onStart(memberId))}
              disabled={pending}
              className="min-h-[56px] flex-1 rounded-input bg-brand-crimson px-4 text-crm-body font-bold text-white disabled:opacity-60"
            >
              {pending ? t('working') : mandate === null ? t('setUp') : t('setUpAgain')}
            </button>
          ) : confirming ? (
            <>
              <button
                type="button"
                onClick={() => run(() => onCancel(memberId, mandate.id))}
                disabled={pending}
                className="min-h-[56px] flex-1 rounded-input bg-semantic-fee-expired px-4 text-crm-body font-bold text-white disabled:opacity-60"
              >
                {pending ? t('working') : t('confirmStop')}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={pending}
                className="min-h-[56px] flex-1 rounded-input border border-brand-stone/25 px-4 text-crm-body font-semibold text-brand-obsidian"
              >
                {t('keep')}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="min-h-[56px] flex-1 rounded-input border border-brand-stone/25 px-4 text-crm-body font-semibold text-brand-obsidian"
            >
              {t('stop')}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
