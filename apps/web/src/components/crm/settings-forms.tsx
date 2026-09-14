'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useId, useState, useTransition, type ReactNode } from 'react';
import type { HoursInput, PriceInput, SettingsPatchInput, SettingsResult, UnlockResult } from '@/lib/settings-types';

/**
 * The owner's settings forms (crm-ux-blueprint §14).
 *
 * One section per subject, each with its own Save, so changing the offer never
 * re-sends the prices. The PIN lasts five minutes: if it lapses while the owner is
 * typing, the section asks for it right there and then saves what was typed — nothing
 * is thrown away because a clock ran out.
 */

type Unlock = (pin: string) => Promise<UnlockResult>;

const field = 'min-h-14 w-full rounded-input border-2 border-brand-rubber-grey/40 bg-white px-4 text-crm-body';
const inr = (rupees: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(rupees);

// ── PIN ─────────────────────────────────────────────────────────────────────

export function PinGate({ unlock, onUnlocked, compact = false, title }: { unlock: Unlock; onUnlocked: () => void; compact?: boolean; title?: string }) {
  const t = useTranslations('crm.settings');
  const id = useId();
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = () => {
    setError(null);
    start(async () => {
      const result = await unlock(pin);
      setPin('');
      if (result.ok) onUnlocked();
      else setError(result.code === 'ACCOUNT_LOCKED' ? t('locked') : result.code === 'INVALID_PIN' ? t('wrongPin') : t('failed'));
    });
  };

  return (
    <div className={compact ? 'mt-3 rounded-panel bg-tint-fee-none-bg p-3' : 'p-6'}>
      <p className="text-crm-body font-bold text-brand-plate-navy">{title ?? (compact ? t('pinExpired') : t('pinTitle'))}</p>
      {compact ? null : <p className="mt-1 text-small text-brand-rubber-grey">{t('pinHelper')}</p>}
      <label htmlFor={`${id}-pin`} className="mt-3 block text-small font-semibold">
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
        className={`${field} mt-1 text-center text-2xl tracking-widest`}
      />
      {error === null ? null : (
        <p role="alert" className="mt-2 text-crm-body font-medium text-semantic-fee-expired">
          {error}
        </p>
      )}
      <button
        type="button"
        disabled={pending || pin.length < 4}
        onClick={submit}
        className="mt-3 min-h-14 w-full rounded-panel bg-brand-plate-navy text-crm-body font-bold text-white disabled:opacity-50"
      >
        {t('unlock')}
      </button>
    </div>
  );
}

/** The full-screen gate when settings are opened without a fresh PIN. */
export function SettingsUnlock({ unlock }: { unlock: Unlock }) {
  const router = useRouter();
  return <PinGate unlock={unlock} onUnlocked={() => router.refresh()} />;
}

// ── Section with its own Save ───────────────────────────────────────────────

function Section({ title, helper, unlock, save, children }: { title: string; helper?: string; unlock: Unlock; save: () => Promise<SettingsResult>; children: ReactNode }) {
  const t = useTranslations('crm.settings');
  const id = useId();
  const [status, setStatus] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);
  const [needsPin, setNeedsPin] = useState(false);
  const [pending, start] = useTransition();

  const run = () => {
    setStatus(null);
    start(async () => {
      const result = await save();
      if (result.ok) {
        setStatus({ text: result.changed ? t('saved') : t('noChange'), tone: 'ok' });
      } else if (result.code === 'PIN_REQUIRED') {
        setNeedsPin(true);
      } else {
        setStatus({ text: result.code === 'VALIDATION_FAILED' ? t('invalid') : result.code === 'FORBIDDEN' ? t('notAllowed') : t('failed'), tone: 'error' });
      }
    });
  };

  return (
    <section aria-labelledby={`${id}-title`} className="rounded-panel bg-white p-4 shadow-sm">
      <h2 id={`${id}-title`} className="text-crm-body font-bold text-brand-plate-navy">
        {title}
      </h2>
      {helper === undefined ? null : <p className="mt-1 text-small text-brand-rubber-grey">{helper}</p>}
      <div className="mt-3 grid gap-3">{children}</div>

      {needsPin ? (
        <PinGate
          compact
          unlock={unlock}
          onUnlocked={() => {
            setNeedsPin(false);
            run();
          }}
        />
      ) : null}

      {status === null ? null : (
        <p role="status" className={`mt-3 text-crm-body font-medium ${status.tone === 'ok' ? 'text-semantic-fee-paid' : 'text-semantic-fee-expired'}`}>
          {status.text}
        </p>
      )}
      <button
        type="button"
        disabled={pending}
        onClick={run}
        className="mt-3 min-h-14 w-full rounded-panel bg-brand-signboard-red text-crm-body font-bold text-white disabled:opacity-50"
      >
        {pending ? t('saving') : t('save')}
      </button>
    </section>
  );
}

// ── Prices ──────────────────────────────────────────────────────────────────

export interface PlanPrice {
  readonly code: string;
  readonly gender: 'MALE' | 'FEMALE';
  readonly durationMonths: number;
  readonly pricePaise: number;
}

export function PricesForm({ plans, save, unlock }: { plans: readonly PlanPrice[]; save: (prices: readonly PriceInput[]) => Promise<SettingsResult>; unlock: Unlock }) {
  const t = useTranslations('crm.settings');
  const [rupees, setRupees] = useState<Record<string, number>>(() => Object.fromEntries(plans.map((plan) => [plan.code, plan.pricePaise / 100])));
  const set = (code: string, value: number) => setRupees((current) => ({ ...current, [code]: Math.max(0, Math.round(value)) }));

  return (
    <Section
      title={t('prices')}
      helper={t('pricesHelper')}
      unlock={unlock}
      save={() => save(plans.map((plan) => ({ code: plan.code, pricePaise: (rupees[plan.code] ?? 0) * 100 })))}
    >
      {(['MALE', 'FEMALE'] as const).map((gender) => (
        <div key={gender}>
          <p className="text-small font-semibold text-brand-rubber-grey">{t(gender)}</p>
          {/*
            One tile per row on a phone: two columns at 360px left the price field 30px wide.
            An explicit width, not `sm:` — this project's `sm` breakpoint sits at phone width.
          */}
          <div className="mt-2 grid grid-cols-1 gap-2 min-[480px]:grid-cols-2">
            {plans
              .filter((plan) => plan.gender === gender)
              .map((plan) => {
                const value = rupees[plan.code] ?? 0;
                const label = `${t(gender)} · ${t('months', { count: plan.durationMonths })}`;
                return (
                  <div key={plan.code} className="rounded-panel border border-brand-rubber-grey/20 p-2">
                    <p className="text-small font-semibold">{t('months', { count: plan.durationMonths })}</p>
                    <div className="mt-1 flex items-center gap-1">
                      <button type="button" aria-label={`${label}: ${t('minus')}`} onClick={() => set(plan.code, value - 100)} className="size-11 shrink-0 rounded-button bg-tint-fee-none-bg text-xl font-bold">
                        −
                      </button>
                      <input
                        type="number"
                        inputMode="numeric"
                        min={100}
                        step={100}
                        aria-label={label}
                        value={value}
                        onChange={(event) => set(plan.code, Number(event.target.value))}
                        className="min-h-11 w-full min-w-0 rounded-input border-2 border-brand-rubber-grey/40 px-1 text-center text-crm-body tabular-nums"
                      />
                      <button type="button" aria-label={`${label}: ${t('plus')}`} onClick={() => set(plan.code, value + 100)} className="size-11 shrink-0 rounded-button bg-tint-fee-none-bg text-xl font-bold">
                        +
                      </button>
                    </div>
                    <p className="mt-1 text-small text-brand-rubber-grey">{t('perMonth', { amount: inr(Math.round(value / plan.durationMonths / 10) * 10) })}</p>
                  </div>
                );
              })}
          </div>
        </div>
      ))}
    </Section>
  );
}

// ── Joining rules ───────────────────────────────────────────────────────────

export function JoiningForm({
  admissionFeeRupees,
  minAge,
  save,
  unlock,
}: {
  admissionFeeRupees: number;
  minAge: number;
  save: (patch: SettingsPatchInput) => Promise<SettingsResult>;
  unlock: Unlock;
}) {
  const t = useTranslations('crm.settings');
  const id = useId();
  const [fee, setFee] = useState(admissionFeeRupees);
  const [age, setAge] = useState(minAge);

  return (
    <Section title={t('joining')} unlock={unlock} save={() => save({ pricing: { admissionFeePaise: Math.round(fee) * 100 }, privacy: { minAge: Math.round(age) } })}>
      <div>
        <label htmlFor={`${id}-fee`} className="block text-small font-semibold">
          {t('admissionFee')}
        </label>
        <input id={`${id}-fee`} type="number" inputMode="numeric" min={0} step={100} value={fee} onChange={(event) => setFee(Number(event.target.value))} className={`${field} mt-1`} />
      </div>
      <div>
        <label htmlFor={`${id}-age`} className="block text-small font-semibold">
          {t('minAge')}
        </label>
        <input id={`${id}-age`} type="number" inputMode="numeric" min={12} max={21} value={age} onChange={(event) => setAge(Number(event.target.value))} className={`${field} mt-1`} />
      </div>
    </Section>
  );
}

// ── Website offer ───────────────────────────────────────────────────────────

export function PromoForm({
  enabled,
  textHi,
  textEn,
  save,
  unlock,
}: {
  enabled: boolean;
  textHi: string;
  textEn: string;
  save: (patch: SettingsPatchInput) => Promise<SettingsResult>;
  unlock: Unlock;
}) {
  const t = useTranslations('crm.settings');
  const id = useId();
  const [on, setOn] = useState(enabled);
  const [hi, setHi] = useState(textHi);
  const [en, setEn] = useState(textEn);

  return (
    <Section title={t('promo')} unlock={unlock} save={() => save({ promo: { enabled: on, textHi: hi.trim(), textEn: en.trim() } })}>
      <label className="flex min-h-11 items-center gap-3 text-crm-body">
        <input type="checkbox" checked={on} onChange={(event) => setOn(event.target.checked)} className="size-6 accent-brand-plate-navy" />
        {t('promoEnabled')}
      </label>
      {(
        [
          ['hi', t('promoHi'), hi, setHi],
          ['en', t('promoEn'), en, setEn],
        ] as const
      ).map(([key, label, value, setValue]) => (
        <div key={key}>
          <label htmlFor={`${id}-${key}`} className="block text-small font-semibold">
            {label}
          </label>
          <textarea
            id={`${id}-${key}`}
            maxLength={120}
            rows={2}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            className="mt-1 w-full rounded-input border-2 border-brand-rubber-grey/40 bg-white p-3 text-crm-body"
          />
          <p className="text-right text-small text-brand-rubber-grey tabular-nums">{t('chars', { count: value.length })}</p>
        </div>
      ))}
    </Section>
  );
}

// ── Trust numbers ───────────────────────────────────────────────────────────

export interface TrustValues {
  readonly googleRating: number;
  readonly googleReviews: number;
  readonly justdialRating: number;
  readonly justdialReviews: number;
  readonly establishedYear: number;
}

export function TrustForm({ trust, save, unlock }: { trust: TrustValues; save: (patch: SettingsPatchInput) => Promise<SettingsResult>; unlock: Unlock }) {
  const t = useTranslations('crm.settings');
  const id = useId();
  const [values, setValues] = useState<TrustValues>(trust);
  const rows = [
    ['googleRating', 0.1],
    ['googleReviews', 1],
    ['justdialRating', 0.1],
    ['justdialReviews', 1],
    ['establishedYear', 1],
  ] as const;

  return (
    <Section title={t('trust')} unlock={unlock} save={() => save({ trust: values })}>
      <div className="grid grid-cols-2 gap-3">
        {rows.map(([key, step]) => (
          <div key={key}>
            <label htmlFor={`${id}-${key}`} className="block text-small font-semibold">
              {t(key)}
            </label>
            <input
              id={`${id}-${key}`}
              type="number"
              inputMode="decimal"
              step={step}
              value={values[key]}
              onChange={(event) => setValues((current) => ({ ...current, [key]: Number(event.target.value) }))}
              className={`${field} mt-1`}
            />
          </div>
        ))}
      </div>
    </Section>
  );
}

// ── Opening hours ───────────────────────────────────────────────────────────

/** Monday first, the way the week is read on a noticeboard. */
const WEEK = [1, 2, 3, 4, 5, 6, 0] as const;

export function HoursForm({ hours, save, unlock }: { hours: readonly HoursInput[]; save: (patch: SettingsPatchInput) => Promise<SettingsResult>; unlock: Unlock }) {
  const t = useTranslations('crm.settings');
  const [rows, setRows] = useState<HoursInput[]>(() =>
    WEEK.map((day) => hours.find((row) => row.day === day) ?? { day, open: '05:00', close: '22:00', closed: false }),
  );
  const update = (day: number, change: Partial<HoursInput>) => setRows((current) => current.map((row) => (row.day === day ? { ...row, ...change } : row)));

  return (
    <Section title={t('hours')} unlock={unlock} save={() => save({ hours: rows })}>
      {rows.map((row) => {
        const dayName = t(`days.${row.day}` as never);
        return (
          <div key={row.day} className="grid grid-cols-[1fr_auto] items-center gap-2 border-b border-brand-rubber-grey/15 pb-2">
            <span className="text-crm-body font-semibold">{dayName}</span>
            <label className="flex items-center gap-2 text-small">
              <input type="checkbox" checked={row.closed} onChange={(event) => update(row.day, { closed: event.target.checked })} className="size-5 accent-brand-plate-navy" />
              {t('closedDay')}
            </label>
            {row.closed ? null : (
              <div className="col-span-2 grid grid-cols-2 gap-2">
                <input type="time" aria-label={`${dayName} ${t('open')}`} value={row.open} onChange={(event) => update(row.day, { open: event.target.value })} className={field} />
                <input type="time" aria-label={`${dayName} ${t('close')}`} value={row.close} onChange={(event) => update(row.day, { close: event.target.value })} className={field} />
              </div>
            )}
          </div>
        );
      })}
    </Section>
  );
}
