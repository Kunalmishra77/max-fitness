'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';

/**
 * "हाज़िरी लगाएँ" with an undo bar (crm-ux-blueprint §11).
 *
 * The wrong name gets tapped at a busy counter, so undo is part of the feature rather
 * than a repair: the bar sits at the bottom of the screen straight after the tap. Each
 * tap carries an id, so a double press is one visit and not two.
 */

export type MarkResult =
  | { ok: true; decision: 'RECORD'; eventId: string; callTaskRaised: boolean }
  | { ok: true; decision: 'WITHIN_COOLDOWN' | 'DUPLICATE_EVENT'; eventId: null }
  | { ok: false; code: 'FORBIDDEN' | 'NOT_FOUND' | 'generic' };

export type UndoResult = { ok: true } | { ok: false };

export function AttendanceMarker({
  memberId,
  name,
  mark,
  undo,
}: {
  memberId: string;
  name: string;
  mark: (memberId: string, clientEventId: string) => Promise<MarkResult>;
  undo: (eventId: string) => Promise<UndoResult>;
}) {
  const t = useTranslations('crm.attendance');
  const router = useRouter();
  const [state, setState] = useState<
    { kind: 'marked'; eventId: string; callTaskRaised: boolean } | { kind: 'already' } | { kind: 'failed'; message: string } | null
  >(null);
  const [pending, start] = useTransition();

  const onMark = () => {
    // A fresh id per tap: the server treats a repeat of the same id as the same visit.
    const clientEventId = crypto.randomUUID();
    start(async () => {
      const result = await mark(memberId, clientEventId);
      if (!result.ok) {
        setState({ kind: 'failed', message: result.code === 'FORBIDDEN' ? t('notAllowed') : t('failed') });
      } else if (result.decision === 'RECORD') {
        setState({ kind: 'marked', eventId: result.eventId, callTaskRaised: result.callTaskRaised });
        router.refresh();
      } else {
        setState({ kind: 'already' });
      }
    });
  };

  const onUndo = (eventId: string) => {
    start(async () => {
      const result = await undo(eventId);
      setState(result.ok ? null : { kind: 'failed', message: t('failed') });
      router.refresh();
    });
  };

  return (
    <>
      <button
        type="button"
        disabled={pending || state?.kind === 'marked'}
        onClick={onMark}
        className="min-h-14 shrink-0 rounded-panel bg-semantic-fee-paid px-4 text-crm-body font-semibold text-white disabled:opacity-50"
      >
        {pending ? t('marking') : state?.kind === 'marked' ? `✓ ${t('today')}` : t('mark')}
      </button>

      {state?.kind === 'already' ? (
        <p role="status" className="mt-2 basis-full text-crm-body text-brand-rubber-grey">
          {t('alreadyMarked', { name })}
        </p>
      ) : null}
      {state?.kind === 'failed' ? (
        <p role="alert" className="mt-2 basis-full text-crm-body font-medium text-semantic-fee-expired">
          {state.message}
        </p>
      ) : null}

      {state?.kind === 'marked' ? (
        <div role="status" className="fixed inset-x-0 bottom-20 z-30 mx-4 flex items-center justify-between gap-3 rounded-panel bg-brand-plate-navy p-4 text-white shadow-[var(--shadow-overlay)]">
          <span>
            <span className="block text-crm-body font-semibold">{t('marked', { name })}</span>
            {/* BR-9.3: the desk should know now, not tomorrow morning, that this one is worth a word. */}
            {state.callTaskRaised ? <span className="block text-small text-white/85">{t('callListed')}</span> : null}
          </span>
          <button type="button" disabled={pending} onClick={() => onUndo(state.eventId)} className="min-h-12 shrink-0 rounded-button bg-white px-4 text-crm-body font-bold text-brand-plate-navy">
            {t('undo')}
          </button>
        </div>
      ) : null}
    </>
  );
}
