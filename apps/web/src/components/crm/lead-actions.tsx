'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useId, useState, useTransition } from 'react';
import type { LeadStatus } from '@mfp/core';

/**
 * Moving one enquiry along (BR-10.1; crm-ux-blueprint §12).
 *
 * Only the statuses this enquiry can still reach are offered — an enquiry does not go
 * backwards, so the screen does not pretend it can. The note is optional: at a busy
 * desk, "बात हो गई" with nothing typed is still worth recording.
 */

export type LeadResult = { ok: true } | { ok: false; code: 'FORBIDDEN' | 'CONFLICT' | 'generic' };

const PIPELINE: readonly LeadStatus[] = ['NEW', 'CONTACTED', 'TRIAL_BOOKED', 'VISITED'];

export function LeadActions({
  leadId,
  status,
  action,
}: {
  leadId: string;
  status: LeadStatus;
  action: (leadId: string, to: LeadStatus, note: string) => Promise<LeadResult>;
}) {
  const t = useTranslations('crm.leads');
  const router = useRouter();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const index = PIPELINE.indexOf(status);
  const targets: readonly LeadStatus[] = [...PIPELINE.slice(index + 1), 'CONVERTED', 'LOST'];

  const choose = (to: LeadStatus) => {
    setError(null);
    start(async () => {
      const result = await action(leadId, to, note.trim());
      if (result.ok) {
        setOpen(false);
        setNote('');
        router.refresh();
      } else {
        setError(result.code === 'FORBIDDEN' ? t('notAllowed') : t('failed'));
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
        {t('action')}
      </button>
    );
  }

  return (
    <div className="mt-3 rounded-panel bg-tint-fee-none-bg p-3">
      <p className="text-crm-body font-bold text-brand-plate-navy">{t('moveTo')}</p>

      <label htmlFor={`${id}-note`} className="mt-3 block text-small font-semibold text-brand-rubber-grey">
        {t('note')}
      </label>
      <input
        id={`${id}-note`}
        type="text"
        value={note}
        onChange={(event) => setNote(event.target.value)}
        className="mt-1 min-h-14 w-full rounded-input border-2 border-brand-rubber-grey/40 bg-white px-4 text-crm-body"
      />

      <div className="mt-3 grid gap-2">
        {targets.map((target) => (
          <button
            key={target}
            type="button"
            disabled={pending}
            onClick={() => choose(target)}
            className="min-h-14 w-full rounded-panel bg-white text-crm-body font-semibold text-brand-ink disabled:opacity-60"
          >
            {t(target)}
          </button>
        ))}
      </div>

      {error === null ? null : (
        <p role="alert" className="mt-3 rounded-input bg-tint-fee-expired-bg p-3 text-crm-body font-medium text-semantic-fee-expired">
          {error}
        </p>
      )}

      <button type="button" onClick={() => setOpen(false)} className="mt-3 min-h-14 w-full text-crm-body font-semibold text-brand-rubber-grey">
        {t('cancel')}
      </button>
    </div>
  );
}
