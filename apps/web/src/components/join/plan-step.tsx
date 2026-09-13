'use client';

import type { PlanCardView } from '@mfp/core';
import { membershipEndDate } from '@mfp/core/membership';
import { addDays, type ISTDate } from '@mfp/shared/time';
import { formatINR } from '@mfp/shared/money';
import { useLocale, useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { buttonVariants } from '@/components/ui/button';
import { ChevronDownIcon } from '@/components/marketing/icons';
import { track } from '@/lib/analytics';
import { cn } from '@/lib/cn';
import { formatISTDate } from '@mfp/shared/time';

/**
 * Step 2 of sign-up: plan and start date (PRD SU-07; wireframes "Choose your plan").
 *
 * The cards arrive already computed by `planCards()` on the server, so savings and
 * "best value" follow the domain rules. The end-date preview uses the same
 * `membershipEndDate()` the order will (BR-3.1). Every figure here is for display:
 * the order is priced again on the server (BR-11.3).
 */

export interface PlanChoice {
  readonly planId: string;
  readonly startDate: ISTDate;
}

export interface PlanStepProps {
  /** The member's price list, shortest plan first. */
  readonly cards: readonly PlanCardView[];
  readonly admissionPaise: number;
  readonly deskConfirmsPrice: boolean;
  readonly today: ISTDate;
  readonly maxStartDateDaysAhead: number;
  /** A plan code from the landing page's "Choose" button (`?plan=M3_MALE`). */
  readonly initialPlanCode?: string;
  readonly initialPlanId?: string;
  readonly initialStartDate?: string;
  /** A renewal's start follows BR-3.4 and is shown, not chosen. */
  readonly fixedStartDate?: ISTDate;
  readonly onContinue: (choice: PlanChoice) => void;
}

const price = (paise: number) => formatINR(paise, { showPaise: false });

export function PlanStep({
  cards,
  admissionPaise,
  deskConfirmsPrice,
  today,
  maxStartDateDaysAhead,
  initialPlanCode,
  initialPlanId,
  initialStartDate,
  fixedStartDate,
  onContinue,
}: PlanStepProps) {
  const t = useTranslations('signup.plan');
  const locale = useLocale();
  const id = useId();

  const startOptions = Array.from({ length: maxStartDateDaysAhead + 1 }, (_, i) => addDays(today, i));
  const [planId, setPlanId] = useState<string>(
    () => cards.find((c) => c.planId === initialPlanId || c.code === initialPlanCode)?.planId ?? '',
  );
  const [chosenStart, setStartDate] = useState<ISTDate>(
    () => startOptions.find((d) => d === initialStartDate) ?? today,
  );
  const startDate = fixedStartDate ?? chosenStart;
  const [missing, setMissing] = useState(false);

  const monthly = cards.find((c) => c.durationMonths === 1);
  const packages = cards.filter((c) => c.durationMonths > 1);
  const chosen = cards.find((c) => c.planId === planId);
  const label = (card: PlanCardView) =>
    card.durationMonths === 1 ? t('monthly') : t('months', { count: card.durationMonths });

  const choose = (card: PlanCardView) => {
    setPlanId(card.planId);
    setMissing(false);
    track('plan_selected', { plan: card.code });
  };

  const option = (card: PlanCardView, large: boolean) => (
    <label
      key={card.planId}
      className={cn(
        'rounded-panel flex cursor-pointer items-center gap-3 border-2 p-4',
        'has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2',
        planId === card.planId
          ? 'border-brand-plate-navy bg-brand-plate-navy/[0.04]'
          : 'border-brand-rubber-grey/30 bg-brand-white',
      )}
    >
      <input
        type="radio"
        name={`${id}-plan`}
        value={card.planId}
        checked={planId === card.planId}
        onChange={() => choose(card)}
        className="accent-brand-plate-navy size-5 shrink-0"
      />
      <span className="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-brand-ink font-semibold">{label(card)}</span>
        <span
          className={cn(
            'font-display text-brand-signboard-red-text font-bold',
            large ? 'text-title' : 'text-body-l',
          )}
        >
          {large ? t('perMonth', { price: price(card.pricePaise) }) : price(card.pricePaise)}
        </span>
        {card.showSavings ? (
          <span className="text-small text-brand-ink/80 flex w-full items-center gap-2">
            {t('save', { amount: price(card.savingsPaise) })}
            {card.isBestValue ? (
              <span className="rounded-button bg-brand-medal-gold text-small text-brand-plate-navy px-2 py-0.5 font-semibold">
                {t('bestValue')}
              </span>
            ) : null}
          </span>
        ) : null}
      </span>
    </label>
  );

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (chosen === undefined) {
          setMissing(true);
          return;
        }
        onContinue({ planId: chosen.planId, startDate });
      }}
      className="grid gap-6"
    >
      {monthly === undefined ? null : (
        <fieldset className="grid gap-2">
          <legend className="font-display text-title text-brand-plate-navy mb-2 font-bold">
            {t('monthlyHeading')}
          </legend>
          {option(monthly, true)}
        </fieldset>
      )}

      {packages.length === 0 ? null : (
        <fieldset className="grid gap-2">
          <legend className="font-display text-title text-brand-plate-navy mb-2 font-bold">
            {t('packagesHeading')}
          </legend>
          {packages.map((card) => option(card, false))}
        </fieldset>
      )}

      {admissionPaise > 0 || deskConfirmsPrice ? (
        <div className="text-body text-brand-ink/80 grid gap-1">
          {admissionPaise > 0 ? <p>{t('admission', { amount: price(admissionPaise) })}</p> : null}
          {deskConfirmsPrice ? <p>{t('deskConfirms')}</p> : null}
        </div>
      ) : null}

      <div>
        {fixedStartDate === undefined ? (
          <>
            <label htmlFor={`${id}-start`} className="text-body block font-semibold">
              {t('startDate')}
            </label>
            <div className="relative mt-1.5">
              <select
                id={`${id}-start`}
                value={startDate}
                onChange={(e) => setStartDate(e.target.value as ISTDate)}
                className="rounded-input border-brand-rubber-grey/40 bg-brand-white text-body text-brand-ink min-h-12 w-full appearance-none border px-3 pr-10"
              >
                {startOptions.map((date, index) => (
                  <option key={date} value={date}>
                    {index === 0
                      ? t('today', { date: formatISTDate(date, locale) })
                      : formatISTDate(date, locale)}
                  </option>
                ))}
              </select>
              <ChevronDownIcon
                aria-hidden
                className="text-brand-rubber-grey pointer-events-none absolute top-1/2 right-3 -translate-y-1/2"
              />
            </div>
          </>
        ) : null}
        <p aria-live="polite" className="text-body text-brand-plate-navy mt-2 min-h-6 font-semibold">
          {chosen === undefined
            ? null
            : t('endsOn', {
                date: formatISTDate(membershipEndDate(startDate, chosen.durationMonths), locale),
              })}
        </p>
      </div>

      {missing ? (
        <p
          role="alert"
          className="rounded-input bg-tint-fee-expired-bg text-body text-semantic-fee-expired p-3 font-medium"
        >
          {t('choose')}
        </p>
      ) : null}

      <button type="submit" className={buttonVariants({ variant: 'primary', size: 'hero', full: true })}>
        {t('continue')}
      </button>
    </form>
  );
}
