'use client';

import { formatINR } from '@mfp/shared/money';
import type { ISTDate } from '@mfp/shared/time';
import { useLocale, useTranslations } from 'next-intl';
import { buttonVariants } from '@/components/ui/button';
import { formatISTDate, formatISTDateTime } from '@mfp/shared/time';

/**
 * Confirmation (wireframes "Confirmation"; copy deck `signup.done`).
 *
 * A paid member gets their code, dates, receipt and what to bring. A reservation gets
 * the amount and the deadline to pay at reception. The WhatsApp line appears only for
 * someone who agreed to WhatsApp updates — nothing is claimed that was not sent.
 */

interface Common {
  readonly firstName: string;
  readonly planLabel: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly amountPaise: number;
  readonly isMinor: boolean;
  readonly whatsappUpdates: boolean;
  readonly directionsHref: string;
}

export type DoneStepProps =
  | (Common & { readonly kind: 'paid'; readonly memberCode: string | null; readonly receiptNo: string | null; readonly receiptUrl: string })
  | (Common & { readonly kind: 'reserved'; readonly reservedUntil: string });

export function DoneStep(props: DoneStepProps) {
  const t = useTranslations('signup.done');
  const locale = useLocale();
  const amount = formatINR(props.amountPaise, { showPaise: false });
  const period = t('period', {
    plan: props.planLabel,
    start: formatISTDate(props.startDate as ISTDate, locale),
    end: formatISTDate(props.endDate as ISTDate, locale),
  });

  const directions = (
    <a href={props.directionsHref} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: 'outlineDark', full: true })}>
      {t('directions')}
    </a>
  );

  if (props.kind === 'reserved') {
    return (
      <div className="grid gap-5 text-center">
        <h1 className="font-display text-display-m leading-tight font-bold text-brand-obsidian">{t('reservedTitle', { name: props.firstName })}</h1>
        <p className="text-body-l font-semibold">{period}</p>
        <p className="text-body-l leading-body">
          {t('reservedBody', { amount, until: formatISTDateTime(new Date(props.reservedUntil), locale) })}
        </p>
        {props.isMinor ? <p className="rounded-input bg-tint-fee-due-soon-bg p-3 text-body">{t('minorReminder')}</p> : null}
        {directions}
      </div>
    );
  }

  return (
    <div className="grid gap-5 text-center">
      <svg aria-hidden viewBox="0 0 64 64" className="mx-auto size-16 text-semantic-fee-paid">
        <circle cx="32" cy="32" r="30" fill="none" stroke="currentColor" strokeWidth="4" />
        <path d="M19 33l9 9 17-19" fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <h1 className="font-display text-display-m leading-tight font-bold text-brand-obsidian">{t('title', { name: props.firstName })}</h1>
      <div className="grid gap-1 text-body-l">
        {props.memberCode === null ? null : <p className="font-semibold">{t('memberCode', { code: props.memberCode })}</p>}
        <p>{period}</p>
        {props.receiptNo === null ? null : <p>{t('paid', { amount, receiptNo: props.receiptNo })}</p>}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <a href={props.receiptUrl} className={buttonVariants({ variant: 'primary', full: true })}>
          {t('downloadReceipt')}
        </a>
        {directions}
      </div>
      {props.isMinor ? <p className="rounded-input bg-tint-fee-due-soon-bg p-3 text-body">{t('minorReminder')}</p> : null}
      <p className="text-body leading-body">{t('firstVisit')}</p>
      {props.whatsappUpdates ? <p className="text-body text-brand-ink/80">{t('whatsappSent')}</p> : null}
    </div>
  );
}
