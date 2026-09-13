'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';

/**
 * "What happened on the call?" (crm-ux-blueprint §8; BR-7).
 *
 * The six answers staff actually give, as six full-width buttons — no dropdown, no free
 * text required. The rules behind them (retry tomorrow, check back in two days, close
 * the task) live in the domain; this screen only reports what was said.
 */

export const CALL_OUTCOMES = ['WILL_RENEW', 'CALL_LATER', 'NO_ANSWER', 'DONE', 'WRONG_NUMBER', 'LEFT_GYM'] as const;
export type CallOutcomeChoice = (typeof CALL_OUTCOMES)[number];

export type OutcomeResult = { ok: true } | { ok: false };

export function CallOutcomeButtons({
  taskId,
  action,
}: {
  taskId: string;
  action: (taskId: string, outcome: CallOutcomeChoice) => Promise<OutcomeResult>;
}) {
  const t = useTranslations('crm.outcome');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const [pending, start] = useTransition();

  const choose = (outcome: CallOutcomeChoice) => {
    setFailed(false);
    start(async () => {
      const result = await action(taskId, outcome);
      if (result.ok) {
        setOpen(false);
        router.refresh();
      } else {
        setFailed(true);
      }
    });
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 min-h-14 w-full rounded-panel border-2 border-brand-rubber-grey/40 text-crm-body font-semibold text-brand-plate-navy"
      >
        {t('title')}
      </button>
    );
  }

  return (
    <div className="mt-3 rounded-panel bg-tint-fee-none-bg p-3">
      <p className="text-crm-body font-bold text-brand-plate-navy">{t('title')}</p>
      <div className="mt-3 grid gap-2">
        {CALL_OUTCOMES.map((outcome) => (
          <button
            key={outcome}
            type="button"
            disabled={pending}
            onClick={() => choose(outcome)}
            className="min-h-14 w-full rounded-panel bg-white text-crm-body font-semibold text-brand-ink disabled:opacity-60"
          >
            {t(outcome)}
          </button>
        ))}
      </div>
      {failed ? (
        <p role="alert" className="mt-3 rounded-input bg-tint-fee-expired-bg p-3 text-crm-body font-medium text-semantic-fee-expired">
          {t('failed')}
        </p>
      ) : null}
      <button type="button" onClick={() => setOpen(false)} className="mt-3 min-h-14 w-full text-crm-body font-semibold text-brand-rubber-grey">
        {t('cancel')}
      </button>
    </div>
  );
}
