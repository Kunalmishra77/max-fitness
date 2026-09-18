'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState, useTransition, type ComponentType } from 'react';
import { addDays, addMonthsClamped, istDate } from '@mfp/shared';
import { SelfieCapture, type SelfieCaptureProps } from '@/components/join/selfie-capture';

/**
 * "I'm already a member", after scanning the reception QR (qr-onboarding-flow §3; ADR-058).
 *
 * One question per screen, as the desk wizard asks them, with the month-end date as a
 * step of its own because it is the one answer staff will check. The calendar allows
 * only the range the server accepts (sixty days back to thirteen months ahead). The
 * answers and the selfie go in one request; the reference code comes back for the
 * member to show at reception. A field the server refuses brings the member back to
 * that question with the reason.
 */

export type QrSubmitResult =
  | { readonly ok: true; readonly referenceCode: string }
  | { readonly ok: false; readonly code: 'VALIDATION_FAILED' | 'UNDER_MINIMUM_AGE' | 'SELFIE_REJECTED' | 'RATE_LIMITED' | 'generic'; readonly fields?: readonly string[] };

const STEPS = ['mobile', 'name', 'gender', 'dob', 'selfie', 'plan', 'endDate', 'amount', 'consent'] as const;
type Step = (typeof STEPS)[number];
const PLANS = ['1', '3', '6', '12', 'unsure'] as const;

/** Which question a refused field belongs to. */
const FIELD_STEP: Record<string, Step> = {
  mobile: 'mobile',
  fullName: 'name',
  gender: 'gender',
  dob: 'dob',
  selfie: 'selfie',
  declaredPlanMonths: 'plan',
  declaredEndDate: 'endDate',
  declaredAmount: 'amount',
  terms: 'consent',
  privacy: 'consent',
};

const pad = (value: string) => value.padStart(2, '0');

/** Posts to the API and reads its envelope (api-specification.md §1). */
export async function postQrExisting(form: FormData): Promise<QrSubmitResult> {
  try {
    const response = await fetch('/api/v1/qr/existing', { method: 'POST', body: form });
    const body = (await response.json().catch(() => ({}))) as {
      data?: { referenceCode?: string };
      error?: { code?: string; details?: { fields?: Record<string, string>; field?: string } };
    };
    if (response.ok && typeof body.data?.referenceCode === 'string') return { ok: true, referenceCode: body.data.referenceCode };
    const code = body.error?.code;
    const fields = [...Object.keys(body.error?.details?.fields ?? {}), ...(body.error?.details?.field === undefined ? [] : [body.error.details.field])];
    if (code === 'RATE_LIMITED') return { ok: false, code };
    if (code === 'UNDER_MINIMUM_AGE') return { ok: false, code, fields: ['dob'] };
    if (code === 'SELFIE_REJECTED') return { ok: false, code, fields: ['selfie'] };
    if (code === 'VALIDATION_FAILED') return { ok: false, code, fields };
    return { ok: false, code: 'generic' };
  } catch {
    return { ok: false, code: 'generic' };
  }
}

export function QrExistingFlow({
  today,
  minAge,
  noticeVersion,
  termsHref,
  privacyHref,
  submit = postQrExisting,
  onSubmitted,
  Camera = SelfieCapture,
}: {
  today: string;
  minAge: number;
  noticeVersion: string;
  termsHref: string;
  privacyHref: string;
  submit?: (form: FormData) => Promise<QrSubmitResult>;
  onSubmitted: (referenceCode: string) => void;
  /** Injected in tests; the real sheet needs a camera. */
  Camera?: ComponentType<SelfieCaptureProps>;
}) {
  const t = useTranslations('qr.existing');
  const locale = useLocale();
  const id = useId();
  const [step, setStep] = useState<Step>('mobile');
  const [mobile, setMobile] = useState('');
  const [fullName, setFullName] = useState('');
  const [gender, setGender] = useState<'MALE' | 'FEMALE' | null>(null);
  const [dob, setDob] = useState({ day: '', month: '', year: '' });
  const [photo, setPhoto] = useState<{ blob: Blob; url: string } | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [plan, setPlan] = useState<(typeof PLANS)[number] | null>(null);
  const [endDate, setEndDate] = useState('');
  const [amount, setAmount] = useState('');
  const [terms, setTerms] = useState(false);
  const [whatsapp, setWhatsapp] = useState(false);
  const [face, setFace] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const photoUrl = useRef<string | null>(null);

  useEffect(
    () => () => {
      if (photoUrl.current !== null) URL.revokeObjectURL(photoUrl.current);
    },
    [],
  );

  const todayDate = istDate(today);
  const minEnd = addDays(todayDate, -60);
  const maxEnd = addMonthsClamped(todayDate, 13);
  const index = STEPS.indexOf(step);
  const dobValue = dob.day === '' || dob.month === '' || dob.year.length !== 4 ? '' : `${dob.year}-${pad(dob.month)}-${pad(dob.day)}`;

  const canContinue: Record<Step, boolean> = {
    mobile: mobile.replace(/\D/g, '').length >= 10,
    name: fullName.trim().length >= 2,
    gender: gender !== null,
    dob: dobValue !== '',
    selfie: photo !== null,
    plan: plan !== null,
    endDate: endDate !== '' && endDate >= minEnd && endDate <= maxEnd,
    amount: amount === '' || /^\d+$/.test(amount),
    consent: terms,
  };

  const go = (delta: 1 | -1) => {
    setError(null);
    const next = STEPS[index + delta];
    if (next !== undefined) setStep(next);
  };

  const keepPhoto = (blob: Blob) => {
    if (photoUrl.current !== null) URL.revokeObjectURL(photoUrl.current);
    const url = URL.createObjectURL(blob);
    photoUrl.current = url;
    setPhoto({ blob, url });
  };

  const send = () => {
    if (photo === null || gender === null) return;
    setError(null);
    const form = new FormData();
    form.set('mobile', mobile);
    form.set('fullName', fullName.trim());
    form.set('gender', gender);
    form.set('dob', dobValue);
    form.set('language', locale === 'hi' ? 'hi' : 'en');
    form.set('noticeVersion', noticeVersion);
    form.set('consents', JSON.stringify({ terms, privacy: terms, whatsappUpdates: whatsapp, faceAttendance: face }));
    form.set('declaredPlanMonths', plan === null || plan === 'unsure' ? '' : plan);
    form.set('declaredEndDate', endDate);
    form.set('declaredAmount', amount);
    form.set('selfie', photo.blob, 'selfie.jpg');

    start(async () => {
      const result = await submit(form);
      if (result.ok) {
        onSubmitted(result.referenceCode);
        return;
      }
      const field = result.fields?.find((name) => FIELD_STEP[name] !== undefined);
      if (result.code === 'UNDER_MINIMUM_AGE') {
        setStep('dob');
        setError(t('errors.underAge', { minAge }));
      } else if (result.code === 'RATE_LIMITED') {
        setError(t('errors.rateLimited'));
      } else if (field !== undefined) {
        setStep(FIELD_STEP[field] ?? 'consent');
        setError(t(`errors.${field === 'privacy' ? 'terms' : field}` as never));
      } else {
        setError(t('errors.generic'));
      }
    });
  };

  const input = 'mt-3 min-h-16 w-full rounded-input border-2 border-brand-rubber-grey/40 bg-white px-4 text-body-l';
  const title = 'font-display text-title font-bold text-brand-plate-navy';
  const choice = (selected: boolean) =>
    `min-h-16 w-full rounded-panel border-2 text-body-l font-semibold ${selected ? 'border-brand-signboard-red bg-tint-fee-expired-bg text-brand-signboard-red' : 'border-brand-rubber-grey/40 bg-white'}`;
  const primary = 'min-h-16 w-full rounded-panel bg-brand-signboard-red text-body-l font-bold text-white disabled:opacity-50';

  return (
    <div className="mx-auto max-w-lg">
      <p className="text-small text-brand-rubber-grey">{t('step', { current: index + 1, total: STEPS.length })}</p>
      <div aria-hidden className="mt-2 flex gap-1">
        {STEPS.map((name, i) => (
          <span key={name} className={`h-1.5 flex-1 rounded-full ${i <= index ? 'bg-brand-signboard-red' : 'bg-brand-rubber-grey/25'}`} />
        ))}
      </div>

      <div className="mt-6">
        {step === 'mobile' ? (
          <div>
            <label htmlFor={`${id}-mobile`} className={title}>
              {t('mobileTitle')}
            </label>
            <input
              id={`${id}-mobile`}
              type="tel"
              inputMode="numeric"
              autoComplete="tel-national"
              maxLength={14}
              aria-label={t('mobileLabel')}
              value={mobile}
              onChange={(event) => setMobile(event.target.value)}
              className={`${input} text-2xl tracking-widest`}
            />
          </div>
        ) : null}

        {step === 'name' ? (
          <div>
            <label htmlFor={`${id}-name`} className={title}>
              {t('nameTitle')}
            </label>
            <input id={`${id}-name`} type="text" autoComplete="name" aria-label={t('nameLabel')} value={fullName} onChange={(event) => setFullName(event.target.value)} className={input} />
          </div>
        ) : null}

        {step === 'gender' ? (
          <div>
            <h2 className={title}>{t('genderTitle')}</h2>
            <div className="mt-4 grid gap-3">
              {(['MALE', 'FEMALE'] as const).map((value) => (
                <button key={value} type="button" aria-pressed={gender === value} onClick={() => setGender(value)} className={choice(gender === value)}>
                  {t(value)}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {step === 'dob' ? (
          <div>
            <h2 className={title}>{t('dobTitle')}</h2>
            <div className="mt-3 grid grid-cols-3 gap-3">
              {(
                [
                  ['day', t('dobDay'), 2],
                  ['month', t('dobMonth'), 2],
                  ['year', t('dobYear'), 4],
                ] as const
              ).map(([key, label, length]) => (
                <span key={key}>
                  <label htmlFor={`${id}-${key}`} className="block text-small font-semibold text-brand-rubber-grey">
                    {label}
                  </label>
                  <input
                    id={`${id}-${key}`}
                    type="text"
                    inputMode="numeric"
                    maxLength={length}
                    value={dob[key]}
                    onChange={(event) => setDob({ ...dob, [key]: event.target.value.replace(/\D/g, '') })}
                    className={`${input} mt-1 text-center text-2xl`}
                  />
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {step === 'selfie' ? (
          <div className="text-center">
            <h2 className={title}>{t('selfieTitle')}</h2>
            <p className="mt-2 text-body text-brand-rubber-grey">{t('selfieHelper')}</p>
            {photo === null ? null : (
              // A local object URL: next/image cannot optimise it and must not try.
              <img src={photo.url} alt={t('selfieDone')} className="mx-auto mt-4 size-48 rounded-full object-cover" />
            )}
            <button type="button" onClick={() => setCameraOpen(true)} className={`mt-4 ${choice(false)}`}>
              {photo === null ? t('selfieTake') : t('selfieRetake')}
            </button>
            <Camera open={cameraOpen} onOpenChange={setCameraOpen} onCaptured={keepPhoto} />
          </div>
        ) : null}

        {step === 'plan' ? (
          <div>
            <h2 className={title}>{t('planTitle')}</h2>
            <div className="mt-4 grid grid-cols-2 gap-3">
              {PLANS.map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={plan === value}
                  onClick={() => setPlan(value)}
                  className={`${choice(plan === value)} ${value === 'unsure' ? 'col-span-2' : ''}`}
                >
                  {value === 'unsure' ? t('planUnsure') : t(`plan${value}` as never)}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {step === 'endDate' ? (
          <div>
            <h2 className={title}>{t('endTitle')}</h2>
            <label htmlFor={`${id}-end`} className="mt-4 block text-body font-semibold">
              {t('endLabel')}
            </label>
            <input id={`${id}-end`} type="date" min={minEnd} max={maxEnd} value={endDate} onChange={(event) => setEndDate(event.target.value)} className={input} />
            <p className="mt-2 text-body text-brand-rubber-grey">{t('endHelper')}</p>
          </div>
        ) : null}

        {step === 'amount' ? (
          <div>
            <h2 className={title}>{t('amountTitle')}</h2>
            <label htmlFor={`${id}-amount`} className="mt-4 block text-body font-semibold">
              {t('amountLabel')}
            </label>
            <input
              id={`${id}-amount`}
              type="text"
              inputMode="numeric"
              value={amount}
              onChange={(event) => setAmount(event.target.value.replace(/[^\d]/g, ''))}
              className={`${input} text-2xl`}
            />
          </div>
        ) : null}

        {step === 'consent' ? (
          <div>
            <h2 className={title}>{t('consentTitle')}</h2>
            <div className="mt-4 grid gap-4">
              {(
                [
                  [terms, setTerms, t('consentTerms')],
                  [whatsapp, setWhatsapp, t('consentWhatsapp')],
                  [face, setFace, t('consentFace')],
                ] as const
              ).map(([checked, set, label]) => (
                <label key={label} className="flex min-h-14 items-start gap-3 text-body">
                  <input type="checkbox" checked={checked} onChange={(event) => set(event.target.checked)} className="mt-1 size-6 accent-brand-plate-navy" />
                  <span>{label}</span>
                </label>
              ))}
            </div>
            <p className="mt-2 flex flex-wrap gap-x-4 text-small">
              <a href={termsHref} target="_blank" rel="noopener" className="font-semibold text-brand-wall-blue underline underline-offset-2">
                {t('readTerms')}
              </a>
              <a href={privacyHref} target="_blank" rel="noopener" className="font-semibold text-brand-wall-blue underline underline-offset-2">
                {t('readPrivacy')}
              </a>
            </p>
          </div>
        ) : null}
      </div>

      {error === null ? null : (
        <p role="alert" className="mt-4 rounded-input bg-tint-fee-expired-bg p-3 text-body font-medium text-semantic-fee-expired">
          {error}
        </p>
      )}

      <div className="mt-8 grid gap-3">
        {step === 'consent' ? (
          <button type="button" disabled={!canContinue.consent || pending} onClick={send} className={primary}>
            {pending ? t('sending') : t('send')}
          </button>
        ) : (
          <button type="button" disabled={!canContinue[step]} onClick={() => go(1)} className={primary}>
            {t('next')}
          </button>
        )}
        {index === 0 ? null : (
          <button type="button" onClick={() => go(-1)} className="min-h-14 w-full text-body font-semibold text-brand-rubber-grey">
            {t('back')}
          </button>
        )}
      </div>
    </div>
  );
}

