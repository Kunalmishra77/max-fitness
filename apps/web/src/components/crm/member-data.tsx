'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useId, useState, useTransition } from 'react';
import { PinGate } from '@/components/crm/settings-forms';
import type { EraseResult, UnlockResult } from '@/lib/settings-types';

/**
 * A member's data rights on their profile (privacy-and-dpdp-compliance §6; ADR-050).
 *
 * Export is a download; if the PIN has lapsed it asks for it first, because the download
 * itself refuses without a fresh PIN. Erasure is the only irreversible action in the CRM,
 * so it says in plain words what will go and what will stay, and asks for a reason and
 * the PIN in the same place as the button that does it.
 */

const field = 'mt-1 min-h-14 w-full rounded-input border-2 border-brand-rubber-grey/40 bg-white px-4 text-crm-body';

export function MemberDataSection({
  memberId,
  memberName,
  exportReady,
  unlock,
  erase,
}: {
  memberId: string;
  memberName: string;
  exportReady: boolean;
  unlock: (pin: string) => Promise<UnlockResult>;
  erase: (memberId: string, reason: string, pin: string) => Promise<EraseResult>;
}) {
  const t = useTranslations('crm.privacy');
  const router = useRouter();
  const id = useId();
  const [unlocking, setUnlocking] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = () => {
    setError(null);
    start(async () => {
      const result = await erase(memberId, reason.trim(), pin);
      setPin('');
      if (result.ok) {
        router.push('/crm/members');
        return;
      }
      setError(
        result.code === 'INVALID_PIN'
          ? t('wrongPin')
          : result.code === 'ACCOUNT_LOCKED'
            ? t('locked')
            : result.code === 'FORBIDDEN'
              ? t('notAllowed')
              : t('failed'),
      );
    });
  };

  const button = 'flex min-h-14 w-full items-center justify-center rounded-panel border-2 text-crm-body font-semibold';

  return (
    <section aria-labelledby={`${id}-title`} className="mt-3 bg-white px-4 py-4">
      <h2 id={`${id}-title`} className="text-crm-body font-bold text-brand-plate-navy">
        {t('title')}
      </h2>
      <p className="text-small text-brand-rubber-grey">{t('helper')}</p>

      <div className="mt-3">
        {exportReady ? (
          <a href={`/crm/members/${memberId}/export`} download className={`${button} border-brand-plate-navy text-brand-plate-navy`}>
            {t('export')}
          </a>
        ) : unlocking ? (
          <PinGate
            compact
            title={t('pinTitle')}
            unlock={unlock}
            onUnlocked={() => {
              setUnlocking(false);
              router.refresh();
            }}
          />
        ) : (
          <button type="button" onClick={() => setUnlocking(true)} className={`${button} border-brand-plate-navy text-brand-plate-navy`}>
            {t('export')}
          </button>
        )}
        <p className="mt-1 text-small text-brand-rubber-grey">{t('exportHelper')}</p>
      </div>

      {confirming ? (
        <div role="group" aria-label={t('eraseTitle', { name: memberName })} className="mt-4 grid gap-3 rounded-panel bg-tint-fee-expired-bg p-4">
          <p className="text-crm-body font-bold text-semantic-fee-expired">{t('eraseTitle', { name: memberName })}</p>
          <p className="text-crm-body">{t('eraseBody')}</p>
          <div>
            <label htmlFor={`${id}-reason`} className="block text-crm-body font-semibold">
              {t('reason')}
            </label>
            <input id={`${id}-reason`} type="text" value={reason} onChange={(event) => setReason(event.target.value)} className={field} />
            <p className="mt-1 text-small text-brand-rubber-grey">{t('reasonHelper')}</p>
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
              onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))}
              className={`${field} text-center text-2xl tracking-widest`}
            />
          </div>
          {error === null ? null : (
            <p role="alert" className="rounded-input bg-white p-3 text-crm-body font-medium text-semantic-fee-expired">
              {error}
            </p>
          )}
          <button
            type="button"
            disabled={pending || reason.trim() === '' || pin.length < 4}
            onClick={submit}
            className="min-h-16 w-full rounded-panel bg-semantic-fee-expired text-crm-body font-bold text-white disabled:opacity-50"
          >
            {pending ? t('erasing') : t('confirm')}
          </button>
          <button type="button" onClick={() => setConfirming(false)} className="min-h-14 text-crm-body font-semibold text-brand-rubber-grey">
            {t('cancel')}
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => setConfirming(true)} className={`${button} mt-4 border-semantic-fee-expired text-semantic-fee-expired`}>
          {t('erase')}
        </button>
      )}
    </section>
  );
}
