'use client';

import type { PlanCardView } from '@mfp/core';
import { membershipEndDate } from '@mfp/core/membership';
import type { ISTDate } from '@mfp/shared/time';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { buttonVariants } from '@/components/ui/button';
import { track } from '@/lib/analytics';
import { formatISTDate } from '@mfp/shared/time';
import { DoneStep } from './done-step';
import { PayStep, type PaidResult, type ReservedResult } from './pay-step';
import { PlanStep } from './plan-step';

/**
 * `/renew/[token]` after the link is verified (PRD RN-01…; copy deck `renew.*`).
 *
 * The same plan, pay and confirmation pieces as sign-up, on one page: the renew token
 * is the member's authority, the start date follows BR-3.4 and is shown rather than
 * chosen, and there is no admission fee. The server prices and dates the order again.
 */

export interface RenewFlowProps {
  readonly token: string;
  readonly firstName: string;
  /** A short-lived signed URL for the member's photo, or `null`. */
  readonly photoUrl: string | null;
  readonly currentEndDate: ISTDate | null;
  readonly proposedStartDate: ISTDate;
  readonly cards: readonly PlanCardView[];
  readonly deskConfirmsPrice: boolean;
  readonly today: ISTDate;
  readonly phoneDisplay: string;
  readonly directionsHref: string;
}

type Stage =
  | { readonly kind: 'plan' }
  | { readonly kind: 'pay'; readonly card: PlanCardView }
  | { readonly kind: 'paid'; readonly card: PlanCardView; readonly result: PaidResult }
  | { readonly kind: 'reserved'; readonly card: PlanCardView; readonly result: ReservedResult };

export function RenewFlow(props: RenewFlowProps) {
  const t = useTranslations('renew');
  const tp = useTranslations('signup.plan');
  const locale = useLocale();
  const [stage, setStage] = useState<Stage>({ kind: 'plan' });

  useEffect(() => {
    track('renew_link_opened');
  }, []);

  const label = (card: PlanCardView) => (card.durationMonths === 1 ? tp('monthly') : tp('months', { count: card.durationMonths }));
  const newStart = formatISTDate(props.proposedStartDate, locale);
  const common = { firstName: props.firstName, isMinor: false, whatsappUpdates: true, directionsHref: props.directionsHref };

  if (stage.kind === 'paid') {
    const membership = stage.result.membership;
    return (
      <DoneStep
        kind="paid"
        {...common}
        planLabel={label(stage.card)}
        startDate={membership?.startDate ?? props.proposedStartDate}
        endDate={membership?.endDate ?? membershipEndDate(props.proposedStartDate, stage.card.durationMonths)}
        amountPaise={stage.result.amountPaise}
        memberCode={stage.result.memberCode}
        receiptNo={stage.result.receiptNo}
        receiptUrl={stage.result.receiptUrl}
      />
    );
  }
  if (stage.kind === 'reserved') {
    return (
      <DoneStep
        kind="reserved"
        {...common}
        planLabel={label(stage.card)}
        startDate={stage.result.membership.startDate}
        endDate={stage.result.membership.endDate}
        amountPaise={stage.result.amountPaise}
        reservedUntil={stage.result.reservedUntil}
      />
    );
  }

  return (
    <div className="grid gap-6">
      <div className="flex items-start gap-4">
        {props.photoUrl === null ? null : (
          // A signed, expiring URL: next/image must not proxy or cache it.
          <img src={props.photoUrl} alt={t('photoAlt')} width={64} height={64} className="size-16 shrink-0 rounded-full object-cover" />
        )}
        <div>
        <h1 className="font-display text-display-l leading-display font-bold text-brand-obsidian">{t('title', { name: props.firstName })}</h1>
        <p className="mt-3 text-body-l leading-body">
          {props.currentEndDate === null
            ? t('startsOn', { newStart })
            : t('currentEnds', { date: formatISTDate(props.currentEndDate, locale), newStart })}
        </p>
        </div>
      </div>

      {stage.kind === 'plan' ? (
        <PlanStep
          cards={props.cards}
          admissionPaise={0}
          deskConfirmsPrice={props.deskConfirmsPrice}
          today={props.today}
          maxStartDateDaysAhead={0}
          fixedStartDate={props.proposedStartDate}
          onContinue={(choice) => {
            const card = props.cards.find((c) => c.planId === choice.planId);
            if (card !== undefined) setStage({ kind: 'pay', card });
          }}
        />
      ) : (
        <>
          <PayStep
            auth={{ kind: 'renew', token: props.token }}
            planId={stage.card.planId}
            startDate={null}
            summary={{
              firstName: props.firstName,
              planLabel: label(stage.card),
              startDate: props.proposedStartDate,
              endDate: membershipEndDate(props.proposedStartDate, stage.card.durationMonths),
              planPricePaise: stage.card.pricePaise,
              admissionPaise: 0,
            }}
            phoneDisplay={props.phoneDisplay}
            onPaid={(result) => {
              track('renew_paid');
              setStage({ kind: 'paid', card: stage.card, result });
            }}
            onReserved={(result) => setStage({ kind: 'reserved', card: stage.card, result })}
          />
          <button type="button" onClick={() => setStage({ kind: 'plan' })} className={buttonVariants({ variant: 'link' })}>
            {t('back')}
          </button>
        </>
      )}
    </div>
  );
}
