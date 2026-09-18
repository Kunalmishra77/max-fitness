'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useId, useState, useTransition } from 'react';

/**
 * Voiding a payment entered wrongly (case P9; crm-ux-blueprint §5; BR-11).
 *
 * The one action that takes money out of the day's total, so it asks for two things
 * before it will run: a reason, and the PIN again. The PIN is not decoration — the
 * server re-checks it and only then counts the session as elevated, so a phone left
 * unlocked on the desk cannot void a payment.
 */

export type VoidResult = { ok: true } | { ok: false; code: 'INVALID_PIN' | 'ACCOUNT_LOCKED' | 'FORBIDDEN' | 'INTERNAL' };

export function VoidPaymentButton({
  paymentId,
  amount,
  receiptNo,
  action,
}: {
  paymentId: string;
  amount: string;
  receiptNo: string;
  action: (paymentId: string, reason: string, pin: string) => Promise<VoidResult>;
}) {
  const t = useTranslations('crm.void');
  const router = useRouter();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = () => {
    setError(null);
    start(async () => {
      const result = await action(paymentId, reason, pin);
      if (result.ok) {
        setOpen(false);
        setReason('');
        setPin('');
        router.refresh();
      } else {
        setError(result.code === 'INVALID_PIN' || result.code === 'ACCOUNT_LOCKED' ? t('wrongPin') : result.code === 'FORBIDDEN' ? t('notAllowed') : t('failed'));
      }
      setPin('');
    });
  };

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="mt-2 min-h-14 text-small font-semibold text-semantic-fee-expired underline">
        {t('action')}
      </button>
    );
  }

  const field = 'mt-2 min-h-14 w-full rounded-input border-2 border-brand-stone/40 bg-white px-4 text-crm-body';

  return (
    <div role="group" aria-label={t('title')} className="mt-3 rounded-panel bg-tint-fee-expired-bg p-4">
      <p className="text-crm-body font-bold text-semantic-fee-expired">{t('title')}</p>
      <p className="mt-1 text-crm-body">{t('body', { amount, receiptNo })}</p>

      <label htmlFor={`${id}-reason`} className="mt-4 block text-crm-body font-semibold">
        {t('reason')}
      </label>
      <input id={`${id}-reason`} type="text" value={reason} onChange={(e) => setReason(e.target.value)} className={field} />
      <p className="mt-1 text-small text-brand-stone">{t('reasonHelper')}</p>

      <label htmlFor={`${id}-pin`} className="mt-4 block text-crm-body font-semibold">
        {t('pin')}
      </label>
      <input
        id={`${id}-pin`}
        type="password"
        inputMode="numeric"
        autoComplete="current-password"
        maxLength={6}
        value={pin}
        onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
        className={`${field} text-center text-2xl tracking-widest`}
      />
      <p className="mt-1 text-small text-brand-stone">{t('pinHelper')}</p>

      {error === null ? null : (
        <p role="alert" className="mt-3 rounded-input bg-white p-3 text-crm-body font-medium text-semantic-fee-expired">
          {error}
        </p>
      )}

      <button
        type="button"
        disabled={pending || reason.trim() === '' || pin.length < 4}
        onClick={submit}
        className="mt-4 min-h-16 w-full rounded-panel bg-semantic-fee-expired text-crm-body font-bold text-white disabled:opacity-50"
      >
        {t('confirm')}
      </button>
      <button type="button" onClick={() => setOpen(false)} className="mt-2 min-h-14 w-full text-crm-body font-semibold text-brand-stone">
        {t('cancel')}
      </button>
    </div>
  );
}
