'use client';

import type { PlanCardView, PtCardView } from '@mfp/core';
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
  /** `null` when the member said no to personal training (ADR-087). */
  readonly ptPlanId: string | null;
}

export interface PlanStepProps {
  /** The member's price list, shortest plan first. */
  readonly cards: readonly PlanCardView[];
  /** Personal training on this member's price list; empty when the gym sells none. */
  readonly ptCards?: readonly PtCardView[];
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
  ptCards = [],
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
  const label = (card: PlanCardView | PtCardView) =>
    card.durationMonths === 1 ? t('monthly') : t('months', { count: card.durationMonths });

  // Personal training (ADR-087). "No" is the default, and only terms that fit inside the
  // chosen membership are offered — a trainer booked past it is a mis-sale the desk has
  // to unpick, and the server refuses it anyway.
  const [wantsPt, setWantsPt] = useState(false);
  const [ptPlanId, setPtPlanId] = useState('');
  const [ptMissing, setPtMissing] = useState(false);
  const ptFits = chosen === undefined ? [] : ptCards.filter((card) => card.durationMonths <= chosen.durationMonths);
  const ptChosen = ptFits.find((card) => card.planId === ptPlanId);

  const choose = (card: PlanCardView) => {
    setPlanId(card.planId);
    setMissing(false);
    // A shorter membership can carry a shorter trainer term, so an impossible choice goes.
    if (ptChosen !== undefined && ptChosen.durationMonths > card.durationMonths) setPtPlanId('');
    track('plan_selected', { plan: card.code });
  };

  const option = (card: PlanCardView, large: boolean) => (
    <label
      key={card.planId}
      className={cn(
        'rounded-panel flex cursor-pointer items-center gap-3 border-2 p-4',
        'has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2',
        planId === card.planId
          ? 'border-brand-obsidian bg-brand-obsidian/[0.04]'
          : 'border-brand-stone/30 bg-brand-white',
      )}
    >
      <input
        type="radio"
        name={`${id}-plan`}
        value={card.planId}
        checked={planId === card.planId}
        onChange={() => choose(card)}
        className="accent-brand-obsidian size-5 shrink-0"
      />
      <span className="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-brand-ink font-semibold">{label(card)}</span>
        <span
          className={cn(
            'font-display text-brand-accent-deep font-bold',
            large ? 'text-title' : 'text-body-l',
          )}
        >
          {large ? t('perMonth', { price: price(card.pricePaise) }) : price(card.pricePaise)}
        </span>
        {card.showSavings ? (
          <span className="text-small text-brand-ink/80 flex w-full items-center gap-2">
            {t('save', { amount: price(card.savingsPaise) })}
            {card.isBestValue ? (
              <span className="rounded-button bg-brand-accent px-2 py-0.5 text-small font-semibold text-brand-white">
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
        if (wantsPt && ptFits.length > 0 && ptChosen === undefined) {
          setPtMissing(true);
          return;
        }
        onContinue({ planId: chosen.planId, startDate, ptPlanId: wantsPt ? (ptChosen?.planId ?? null) : null });
      }}
      className="grid gap-6"
    >
      {monthly === undefined ? null : (
        <fieldset className="grid gap-2">
          <legend className="font-display text-title text-brand-obsidian mb-2 font-bold">
            {t('monthlyHeading')}
          </legend>
          {option(monthly, true)}
        </fieldset>
      )}

      {packages.length === 0 ? null : (
        <fieldset className="grid gap-2">
          <legend className="font-display text-title text-brand-obsidian mb-2 font-bold">
            {t('packagesHeading')}
          </legend>
          {packages.map((card) => option(card, false))}
        </fieldset>
      )}

      {ptCards.length === 0 ? null : (
        <fieldset className="grid gap-2">
          <legend className="font-display text-title text-brand-obsidian mb-2 font-bold">{t('ptHeading')}</legend>
          <p className="text-body text-brand-ink/80 -mt-1 mb-1">{t('ptHelper')}</p>
          <div className="flex gap-2">
            {(
              [
                ['no', false],
                ['yes', true],
              ] as const
            ).map(([value, wants]) => (
              <label
                key={value}
                className={cn(
                  'rounded-panel flex flex-1 cursor-pointer items-center justify-center gap-2 border-2 p-3 font-semibold',
                  'has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2',
                  wantsPt === wants ? 'border-brand-obsidian bg-brand-obsidian/[0.04]' : 'border-brand-stone/30 bg-brand-white',
                )}
              >
                <input
                  type="radio"
                  name={`${id}-wants-pt`}
                  value={value}
                  checked={wantsPt === wants}
                  onChange={() => {
                    setWantsPt(wants);
                    setPtMissing(false);
                    if (!wants) setPtPlanId('');
                  }}
                  className="accent-brand-obsidian size-5 shrink-0"
                />
                {t(wants ? 'ptYes' : 'ptNo')}
              </label>
            ))}
          </div>

          {!wantsPt ? null : ptFits.length === 0 ? (
            <p className="text-body text-brand-ink/80">{t('ptNeedsPlan')}</p>
          ) : (
            ptFits.map((card) => (
              <label
                key={card.planId}
                className={cn(
                  'rounded-panel flex cursor-pointer items-center gap-3 border-2 p-4',
                  'has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2',
                  ptPlanId === card.planId ? 'border-brand-obsidian bg-brand-obsidian/[0.04]' : 'border-brand-stone/30 bg-brand-white',
                )}
              >
                <input
                  type="radio"
                  name={`${id}-pt`}
                  value={card.planId}
                  checked={ptPlanId === card.planId}
                  onChange={() => {
                    setPtPlanId(card.planId);
                    setPtMissing(false);
                  }}
                  className="accent-brand-obsidian size-5 shrink-0"
                />
                <span className="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <span className="text-brand-ink font-semibold">{t('ptMonths', { count: card.durationMonths })}</span>
                  <span className="font-display text-brand-accent-deep text-body-l font-bold">{price(card.pricePaise)}</span>
                  <span className="text-small text-brand-ink/80 w-full">{t('ptPerMonth', { price: price(card.perMonthPaise) })}</span>
                </span>
              </label>
            ))
          )}

          {chosen === undefined || ptChosen === undefined ? null : (
            <p aria-live="polite" className="text-body text-brand-obsidian font-semibold">
              {t('ptTotal', {
                membership: price(chosen.pricePaise + admissionPaise),
                pt: price(ptChosen.pricePaise),
                total: price(chosen.pricePaise + admissionPaise + ptChosen.pricePaise),
              })}
            </p>
          )}

          {ptMissing ? (
            <p role="alert" className="rounded-input bg-tint-fee-expired-bg text-body text-semantic-fee-expired p-3 font-medium">
              {t('ptChoose')}
            </p>
          ) : null}
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
                className="rounded-input border-brand-stone/40 bg-brand-white text-body text-brand-ink min-h-12 w-full appearance-none border px-3 pr-10"
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
                className="text-brand-stone pointer-events-none absolute top-1/2 right-3 -translate-y-1/2"
              />
            </div>
          </>
        ) : null}
        <p aria-live="polite" className="text-body text-brand-obsidian mt-2 min-h-6 font-semibold">
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
