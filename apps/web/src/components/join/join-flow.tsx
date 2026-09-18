'use client';

import type { PlanCardView } from '@mfp/core';
import { membershipEndDate } from '@mfp/core/membership';
import type { ISTDate } from '@mfp/shared/time';
import { useTranslations } from 'next-intl';
import { useEffect, useState, type ReactNode } from 'react';
import { buttonVariants } from '@/components/ui/button';
import { Link, useRouter } from '@/i18n/navigation';
import { DetailsStep } from './details-step';
import { DoneStep } from './done-step';
import { readJoinState, updateJoinState, type JoinState } from './join-state';
import { PayStep } from './pay-step';
import { PlanStep } from './plan-step';

/**
 * The route-level glue of `/join` (signup-and-payment-flow.md §1).
 *
 * Each step is its own URL, so a refresh, the back button or a return from the payment
 * window lands where the member was. What connects the steps is the `mfp_join` session
 * state, which only exists in the browser — so each wrapper renders a quiet placeholder
 * on the server and reads the state after mounting, rather than guessing and flashing.
 */

export type PriceLists = Readonly<Record<'MALE' | 'FEMALE' | 'OTHER', { readonly cards: readonly PlanCardView[]; readonly deskConfirmsPrice: boolean }>>;

function useJoinState(): JoinState | null {
  const [state, setState] = useState<JoinState | null>(null);
  useEffect(() => {
    setState(readJoinState());
  }, []);
  return state;
}

function usePlanLabel() {
  const t = useTranslations('signup.plan');
  return (card: PlanCardView) => (card.durationMonths === 1 ? t('monthly') : t('months', { count: card.durationMonths }));
}

function Placeholder() {
  return <div aria-hidden className="min-h-64" />;
}

function StartAgain() {
  const t = useTranslations('signup.errors');
  return (
    <div className="grid gap-4">
      <p role="alert" className="rounded-input bg-tint-fee-expired-bg p-3 text-body font-medium text-semantic-fee-expired">
        {t('expired')}
      </p>
      <Link href="/join" className={buttonVariants({ variant: 'primary', full: true })}>
        {t('startAgain')}
      </Link>
    </div>
  );
}

export function JoinFrame({ step, children }: { step: 1 | 2 | 3 | null; children: ReactNode }) {
  const t = useTranslations('signup');
  const names = { 1: t('steps.details'), 2: t('steps.plan'), 3: t('steps.pay') } as const;
  return (
    <div className="bg-brand-paper">
      <div className="mx-auto max-w-xl px-5 py-10 md:py-16">
        {step === null ? null : (
          <>
            <h1 className="font-display text-display-l leading-display font-bold text-brand-obsidian">{t('title')}</h1>
            <p className="mt-2 text-body font-semibold text-brand-stone">{t('stepper', { step, name: names[step] })}</p>
            <ol aria-hidden className="mt-3 grid grid-cols-3 gap-2">
              {[1, 2, 3].map((n) => (
                <li key={n} className={n <= step ? 'h-1.5 rounded-full bg-brand-accent' : 'h-1.5 rounded-full bg-brand-stone/30'} />
              ))}
            </ol>
          </>
        )}
        <div className={step === null ? '' : 'mt-8'}>{children}</div>
      </div>
    </div>
  );
}

export function JoinDetails(props: {
  today: ISTDate;
  minAge: number;
  noticeVersion: string;
  termsHref: string;
  privacyHref: string;
  planCode: string | null;
  fromQr?: boolean;
}) {
  const router = useRouter();
  const { planCode, fromQr = false, ...stepProps } = props;
  return (
    <DetailsStep
      {...stepProps}
      {...(fromQr ? { source: 'QR_NEW' as const } : {})}
      onRegistered={(registered) => {
        // A new registration starts a new purchase: forget any earlier order or reservation.
        updateJoinState({
          ...registered,
          paymentId: undefined,
          reservedUntil: undefined,
          reservedAmountPaise: undefined,
          fromQr: fromQr ? true : undefined,
        });
        router.push(planCode === null ? '/join/plan' : { pathname: '/join/plan', query: { plan: planCode } });
      }}
    />
  );
}

export function JoinPlan(props: { prices: PriceLists; admissionPaise: number; today: ISTDate; maxStartDateDaysAhead: number; planCode: string | null }) {
  const router = useRouter();
  const state = useJoinState();
  if (state === null) return <Placeholder />;
  if (state.registrationToken === undefined || state.gender === undefined) return <StartAgain />;

  const list = props.prices[state.gender];
  return (
    <PlanStep
      cards={list.cards}
      deskConfirmsPrice={list.deskConfirmsPrice}
      admissionPaise={props.admissionPaise}
      today={props.today}
      maxStartDateDaysAhead={props.maxStartDateDaysAhead}
      {...(props.planCode === null ? {} : { initialPlanCode: props.planCode })}
      {...(state.planId === undefined ? {} : { initialPlanId: state.planId })}
      {...(state.startDate === undefined ? {} : { initialStartDate: state.startDate })}
      onContinue={(choice) => {
        updateJoinState({ planId: choice.planId, startDate: choice.startDate });
        router.push('/join/pay');
      }}
    />
  );
}

export function JoinPay(props: { prices: PriceLists; admissionPaise: number; phoneDisplay: string }) {
  const t = useTranslations('signup');
  const router = useRouter();
  const label = usePlanLabel();
  const state = useJoinState();
  if (state === null) return <Placeholder />;
  if (state.registrationToken === undefined || state.gender === undefined || state.firstName === undefined) return <StartAgain />;

  const card = props.prices[state.gender].cards.find((c) => c.planId === state.planId);
  if (card === undefined || state.startDate === undefined) {
    return (
      <Link href="/join/plan" className={buttonVariants({ variant: 'primary', full: true })}>
        {t('steps.plan')}
      </Link>
    );
  }

  const startDate = state.startDate as ISTDate;
  return (
    <PayStep
      auth={{ kind: 'registration', token: state.registrationToken }}
      planId={card.planId}
      startDate={startDate}
      summary={{
        firstName: state.firstName,
        planLabel: label(card),
        startDate,
        endDate: membershipEndDate(startDate, card.durationMonths),
        planPricePaise: card.pricePaise,
        // A sign-up is always a first membership (BR-2.6); the server decides the final amount.
        admissionPaise: props.admissionPaise,
      }}
      phoneDisplay={props.phoneDisplay}
      receptionFirst={state.fromQr === true}
      onPaid={(result) => {
        updateJoinState({ paymentId: result.paymentId, reservedUntil: undefined, reservedAmountPaise: undefined });
        router.push('/join/done');
      }}
      onReserved={(reserved) => {
        updateJoinState({ reservedUntil: reserved.reservedUntil, reservedAmountPaise: reserved.amountPaise, paymentId: undefined });
        router.push('/join/done');
      }}
    />
  );
}

/**
 * The paid confirmation reads the payment's status again, so it is right after a refresh
 * and never shows a receipt the server has not issued.
 */
export function JoinDone(props: { prices: PriceLists; directionsHref: string }) {
  const label = usePlanLabel();
  const state = useJoinState();
  const [paid, setPaid] = useState<{ amountPaise: number; memberCode: string | null; receiptNo: string | null; receiptUrl: string; membership: { startDate: string; endDate: string } } | 'missing' | null>(null);

  const token = state?.registrationToken;
  const paymentId = state?.paymentId;
  useEffect(() => {
    if (state === null || token === undefined || paymentId === undefined) return;
    let cancelled = false;
    void fetch(`/api/v1/checkout/status?paymentId=${encodeURIComponent(paymentId)}`, { headers: { 'x-registration-token': token } })
      .then((response) => (response.ok ? (response.json() as Promise<{ data?: Record<string, unknown> }>) : null))
      .then((body) => {
        if (cancelled) return;
        const data = body?.data;
        setPaid(data?.['status'] === 'PAID' ? (data as unknown as typeof paid & object) : 'missing');
      })
      .catch(() => !cancelled && setPaid('missing'));
    return () => {
      cancelled = true;
    };
  }, [state, token, paymentId]);

  if (state === null) return <Placeholder />;
  if (token === undefined || state.gender === undefined || state.firstName === undefined) return <StartAgain />;
  const card = props.prices[state.gender].cards.find((c) => c.planId === state.planId);
  const common = {
    firstName: state.firstName,
    planLabel: card === undefined ? '' : label(card),
    isMinor: state.isMinor ?? false,
    whatsappUpdates: state.whatsappUpdates ?? false,
    directionsHref: props.directionsHref,
  };

  if (paymentId === undefined && state.reservedUntil !== undefined && state.reservedAmountPaise !== undefined && card !== undefined && state.startDate !== undefined) {
    const startDate = state.startDate as ISTDate;
    return (
      <DoneStep
        kind="reserved"
        {...common}
        startDate={startDate}
        endDate={membershipEndDate(startDate, card.durationMonths)}
        amountPaise={state.reservedAmountPaise}
        reservedUntil={state.reservedUntil}
      />
    );
  }
  if (paymentId === undefined || paid === 'missing') return <StartAgain />;
  if (paid === null) return <Placeholder />;

  return (
    <DoneStep
      kind="paid"
      {...common}
      startDate={paid.membership.startDate}
      endDate={paid.membership.endDate}
      amountPaise={paid.amountPaise}
      memberCode={paid.memberCode}
      receiptNo={paid.receiptNo}
      receiptUrl={paid.receiptUrl}
    />
  );
}
