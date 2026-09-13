'use client';

import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import type { DeskPaymentMethod } from '@mfp/core';
import { formatINR, formatISTDate, type ISTDate } from '@mfp/shared';
import { buttonVariants } from '@/components/ui/button';

/**
 * Three taps: plan, method, confirm (crm-ux-blueprint §6).
 *
 * Nothing is written until the third tap, and the confirm step says the amount and the
 * method in one sentence — the last chance to notice "₹4,000 cash" when the member
 * handed over UPI. The server prices the plan again; these figures are for reading.
 */

export interface RenewPlanOption {
  readonly planId: string;
  readonly durationMonths: number;
  readonly pricePaise: number;
  readonly endDate: string;
}

const METHODS: ReadonlyArray<{ method: DeskPaymentMethod; icon: string }> = [
  { method: 'CASH', icon: '💵' },
  { method: 'UPI_DIRECT', icon: '📱' },
  { method: 'CARD_POS', icon: '💳' },
];

export function RenewFlow({
  memberName,
  plans,
  startDate,
  locale,
  action,
}: {
  memberName: string;
  plans: readonly RenewPlanOption[];
  startDate: string;
  locale: string;
  action: (planId: string, method: DeskPaymentMethod) => Promise<void>;
}) {
  const t = useTranslations('crm.renew');
  const tp = useTranslations('crm.profile');
  const params = useSearchParams();
  const [plan, setPlan] = useState<RenewPlanOption | null>(null);
  const [method, setMethod] = useState<DeskPaymentMethod | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, start] = useTransition();

  const done = params.get('done');
  if (done !== null) {
    const receipt = params.get('receipt') ?? '';
    const code = params.get('code') ?? '';
    const amount = Number(params.get('amount') ?? '0');
    return (
      <div className="grid gap-5 p-6 text-center">
        <p aria-hidden className="text-6xl">
          ✅
        </p>
        <h2 className="font-display text-display-m font-bold text-semantic-fee-paid">{t('done')}</h2>
        <p className="text-crm-body">{formatINR(amount, { showPaise: false })}</p>
        <p className="text-crm-body text-brand-rubber-grey">{t('receiptSent')}</p>
        <p className="text-crm-body">{t('memberCode', { code })}</p>
        <p className="text-small text-brand-rubber-grey">{receipt}</p>
        <Link href="/crm/members" className={buttonVariants({ variant: 'primary', size: 'crmPrimary', full: true })}>
          {t('backToMember')}
        </Link>
      </div>
    );
  }

  const money = (paise: number) => formatINR(paise, { showPaise: false });

  return (
    <div className="p-4">
      <p className="text-crm-body font-semibold text-brand-plate-navy">{memberName}</p>

      <h2 className="mt-4 text-crm-body font-bold">{t('step1')}</h2>
      <div className="mt-2 grid grid-cols-2 gap-3">
        {plans.map((option) => (
          <button
            key={option.planId}
            type="button"
            onClick={() => {
              setPlan(option);
              setMethod(null);
              setFailed(false);
            }}
            className={`min-h-24 rounded-panel border-2 p-3 text-left ${
              plan?.planId === option.planId ? 'border-brand-plate-navy bg-brand-plate-navy/[0.06]' : 'border-brand-rubber-grey/30 bg-white'
            }`}
          >
            <span className="block text-crm-body font-semibold">
              {option.durationMonths === 1 ? tp('monthly') : tp('months', { count: option.durationMonths })}
            </span>
            <span className="mt-1 block font-display text-title font-bold text-brand-signboard-red-text">{money(option.pricePaise)}</span>
          </button>
        ))}
      </div>

      {plan === null ? null : (
        <>
          <p className="mt-3 text-crm-body text-brand-rubber-grey">
            {t('newPlan', { start: formatISTDate(startDate as ISTDate, locale), end: formatISTDate(plan.endDate as ISTDate, locale) })}
          </p>

          <h2 className="mt-5 text-crm-body font-bold">{t('step2')}</h2>
          <div className="mt-2 grid grid-cols-3 gap-3">
            {METHODS.map((option) => (
              <button
                key={option.method}
                type="button"
                onClick={() => setMethod(option.method)}
                className={`flex min-h-24 flex-col items-center justify-center gap-1 rounded-panel border-2 text-crm-body font-semibold ${
                  method === option.method ? 'border-brand-plate-navy bg-brand-plate-navy/[0.06]' : 'border-brand-rubber-grey/30 bg-white'
                }`}
              >
                <span aria-hidden className="text-2xl">
                  {option.icon}
                </span>
                {t(`methods.${option.method}`)}
              </button>
            ))}
          </div>
        </>
      )}

      {plan !== null && method !== null ? (
        <div className="mt-6 rounded-panel bg-white p-4">
          <p className="text-crm-body font-semibold">{t('confirmQuestion', { amount: money(plan.pricePaise), method: t(`methods.${method}`) })}</p>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                try {
                  await action(plan.planId, method);
                } catch (error) {
                  // A redirect from the action throws by design; anything else failed.
                  if ((error as { digest?: string }).digest?.startsWith('NEXT_REDIRECT') !== true) setFailed(true);
                }
              })
            }
            className={`${buttonVariants({ variant: 'primary', size: 'crmPrimary', full: true })} mt-4`}
          >
            ✓ {t('confirm')}
          </button>
        </div>
      ) : null}

      {failed ? (
        <p role="alert" className="mt-4 rounded-input bg-tint-fee-expired-bg p-3 text-crm-body font-medium text-semantic-fee-expired">
          {t('failed')}
        </p>
      ) : null}
    </div>
  );
}
