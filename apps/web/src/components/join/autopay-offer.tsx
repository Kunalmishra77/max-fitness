'use client';

import { formatISTDate, type ISTDate } from '@mfp/shared/time';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
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
  required = false,
  onDeferred,
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
  /**
   * The member already chose to pay online, so this is not a question any more (owner,
   * 2026-10-08).
   *
   * It sets itself up on arrival and the approve link is the only thing on the screen —
   * no "would you like", nothing to decline. The bank's own authorisation is still the
   * member's to give, which is why there is a way to finish at the desk rather than a
   * member stuck in front of a failed UPI app with a queue behind them.
   */
  required?: boolean;
  /** Called when the member takes the "I will do this at the desk" way out. */
  onDeferred?: () => void;
}) {
  const t = useTranslations('signup.autopay');
  const locale = useLocale();
  const [state, setState] = useState<'offer' | 'working' | 'failed'>('offer');
  const [gaveUp, setGaveUp] = useState(false);
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

  // Fired once on arrival in required mode. A ref rather than a state flag: React may run
  // an effect twice in development, and two calls would make two subscriptions at Razorpay.
  const started = useRef(false);
  useEffect(() => {
    if (!required || started.current) return;
    started.current = true;
    setUp();
    // Deliberately keyed on `required` alone: `setUp` is rebuilt every render, and listing
    // it would start a second subscription at Razorpay on the next one. The ref above is
    // what actually guarantees once.
  }, [required]);

  /**
   * The member chose online, so this is the rest of that choice rather than a new question.
   *
   * It sets itself up, says what will happen and when, and offers one thing: approve it.
   * The quiet way out exists because the bank's authorisation is not ours to give — a UPI
   * app that will not open must not strand somebody at a reception desk — and taking it
   * loses nothing: the desk sets the same mandate up when it approves them, and the link
   * goes out again on WhatsApp.
   */
  // Stepped away from it: the desk does this one. Falling through to the optional offer
  // would put the same question back on the screen it was just dismissed from.
  if (required && gaveUp) return null;

  if (required) {
    return (
      <div className="grid gap-3 rounded-input bg-tint-fee-paid-bg p-4 text-left">
        <p className="text-body-l font-semibold text-brand-obsidian">{t('requiredTitle')}</p>

        {link !== null ? (
          <>
            <p className="text-body leading-body">
              {firstChargeOn === null
                ? t('requiredReadyNoDate')
                : t('requiredReady', { date: formatISTDate(firstChargeOn as ISTDate, locale) })}
            </p>
            <a href={link} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: 'primary', full: true })}>
              {t('approve')}
            </a>
          </>
        ) : state === 'failed' ? (
          <>
            <p role="alert" className="text-body leading-body text-semantic-fee-expired">
              {t('requiredFailed')}
            </p>
            <button type="button" onClick={setUp} className={buttonVariants({ variant: 'primary', full: true })}>
              {t('retry')}
            </button>
          </>
        ) : (
          <p className="text-body leading-body text-brand-ink/80">{t('requiredWorking')}</p>
        )}

        <button
          type="button"
          onClick={() => {
            setGaveUp(true);
            onDeferred?.();
          }}
          className="min-h-11 text-small font-semibold text-brand-ink/70 underline underline-offset-2"
        >
          {t('atDesk')}
        </button>
      </div>
    );
  }

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
