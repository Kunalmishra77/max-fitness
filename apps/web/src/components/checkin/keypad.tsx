'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';

/**
 * The reception tablet's keypad (BR-9.4; attendance spec §6 "Keypad").
 *
 * Used standing up, in a hurry, often with a queue behind — and by people who will
 * never read an instruction. So: big keys, one obvious next step, and never a button
 * that appears to have done nothing. "Already marked in" is a real answer and is said
 * out loud, because silence reads as a broken screen and the member taps again.
 *
 * It also says nothing it should not. A member whose fees have run out is sent to the
 * desk; what they owe is discussed there, not on a screen the next person in the
 * queue is reading over their shoulder (BR-9.3).
 */

export interface CheckInCandidateView {
  readonly memberId: string;
  readonly fullName: string;
  readonly photoUrl: string | null;
}

export type LookupResult = { ok: true; candidates: CheckInCandidateView[] } | { ok: false };
export type MarkResult =
  | { ok: true; decision: string; greeting: { kind: string; tone: string; daysLeft?: number } | null; memberName: string | null }
  | { ok: false };

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'] as const;

export function CheckInKeypad({
  lookup,
  mark,
}: {
  readonly lookup: (mobile: string) => Promise<LookupResult>;
  readonly mark: (memberId: string) => Promise<MarkResult>;
}) {
  const t = useTranslations('checkin');
  const [digits, setDigits] = useState('');
  const [candidates, setCandidates] = useState<CheckInCandidateView[] | null>(null);
  const [message, setMessage] = useState<{ text: string; tone: 'green' | 'amber' | 'red' | 'neutral' } | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setDigits('');
    setCandidates(null);
  };

  const press = (key: string) => {
    setMessage(null);
    if (key === 'del') setDigits((current) => current.slice(0, -1));
    else if (digits.length < 10) setDigits((current) => current + key);
  };

  const find = async () => {
    setBusy(true);
    setMessage(null);
    const result = await lookup(`+91${digits}`);
    setBusy(false);
    if (!result.ok) return setMessage({ text: t('tryAgain'), tone: 'red' });
    // Nobody on that number: say so and send them to a person, not to a retry.
    if (result.candidates.length === 0) {
      reset();
      return setMessage({ text: t('notFound'), tone: 'red' });
    }
    setCandidates(result.candidates);
  };

  const choose = async (candidate: CheckInCandidateView) => {
    setBusy(true);
    const result = await mark(candidate.memberId);
    setBusy(false);
    reset();

    if (!result.ok) return setMessage({ text: t('tryAgain'), tone: 'red' });
    if (result.decision !== 'RECORD') return setMessage({ text: t('alreadyIn'), tone: 'neutral' });

    const name = result.memberName ?? candidate.fullName;
    if (result.greeting === null) return setMessage({ text: t('marked', { name }), tone: 'neutral' });
    if (result.greeting.kind === 'SEE_RECEPTION') return setMessage({ text: t('seeReception'), tone: 'red' });
    if (result.greeting.kind === 'WELCOME_DUE_SOON') {
      return setMessage({ text: t('welcomeDueSoon', { name, days: result.greeting.daysLeft ?? 0 }), tone: 'amber' });
    }
    setMessage({ text: t('welcome', { name }), tone: 'green' });
  };

  const tone = {
    green: 'bg-tint-fee-paid-bg text-semantic-fee-paid',
    amber: 'bg-tint-fee-due-soon-bg text-semantic-fee-due-soon',
    red: 'bg-tint-fee-expired-bg text-semantic-fee-expired',
    neutral: 'bg-tint-fee-none-bg text-brand-obsidian',
  };

  if (message !== null) {
    return (
      <div className="grid gap-6 text-center">
        <p role="status" className={cn('rounded-panel px-6 py-10 font-display text-[2rem] leading-tight font-bold', tone[message.tone])}>
          {message.text}
        </p>
        <button type="button" onClick={() => setMessage(null)} className="min-h-16 rounded-button bg-brand-obsidian px-8 text-crm-body font-semibold text-brand-white">
          {t('next')}
        </button>
      </div>
    );
  }

  if (candidates !== null) {
    return (
      <div className="grid gap-4">
        <p className="text-center text-crm-body text-brand-stone">{t('whichOne')}</p>
        <ul className="grid gap-3">
          {candidates.map((candidate) => (
            <li key={candidate.memberId}>
              <button
                type="button"
                onClick={() => void choose(candidate)}
                disabled={busy}
                className="flex w-full min-h-20 items-center gap-4 rounded-panel border-2 border-brand-stone/20 bg-white px-4 text-left disabled:opacity-60"
              >
                {candidate.photoUrl === null ? (
                  <span aria-hidden className="flex size-14 shrink-0 items-center justify-center rounded-full bg-brand-obsidian font-display text-xl text-brand-white">
                    {candidate.fullName.slice(0, 1)}
                  </span>
                ) : (
                  // A short-lived signed URL rather than a static asset, so next/image
                  // would only proxy and cache something meant to expire in five minutes.
                  <img src={candidate.photoUrl} alt="" className="size-14 shrink-0 rounded-full object-cover" />
                )}
                <span className="font-display text-[1.5rem] font-bold text-brand-obsidian">{candidate.fullName}</span>
              </button>
            </li>
          ))}
        </ul>
        <button type="button" onClick={reset} className="min-h-16 rounded-button border-2 border-brand-stone/30 text-crm-body font-semibold text-brand-obsidian">
          {t('back')}
        </button>
      </div>
    );
  }

  return (
    <div className="grid gap-5">
      <div>
        <p className="text-center text-crm-body text-brand-stone">{t('typeNumber')}</p>
        <p aria-label={t('mobileLabel')} className="mt-2 min-h-16 rounded-input bg-white text-center font-display text-[2.5rem] leading-[4rem] font-bold tracking-[0.15em] tabular text-brand-obsidian">
          {digits}
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {KEYS.map((key, index) =>
          key === '' ? (
            <span key={`gap-${index}`} />
          ) : (
            <button
              key={key}
              type="button"
              onClick={() => press(key)}
              aria-label={key === 'del' ? t('delete') : key}
              className="min-h-20 rounded-button bg-white font-display text-[2rem] font-bold text-brand-obsidian shadow-sm active:bg-brand-paper"
            >
              {key === 'del' ? '⌫' : key}
            </button>
          ),
        )}
      </div>

      <button
        type="button"
        onClick={() => void find()}
        disabled={digits.length !== 10 || busy}
        className="min-h-20 rounded-button bg-brand-accent font-display text-[1.75rem] font-bold text-brand-white disabled:opacity-40"
      >
        {t('find')}
      </button>
    </div>
  );
}
