'use client';

import type { ISTDate } from '@mfp/shared/time';
import { formatINR } from '@mfp/shared/money';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { buttonVariants } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { track } from '@/lib/analytics';
import { cn } from '@/lib/cn';
import { formatISTDate } from '@mfp/shared/time';

/**
 * Step 3 of sign-up, and the pay step of a renewal (PRD SU-10…12, PAY-01…06;
 * signup-and-payment-flow.md §1, §4, §8).
 *
 * Somebody who scanned the reception QR is offered only "Pay at reception": they are
 * standing at the desk and the gym has no live gateway, so a checkout there would be
 * theatre (ADR-076).
 *
 * The order is created only when the member taps Pay or Pay at reception. Online, the
 * gateway's window opens — Razorpay Standard Checkout, or in DEMO_MODE a dialog that
 * stands in for it — and its success callback is posted to `/checkout/verify`. A
 * payment authorised but not yet captured is polled every 2 s for up to a minute; the
 * webhook normally lands well within that. Nothing here decides an amount.
 */

type Money = number;

export interface PaySummary {
  readonly firstName: string;
  readonly planLabel: string;
  readonly startDate: ISTDate;
  readonly endDate: ISTDate;
  readonly planPricePaise: Money;
  readonly admissionPaise: Money;
}

export interface PaidResult {
  readonly paymentId: string;
  readonly amountPaise: Money;
  readonly memberCode: string | null;
  readonly receiptNo: string | null;
  readonly receiptUrl: string;
  readonly membership: { readonly startDate: string | null; readonly endDate: string } | null;
}

export interface ReservedResult {
  readonly amountPaise: Money;
  readonly reservedUntil: string;
  readonly membership: { readonly startDate: string; readonly endDate: string };
}

export interface RazorpayCallback {
  readonly razorpay_order_id: string;
  readonly razorpay_payment_id: string;
  readonly razorpay_signature: string;
}

export interface RazorpayOptions {
  key: string;
  amount: number;
  currency: 'INR';
  order_id: string;
  name: string;
  prefill: { name: string; contact: string; email?: string };
  theme: { color: string };
  handler: (response: RazorpayCallback) => void;
  modal: { ondismiss: () => void };
}

export type RazorpayConstructor = new (options: RazorpayOptions) => { open(): void; on(event: 'payment.failed', handler: () => void): void };

export interface PayStepProps {
  readonly auth: { readonly kind: 'registration' | 'renew'; readonly token: string };
  readonly planId: string;
  /** `null` for a renewal: the server applies BR-3.4. */
  readonly startDate: ISTDate | null;
  readonly summary: PaySummary;
  readonly phoneDisplay: string;
  readonly onPaid: (result: PaidResult) => void;
  readonly onReserved: (result: ReservedResult) => void;
  /** Someone standing at the desk: they pay there, and are not offered a checkout (ADR-076). */
  readonly receptionOnly?: boolean;
  /** Injected in tests. */
  readonly loadRazorpay?: () => Promise<RazorpayConstructor>;
  readonly pollIntervalMs?: number;
}

type Phase = 'idle' | 'creating' | 'demo' | 'verifying' | 'pending' | 'failed' | 'review' | 'expired' | 'error' | 'rateLimited' | 'staleStart';

interface OnlineOrder {
  readonly kind: 'ONLINE';
  readonly paymentId: string;
  readonly provider: 'razorpay' | 'simulated';
  readonly orderId: string;
  readonly keyId: string;
  readonly amountPaise: Money;
  readonly prefill: { readonly name: string; readonly contact: string; readonly email: string | null };
}

const RAZORPAY_SCRIPT = 'https://checkout.razorpay.com/v1/checkout.js';
/** signup-and-payment-flow §1: poll every 2 s for up to 60 s. */
const MAX_POLLS = 30;

/** Loaded on the pay step only, and only when an online payment starts (spec §4). */
function loadRazorpayScript(): Promise<RazorpayConstructor> {
  const existing = (window as unknown as { Razorpay?: RazorpayConstructor }).Razorpay;
  if (existing !== undefined) return Promise.resolve(existing);
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = RAZORPAY_SCRIPT;
    script.async = true;
    script.onload = () => {
      const loaded = (window as unknown as { Razorpay?: RazorpayConstructor }).Razorpay;
      if (loaded === undefined) reject(new Error('Razorpay did not load'));
      else resolve(loaded);
    };
    script.onerror = () => reject(new Error('Razorpay did not load'));
    document.head.appendChild(script);
  });
}

const price = (paise: Money) => formatINR(paise, { showPaise: false });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function PayStep({
  auth,
  planId,
  startDate,
  summary,
  phoneDisplay,
  onPaid,
  onReserved,
  receptionOnly = false,
  loadRazorpay = loadRazorpayScript,
  pollIntervalMs = 2_000,
}: PayStepProps) {
  const t = useTranslations('signup.pay');
  const te = useTranslations('signup.errors');
  const locale = useLocale();
  const [phase, setPhase] = useState<Phase>('idle');
  const [order, setOrder] = useState<OnlineOrder | null>(null);
  // The date the member picked can go stale — they filled this last night, or crossed
  // midnight while reading. The server tells us its own date; this holds the one to
  // send, so the second attempt is not the same refused request (ADR-078).
  const [start, setStart] = useState<ISTDate | null>(startDate);
  const [serverToday, setServerToday] = useState<ISTDate | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const authHeader = { [auth.kind === 'registration' ? 'x-registration-token' : 'x-renew-token']: auth.token };
  const total = summary.planPricePaise + summary.admissionPaise;

  interface OrderAttempt {
    readonly status: number;
    readonly data: unknown;
    readonly code?: string | undefined;
    readonly today?: string | undefined;
  }

  const failFromResponse = (attempt: OrderAttempt) => {
    if (attempt.code === 'INVALID_START_DATE' && attempt.today !== undefined) {
      setServerToday(attempt.today as ISTDate);
      setPhase('staleStart');
      return;
    }
    setPhase(attempt.status === 401 ? 'expired' : attempt.status === 429 ? 'rateLimited' : 'error');
  };

  const createOrder = async (payAtReception: boolean, on: ISTDate | null): Promise<OrderAttempt | null> => {
    try {
      const response = await fetch('/api/v1/checkout/orders', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeader },
        body: JSON.stringify({ planId, startDate: on, payAtReception }),
      });
      const body = (await response.json().catch(() => null)) as
        | { data?: unknown; error?: { code?: string; details?: { today?: string } } }
        | null;
      return { status: response.status, data: body?.data, code: body?.error?.code, today: body?.error?.details?.today };
    } catch {
      return null;
    }
  };

  const finish = (status: string, data: Record<string, unknown>, current: OnlineOrder): boolean => {
    if (status === 'PAID') {
      track('payment_succeeded');
      onPaid({
        paymentId: current.paymentId,
        amountPaise: current.amountPaise,
        memberCode: (data['memberCode'] as string | null) ?? null,
        receiptNo: (data['receiptNo'] as string | null) ?? null,
        receiptUrl: typeof data['receiptUrl'] === 'string' ? data['receiptUrl'] : '',
        membership: (data['membership'] as PaidResult['membership']) ?? null,
      });
      return true;
    }
    if (status === 'FAILED') {
      track('payment_failed');
      setPhase('failed');
      return true;
    }
    if (status === 'NEEDS_REVIEW') {
      setPhase('review');
      return true;
    }
    return false;
  };

  const poll = async (current: OnlineOrder) => {
    setPhase('pending');
    for (let attempt = 0; attempt < MAX_POLLS && mounted.current; attempt += 1) {
      await sleep(pollIntervalMs);
      try {
        const response = await fetch(`/api/v1/checkout/status?paymentId=${encodeURIComponent(current.paymentId)}`, { headers: authHeader });
        if (!response.ok) continue;
        const body = (await response.json()) as { data?: Record<string, unknown> };
        if (body.data !== undefined && finish(String(body.data['status']), body.data, current)) return;
      } catch {
        // A dropped poll is retried on the next tick.
      }
    }
    // Still not captured after a minute: the pending message stays, with its reassurance.
  };

  const verify = async (current: OnlineOrder, callback: RazorpayCallback) => {
    setPhase('verifying');
    try {
      const response = await fetch('/api/v1/checkout/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(callback),
      });
      const body = (await response.json().catch(() => null)) as { data?: Record<string, unknown> } | null;
      if (!response.ok || body?.data === undefined) {
        setPhase(response.status === 422 ? 'failed' : 'error');
        return;
      }
      if (!finish(String(body.data['status']), body.data, current)) await poll(current);
    } catch {
      // The browser lost the connection after paying; the webhook still confirms. Keep checking.
      await poll(current);
    }
  };

  const payOnline = async (on: ISTDate | null = start) => {
    setPhase('creating');
    track('payment_started');
    const created = await createOrder(false, on);
    if (created === null) return setPhase('error');
    if (created.status !== 201) return failFromResponse(created);
    const current = created.data as OnlineOrder;
    setOrder(current);

    if (current.provider === 'simulated') {
      setPhase('demo');
      return;
    }

    try {
      const Razorpay = await loadRazorpay();
      const checkout = new Razorpay({
        key: current.keyId,
        amount: current.amountPaise,
        currency: 'INR',
        order_id: current.orderId,
        name: 'Max Fitness Gym',
        prefill: {
          name: current.prefill.name,
          contact: current.prefill.contact,
          ...(current.prefill.email === null ? {} : { email: current.prefill.email }),
        },
        theme: { color: '#D90F1F' },
        handler: (callback) => void verify(current, callback),
        modal: { ondismiss: () => mounted.current && setPhase((p) => (p === 'creating' ? 'failed' : p)) },
      });
      checkout.on('payment.failed', () => {
        track('payment_failed');
      });
      checkout.open();
    } catch {
      setPhase('error');
    }
  };

  const simulate = async (outcome: 'success' | 'failure') => {
    if (order === null) return;
    setPhase('verifying');
    try {
      const response = await fetch('/api/v1/checkout/simulate', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeader },
        body: JSON.stringify({ providerOrderId: order.orderId, outcome }),
      });
      const body = (await response.json().catch(() => null)) as { data?: RazorpayCallback } | null;
      if (!response.ok || body?.data === undefined) return failFromResponse({ status: response.status, data: undefined });
      await verify(order, body.data);
    } catch {
      setPhase('error');
    }
  };

  const payAtReception = async (on: ISTDate | null = start) => {
    setPhase('creating');
    track('pay_at_reception_chosen');
    const created = await createOrder(true, on);
    if (created === null) return setPhase('error');
    if (created.status !== 201) return failFromResponse(created);
    const data = created.data as ReservedResult;
    onReserved({ amountPaise: data.amountPaise, reservedUntil: data.reservedUntil, membership: data.membership });
  };

  const busy = phase === 'creating' || phase === 'verifying' || phase === 'pending' || phase === 'demo';

  const actions = (primaryLabel: string) =>
    receptionOnly ? (
      <div className="grid gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={() => void payAtReception()}
          className={buttonVariants({ variant: 'primary', size: 'hero', full: true })}
        >
          {t('payAtReception')}
        </button>
        <p className="text-small text-brand-ink/80 text-center">{t('receptionOnlyHelper')}</p>
      </div>
    ) : (
      <div className="grid gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={() => void payOnline()}
          className={buttonVariants({ variant: 'primary', size: 'hero', full: true })}
        >
          {primaryLabel}
        </button>
        <p className="text-body text-brand-stone text-center">{t('orReception')}</p>
        <button
          type="button"
          disabled={busy}
          onClick={() => void payAtReception()}
          className={buttonVariants({ variant: 'outlineDark', full: true })}
        >
          {t('payAtReception')}
        </button>
        <p className="text-small text-brand-ink/80 text-center">{t('receptionHelper')}</p>
      </div>
    );

  return (
    <div className="grid gap-6">
      <div className="rounded-panel border border-brand-stone/30 bg-brand-white p-5">
        <p className="text-body font-semibold text-brand-obsidian">
          {t('summary', {
            name: summary.firstName,
            plan: summary.planLabel,
            start: formatISTDate(summary.startDate, locale),
            end: formatISTDate(summary.endDate, locale),
          })}
        </p>
        <dl className="mt-4 grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 text-body">
          <dt>{t('planLine', { plan: summary.planLabel })}</dt>
          <dd className="text-right">{price(summary.planPricePaise)}</dd>
          {summary.admissionPaise > 0 ? (
            <>
              <dt>{t('admissionLine')}</dt>
              <dd className="text-right">{price(summary.admissionPaise)}</dd>
            </>
          ) : null}
          <dt className="border-t border-brand-stone/30 pt-2 font-semibold">{t('total')}</dt>
          <dd className="border-t border-brand-stone/30 pt-2 text-right font-display text-title font-bold text-brand-accent-deep">
            {price(total)}
          </dd>
        </dl>
      </div>

      {phase === 'failed' ? (
        <div role="alert" className="rounded-panel bg-tint-fee-expired-bg p-5">
          <p className="font-semibold text-semantic-fee-expired">{t('failedTitle')}</p>
          <p className="mt-2 text-body leading-body">{t('failedBody')}</p>
        </div>
      ) : null}

      {phase === 'review' ? (
        <div role="status" className="rounded-panel bg-tint-fee-due-soon-bg p-5">
          <p className="font-semibold text-brand-obsidian">{t('reviewTitle')}</p>
          <p className="mt-2 text-body leading-body">{t('reviewBody', { phone: phoneDisplay })}</p>
        </div>
      ) : null}

      {phase === 'pending' ? (
        <div role="status" aria-live="polite" className="rounded-panel bg-tint-fee-due-soon-bg p-5">
          <p className="font-semibold text-brand-obsidian">{t('pendingTitle')}</p>
          <p className="mt-2 text-body leading-body">{t('pendingBody')}</p>
        </div>
      ) : null}

      {phase === 'expired' || phase === 'error' || phase === 'rateLimited' ? (
        <p role="alert" className="rounded-input bg-tint-fee-expired-bg p-3 text-body font-medium text-semantic-fee-expired">
          {te(phase === 'expired' ? 'expired' : phase === 'rateLimited' ? 'rateLimited' : 'generic')}
        </p>
      ) : null}

      {/* The date the member picked has passed. Trying again would send it again, so
          the only useful button is the one that moves it on (ADR-078). */}
      {phase === 'staleStart' && serverToday !== null ? (
        <div role="alert" className="rounded-panel bg-tint-fee-due-soon-bg p-5">
          <p className="font-semibold text-brand-obsidian">{t('staleStartTitle')}</p>
          <p className="mt-2 text-body leading-body">{t('staleStartBody', { date: formatISTDate(serverToday, locale) })}</p>
          <button
            type="button"
            onClick={() => {
              setStart(serverToday);
              void (receptionOnly ? payAtReception(serverToday) : payOnline(serverToday));
            }}
            className={cn(buttonVariants({ variant: 'primary', full: true }), 'mt-4')}
          >
            {t('staleStartAction', { date: formatISTDate(serverToday, locale) })}
          </button>
        </div>
      ) : null}

      {phase === 'creating' || phase === 'verifying' ? (
        <p role="status" className="text-center text-body">
          {phase === 'creating' ? t('creating') : t('processing')}
        </p>
      ) : null}

      {phase === 'review' || phase === 'pending' || phase === 'expired' || phase === 'staleStart'
        ? null
        : actions(phase === 'failed' ? t('tryAgain') : t('payNow', { amount: price(total) }))}

      {/* Nobody paying at the desk is being taken to a gateway, so nothing claims one. */}
      {receptionOnly ? null : <p className={cn('text-center text-small text-brand-stone')}>{t('secure')}</p>}

      <Dialog open={phase === 'demo'} onOpenChange={(open) => (open ? undefined : setPhase('idle'))}>
        <DialogContent>
          <DialogTitle className="font-display text-title font-bold text-brand-obsidian">{t('simulatedTitle')}</DialogTitle>
          <DialogDescription className="mt-2 text-body leading-body">{t('simulatedBody')}</DialogDescription>
          <p className="mt-3 font-display text-title font-bold text-brand-accent-deep">{order === null ? null : price(order.amountPaise)}</p>
          <div className="mt-5 grid gap-3">
            <button type="button" onClick={() => void simulate('success')} className={buttonVariants({ variant: 'primary', full: true })}>
              {t('simulateSuccess')}
            </button>
            <button type="button" onClick={() => void simulate('failure')} className={buttonVariants({ variant: 'outlineDark', full: true })}>
              {t('simulateFailure')}
            </button>
            <button type="button" onClick={() => setPhase('idle')} className={buttonVariants({ variant: 'ghost', full: true })}>
              {t('cancel')}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
