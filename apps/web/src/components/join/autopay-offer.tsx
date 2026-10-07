'use client';

import { formatISTDate, type ISTDate } from '@mfp/shared/time';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { buttonVariants } from '@/components/ui/button';
import { track } from '@/lib/analytics';
import { cn } from '@/lib/cn';

/**
 * "Would you like next time's fee to pay itself?", on the confirmation screen (ADR-105).
 *
 * This is the moment to ask. The member has just paid, they are still holding their phone,
 * and the one question autopay raises — *when would you take it?* — already has an obvious
 * answer: the day after the term they have just paid for runs out. So the offer can state
 * the date rather than ask about it, and nothing is taken today.
 *
 * It is an offer, not a default. The button creates a mandate Razorpay has not yet been
 * authorised to use; the member then opens the link and approves it with their own bank or
 * UPI app. Until they do, the gym chases the fee exactly as it does now — which is why
 * declining this costs them nothing.
 */

export function AutopayOffer({
  auth,
  endDate,
}: {
  /**
   * The same shape `PayStep` takes. A renewing member reaches this by a WhatsApp link and
   * holds a renew token, not a registration one, and they are the member most likely to want
   * autopay — they have just renewed by hand for at least the second time.
   *
   * `autopay` is the reception QR: a member who has just said they pay online and is being
   * offered it on the next screen, before anybody has approved them.
   */
  auth: { readonly kind: 'registration' | 'renew' | 'autopay'; readonly token: string };
  /** The last date the member is covered for. The first debit is the day after. */
  endDate: string;
}) {
  const t = useTranslations('signup.autopay');
  const locale = useLocale();
  const [state, setState] = useState<'offer' | 'working' | 'failed'>('offer');
  const [link, setLink] = useState<string | null>(null);
  const [firstChargeOn, setFirstChargeOn] = useState<string | null>(null);

  const setUp = () => {
    setState('working');
    track('autopay_offer_accepted');
    const header = auth.kind === 'registration' ? 'x-registration-token' : auth.kind === 'renew' ? 'x-renew-token' : 'x-autopay-token';
    void fetch('/api/v1/checkout/autopay', { method: 'POST', headers: { [header]: auth.token } })
      .then((response) => (response.ok ? (response.json() as Promise<{ data?: Record<string, unknown> }>) : null))
      .then((body) => {
        const data = body?.data;
        const url = typeof data?.['authoriseUrl'] === 'string' ? data['authoriseUrl'] : null;
        const from = typeof data?.['firstChargeOn'] === 'string' ? data['firstChargeOn'] : null;
        // No link means nothing for the member to approve, so it is a failure from here even
        // if the mandate itself was created — the desk can finish it from Max Register.
        if (url === null) {
          setState('failed');
          return;
        }
        setLink(url);
        setFirstChargeOn(from);
        setState('offer');
      })
      .catch(() => setState('failed'));
  };

  // Once there is a link, the offer is done and the only thing left is to open it.
  if (link !== null) {
    return (
      <div className="grid gap-3 rounded-input bg-tint-fee-paid-bg p-4 text-left">
        <p className="text-body-l font-semibold text-brand-obsidian">{t('almostTitle')}</p>
        <p className="text-body leading-body">
          {firstChargeOn === null ? t('almostBodyNoDate') : t('almostBody', { date: formatISTDate(firstChargeOn as ISTDate, locale) })}
        </p>
        <a href={link} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: 'primary', full: true })}>
          {t('approve')}
        </a>
      </div>
    );
  }

  return (
    <div className="grid gap-3 rounded-input bg-tint-fee-none-bg p-4 text-left">
      <p className="text-body-l font-semibold text-brand-obsidian">{t('title')}</p>
      <p className="text-body leading-body">{t('body', { date: formatISTDate(endDate as ISTDate, locale) })}</p>
      <button
        type="button"
        onClick={setUp}
        disabled={state === 'working'}
        className={cn(buttonVariants({ variant: 'outlineDark', full: true }), state === 'working' && 'opacity-60')}
      >
        {state === 'working' ? t('working') : t('setUp')}
      </button>
      {state === 'failed' ? (
        <p role="alert" className="text-body font-semibold text-semantic-fee-expired">
          {t('failed')}
        </p>
      ) : null}
      <p className="text-small text-brand-ink/70">{t('reassure')}</p>
    </div>
  );
}
