'use client';

import { useTranslations } from 'next-intl';
import { useId, useState, type FormEvent } from 'react';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import type { LoginOutcome } from '@/lib/crm';

/**
 * The login form (crm-ux-blueprint §1).
 *
 * Numeric keyboards on both fields, 64px targets, and one plain message when the PIN is
 * wrong: the same wording whether the mobile is unknown or the PIN is wrong, so the
 * screen never confirms who works here.
 */
export function LoginForm({ action }: { action: (values: { mobile: string; pin: string; trusted: boolean }) => Promise<LoginOutcome> }) {
  const t = useTranslations('crm.login');
  const id = useId();
  const [mobile, setMobile] = useState('');
  const [pin, setPin] = useState('');
  const [trusted, setTrusted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const outcome = await action({ mobile, pin, trusted });
      if (!outcome.ok) {
        setError(
          outcome.code === 'ACCOUNT_LOCKED'
            ? t('locked', { minutes: outcome.minutes ?? 15 })
            : outcome.code === 'INTERNAL'
              ? t('generic')
              : outcome.attemptsLeft === undefined
                ? t('invalid')
                : `${t('invalid')} ${t('attemptsLeft', { count: outcome.attemptsLeft })}`,
        );
      }
    } catch (error) {
      // A successful login redirects, and Next signals that by throwing: let it through,
      // or the browser stays on the login screen with no sign anything happened.
      if ((error as { digest?: string }).digest?.startsWith('NEXT_REDIRECT') === true) throw error;
      setError(t('generic'));
    } finally {
      setBusy(false);
    }
  };

  const field = 'min-h-16 w-full rounded-input border-2 border-brand-stone/40 bg-white px-4 text-crm-body tracking-widest';

  return (
    <form onSubmit={(event) => void onSubmit(event)} className="mt-8 grid gap-5">
      <div>
        <label htmlFor={`${id}-mobile`} className="block text-crm-body font-semibold">
          {t('mobile')}
        </label>
        <input
          id={`${id}-mobile`}
          type="tel"
          inputMode="numeric"
          autoComplete="username"
          maxLength={14}
          value={mobile}
          onChange={(e) => setMobile(e.target.value)}
          className={cn('mt-2', field)}
        />
      </div>

      <div>
        <label htmlFor={`${id}-pin`} className="block text-crm-body font-semibold">
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
          className={cn('mt-2 text-center text-2xl', field)}
        />
        <p className="mt-1 text-small text-brand-stone">{t('pinHelper')}</p>
      </div>

      <label className="flex items-start gap-3 text-crm-body">
        <input type="checkbox" checked={trusted} onChange={(e) => setTrusted(e.target.checked)} className="mt-1 size-6 accent-brand-obsidian" />
        <span>
          {t('trusted')}
          <span className="mt-0.5 block text-small text-brand-stone">{t('trustedHelper')}</span>
        </span>
      </label>

      {error === null ? null : (
        <p role="alert" className="rounded-input bg-tint-fee-expired-bg p-3 text-crm-body font-medium text-semantic-fee-expired">
          {error}
        </p>
      )}

      <button type="submit" disabled={busy} className={buttonVariants({ variant: 'primary', size: 'crmPrimary', full: true })}>
        {busy ? t('submitting') : t('submit')}
      </button>
    </form>
  );
}
