'use client';

import { useTranslations } from 'next-intl';
import { useId, useState, useTransition } from 'react';
import type { OwnPinOutcome } from '@/lib/settings-types';

/**
 * Change my PIN (security-plan §3.1, §6).
 *
 * The new PIN is typed twice, because a PIN nobody can read back is easy to mistype and
 * a mistyped one locks its owner out. The two obvious mistakes — the copies differ, or
 * the new PIN is the old one — are caught here before anything is sent; the server
 * checks everything again.
 */

const field = 'mt-1 min-h-14 w-full rounded-input border-2 border-brand-stone/40 bg-white px-4 text-center text-2xl tracking-widest';
const digits = (value: string) => value.replace(/\D/g, '').slice(0, 6);

export function OwnPinForm({ action }: { action: (currentPin: string, newPin: string) => Promise<OwnPinOutcome> }) {
  const t = useTranslations('crm.pin');
  const id = useId();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [message, setMessage] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);
  const [pending, start] = useTransition();

  const submit = () => {
    if (next.length < 4) return setMessage({ text: t('invalidNew'), tone: 'error' });
    if (next !== confirm) return setMessage({ text: t('mismatch'), tone: 'error' });
    if (next === current) return setMessage({ text: t('same'), tone: 'error' });

    setMessage(null);
    start(async () => {
      const result = await action(current, next);
      setCurrent('');
      if (result.ok) {
        setNext('');
        setConfirm('');
        setMessage({ text: t('done'), tone: 'ok' });
        return;
      }
      const text =
        result.code === 'ACCOUNT_LOCKED'
          ? t('locked', { minutes: result.minutes ?? 15 })
          : result.code === 'INVALID_PIN'
            ? result.attemptsLeft === undefined
              ? t('wrongCurrent')
              : `${t('wrongCurrent')} ${t('attemptsLeft', { count: result.attemptsLeft })}`
            : result.code === 'VALIDATION_FAILED'
              ? t('invalidNew')
              : t('failed');
      setMessage({ text, tone: 'error' });
    });
  };

  const inputs = [
    ['current', t('current'), current, setCurrent, 'current-password'],
    ['next', t('next'), next, setNext, 'new-password'],
    ['confirm', t('confirm'), confirm, setConfirm, 'new-password'],
  ] as const;

  return (
    <form
      aria-label={t('title')}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className="grid gap-4 rounded-panel bg-white p-4 shadow-sm"
    >
      <p className="text-small text-brand-stone">{t('helper')}</p>
      {inputs.map(([key, label, value, setValue, autoComplete]) => (
        <div key={key}>
          <label htmlFor={`${id}-${key}`} className="block text-crm-body font-semibold">
            {label}
          </label>
          <input
            id={`${id}-${key}`}
            type="password"
            inputMode="numeric"
            autoComplete={autoComplete}
            maxLength={6}
            value={value}
            onChange={(event) => setValue(digits(event.target.value))}
            className={field}
          />
        </div>
      ))}

      {message === null ? null : message.tone === 'ok' ? (
        <p role="status" className="text-crm-body font-medium text-semantic-fee-paid">
          {message.text}
        </p>
      ) : (
        <p role="alert" className="rounded-input bg-tint-fee-expired-bg p-3 text-crm-body font-medium text-semantic-fee-expired">
          {message.text}
        </p>
      )}

      <button
        type="submit"
        disabled={pending || current.length < 4 || next.length < 4 || confirm.length < 4}
        className="min-h-16 w-full rounded-panel bg-brand-obsidian text-crm-body font-bold text-white disabled:opacity-50"
      >
        {pending ? t('saving') : t('save')}
      </button>
    </form>
  );
}
