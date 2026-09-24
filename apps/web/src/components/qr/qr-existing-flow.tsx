'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState, useTransition, type ComponentType } from 'react';
import { addDays, addMonthsClamped, formatISTDate, istDate, type ISTDate } from '@mfp/shared';
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
 *
 * With the gym's OTP switch on (ADR-060), the number is confirmed with a code first, and
 * only then may the phone see the register entries on it and say "this is me".
 */

export type QrSubmitResult =
  | { readonly ok: true; readonly referenceCode: string }
  | {
      readonly ok: false;
      /**
       * The named refusals the screen reacts to, or whatever else the server said.
       *
       * Open rather than a closed list: a member stuck on something we did not
       * anticipate should be shown the code and a reference, not "generic" (ADR-075).
       */
      readonly code: string;
      readonly fields?: readonly string[];
      /** So a member who cannot get past this can quote something to reception. */
      readonly requestId?: string | undefined;
      readonly minAge?: number | undefined;
      readonly attemptsLeft?: number | undefined;
    };

/** A register entry on a proven number, as `/qr/lookup` returns it. */
export interface QrCandidateItem {
  readonly memberId: string;
  readonly firstName: string;
  readonly lastInitial: string | null;
  readonly planMonths: number | null;
  readonly monthEnd: string | null;
}

export interface OtpApi {
  send: (
    mobile: string,
    language: 'hi' | 'en',
  ) => Promise<
    { ok: true; demoCode?: string } | { ok: false; code: 'RATE_LIMITED' | 'VALIDATION_FAILED' | 'generic' }
  >;
  verify: (
    mobile: string,
    code: string,
  ) => Promise<
    | { ok: true; otpToken: string }
    | { ok: false; code: 'OTP_INVALID' | 'OTP_EXPIRED' | 'OTP_LOCKED' | 'generic'; attemptsLeft?: number }
  >;
  lookup: (mobile: string, otpToken: string) => Promise<readonly QrCandidateItem[]>;
}

async function postJson(
  path: string,
  body: unknown,
): Promise<{
  ok: boolean;
  data?: Record<string, unknown>;
  error?: { code?: string; details?: Record<string, unknown> };
}> {
  try {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const parsed = (await response.json().catch(() => ({}))) as {
      data?: Record<string, unknown>;
      error?: { code?: string; details?: Record<string, unknown> };
    };
    return { ok: response.ok, ...parsed };
  } catch {
    return { ok: false };
  }
}

/** The OTP routes (api-specification §/otp, §/qr/lookup). */
export const fetchOtpApi: OtpApi = {
  async send(mobile, language) {
    const result = await postJson('/api/v1/otp/send', { mobile, purpose: 'QR_EXISTING', language });
    if (result.ok)
      return typeof result.data?.['demoCode'] === 'string'
        ? { ok: true, demoCode: result.data['demoCode'] }
        : { ok: true };
    const code = result.error?.code;
    return {
      ok: false,
      code:
        code === 'RATE_LIMITED' || code === 'OTP_RATE_LIMITED'
          ? 'RATE_LIMITED'
          : code === 'VALIDATION_FAILED'
            ? 'VALIDATION_FAILED'
            : 'generic',
    };
  },
  async verify(mobile, code) {
    const result = await postJson('/api/v1/otp/verify', { mobile, purpose: 'QR_EXISTING', code });
    if (result.ok && typeof result.data?.['otpToken'] === 'string')
      return { ok: true, otpToken: result.data['otpToken'] };
    const failure = result.error?.code;
    const left = result.error?.details?.['attemptsLeft'];
    if (failure === 'OTP_INVALID')
      return { ok: false, code: failure, ...(typeof left === 'number' ? { attemptsLeft: left } : {}) };
    if (failure === 'OTP_EXPIRED' || failure === 'OTP_LOCKED') return { ok: false, code: failure };
    if (failure === 'VALIDATION_FAILED') return { ok: false, code: 'OTP_INVALID' };
    return { ok: false, code: 'generic' };
  },
  async lookup(mobile, otpToken) {
    const result = await postJson('/api/v1/qr/lookup', { mobile, otpToken });
    const candidates = result.data?.['candidates'];
    return result.ok && Array.isArray(candidates) ? (candidates as QrCandidateItem[]) : [];
  },
};

const BASE_STEPS = [
  'mobile',
  'name',
  'gender',
  'dob',
  'selfie',
  'plan',
  'endDate',
  'amount',
  'consent',
] as const;
const OTP_STEPS = [
  'mobile',
  'code',
  'match',
  'name',
  'gender',
  'dob',
  'selfie',
  'plan',
  'endDate',
  'amount',
  'consent',
] as const;
type Step = (typeof OTP_STEPS)[number];
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
      error?: { code?: string; details?: { fields?: Record<string, string>; field?: string; minAge?: number } };
      meta?: { requestId?: string };
    };
    if (response.ok && typeof body.data?.referenceCode === 'string') return { ok: true, referenceCode: body.data.referenceCode };
    const code = body.error?.code;
    const fields = [
      ...Object.keys(body.error?.details?.fields ?? {}),
      ...(body.error?.details?.field === undefined ? [] : [body.error.details.field]),
    ];
    // Carried through so a member who cannot get past this can show reception a
    // reference rather than "it did not work" (ADR-075).
    const requestId = body.meta?.requestId;
    if (code === 'RATE_LIMITED' || code === 'OTP_REQUIRED') return { ok: false, code, requestId };
    if (code === 'UNDER_MINIMUM_AGE') return { ok: false, code, fields: ['dob'], requestId, minAge: body.error?.details?.minAge };
    if (code === 'SELFIE_REJECTED') return { ok: false, code, fields: ['selfie'], requestId };
    if (code === 'VALIDATION_FAILED') return { ok: false, code, fields, requestId };
    return { ok: false, code: code ?? `HTTP ${response.status}`, requestId };
  } catch {
    // The request never arrived: no code, no reference, and saying otherwise would
    // send the member to reception with a number that means nothing.
    return { ok: false, code: 'NETWORK' };
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
  otpRequired = false,
  otpApi = fetchOtpApi,
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
  /** The gym's `features.otpRequired` switch. */
  otpRequired?: boolean;
  /** Injected in tests. */
  otpApi?: OtpApi;
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
  const [code, setCode] = useState('');
  const [demoCode, setDemoCode] = useState<string | null>(null);
  const [otpToken, setOtpToken] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<readonly QrCandidateItem[]>([]);
  const [claimed, setClaimed] = useState<string | null>(null);
  const [otpBusy, setOtpBusy] = useState(false);
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
  const STEPS: readonly Step[] = otpRequired ? OTP_STEPS : BASE_STEPS;
  const index = STEPS.indexOf(step);
  const language = locale === 'hi' ? 'hi' : 'en';
  const dobValue =
    dob.day === '' || dob.month === '' || dob.year.length !== 4
      ? ''
      : `${dob.year}-${pad(dob.month)}-${pad(dob.day)}`;

  const canContinue: Record<Step, boolean> = {
    mobile: mobile.replace(/\D/g, '').length >= 10,
    code: /^\d{6}$/.test(code),
    match: claimed !== null,
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
    let next = STEPS[index + delta];
    // Nobody in the register on this number: there is no "is this you" to go back to.
    if (next === 'match' && candidates.length === 0) next = STEPS[index + 2 * delta];
    if (next !== undefined) setStep(next);
  };

  const changeMobile = (value: string) => {
    setMobile(value);
    // A token proves one number; a new number starts again.
    setOtpToken(null);
    setCandidates([]);
    setClaimed(null);
    setDemoCode(null);
  };

  const requestCode = async () => {
    setError(null);
    setOtpBusy(true);
    const result = await otpApi.send(mobile, language);
    setOtpBusy(false);
    if (!result.ok) {
      setError(
        result.code === 'RATE_LIMITED'
          ? t('otpErrors.rateLimited')
          : result.code === 'VALIDATION_FAILED'
            ? t('errors.mobile')
            : t('errors.generic'),
      );
      return;
    }
    setCode('');
    setDemoCode(result.demoCode ?? null);
    setStep('code');
  };

  const checkCode = async () => {
    setError(null);
    setOtpBusy(true);
    const result = await otpApi.verify(mobile, code);
    if (!result.ok) {
      setOtpBusy(false);
      if (result.code === 'OTP_INVALID') setError(t('otpErrors.code', { left: result.attemptsLeft ?? 0 }));
      else if (result.code === 'OTP_EXPIRED') setError(t('otpErrors.expired'));
      else if (result.code === 'OTP_LOCKED') setError(t('otpErrors.locked'));
      else setError(t('errors.generic'));
      return;
    }
    setOtpToken(result.otpToken);
    const found = await otpApi.lookup(mobile, result.otpToken);
    setOtpBusy(false);
    setCandidates(found);
    setClaimed(null);
    setStep(found.length > 0 ? 'match' : 'name');
  };

  const pick = (candidate: QrCandidateItem | null) => {
    setClaimed(candidate === null ? 'none' : candidate.memberId);
    if (candidate !== null && fullName.trim() === '') setFullName(candidate.firstName);
  };

  const candidateLabel = (candidate: QrCandidateItem) =>
    t('matchOption', {
      name:
        candidate.lastInitial === null
          ? candidate.firstName
          : `${candidate.firstName} ${candidate.lastInitial}.`,
      plan: candidate.planMonths === null ? t('matchPlanUnknown') : t(`plan${candidate.planMonths}` as never),
      date:
        candidate.monthEnd === null ? t('matchNoDate') : formatISTDate(candidate.monthEnd as ISTDate, locale),
    });

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
    if (otpToken !== null) form.set('otpToken', otpToken);
    if (claimed !== null && claimed !== 'none') form.set('claimedMemberId', claimed);

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
      } else if (result.code === 'OTP_REQUIRED') {
        // The 15-minute token ran out while the member was answering.
        setOtpToken(null);
        setStep('mobile');
        setError(t('otpErrors.required'));
      } else if (field !== undefined) {
        setStep(FIELD_STEP[field] ?? 'consent');
        setError(t(`errors.${field === 'privacy' ? 'terms' : field}` as never));
      } else {
        setError(t('errors.generic'));
      }
    });
  };

  const input = 'mt-3 min-h-16 w-full rounded-input border-2 border-brand-stone/40 bg-white px-4 text-body-l';
  const title = 'font-display text-title font-bold text-brand-obsidian';
  const choice = (selected: boolean) =>
    `min-h-16 w-full rounded-panel border-2 text-body-l font-semibold ${selected ? 'border-brand-accent bg-tint-fee-expired-bg text-brand-accent' : 'border-brand-stone/40 bg-white'}`;
  const primary = 'min-h-16 w-full rounded-panel bg-brand-accent text-body-l font-bold text-brand-white disabled:opacity-50';

  return (
    <div className="mx-auto max-w-lg">
      <p className="text-small text-brand-stone">{t('step', { current: index + 1, total: STEPS.length })}</p>
      <div aria-hidden className="mt-2 flex gap-1">
        {STEPS.map((name, i) => (
          <span key={name} className={`h-1.5 flex-1 rounded-full ${i <= index ? 'bg-brand-accent' : 'bg-brand-stone/25'}`} />
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
              onChange={(event) => changeMobile(event.target.value)}
              className={`${input} text-2xl tracking-widest`}
            />
          </div>
        ) : null}

        {step === 'code' ? (
          <div>
            <h2 className={title}>{t('codeTitle')}</h2>
            <p className="text-body text-brand-stone mt-2">{t('codeHelper', { mobile })}</p>
            <label htmlFor={`${id}-code`} className="text-body mt-4 block font-semibold">
              {t('codeLabel')}
            </label>
            <input
              id={`${id}-code`}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
              className={`${input} text-center text-3xl tracking-[0.5em]`}
            />
            {demoCode === null ? null : (
              <p className="rounded-input border-brand-link/50 text-body text-brand-link mt-3 border-2 border-dashed bg-white p-3 text-center font-semibold">
                {t('demoCode', { code: demoCode })}
              </p>
            )}
            <button
              type="button"
              disabled={otpBusy}
              onClick={() => void requestCode()}
              className="text-body text-brand-link mt-3 min-h-14 w-full font-semibold underline underline-offset-2"
            >
              {t('resend')}
            </button>
          </div>
        ) : null}

        {step === 'match' ? (
          <div>
            <h2 className={title}>{t('matchTitle')}</h2>
            <p className="text-body text-brand-stone mt-2">{t('matchHelper')}</p>
            <div className="mt-4 grid gap-3">
              {candidates.map((candidate) => (
                <button
                  key={candidate.memberId}
                  type="button"
                  aria-pressed={claimed === candidate.memberId}
                  onClick={() => pick(candidate)}
                  className={`${choice(claimed === candidate.memberId)} px-4 text-left`}
                >
                  {candidateLabel(candidate)}
                </button>
              ))}
              <button
                type="button"
                aria-pressed={claimed === 'none'}
                onClick={() => pick(null)}
                className={`${choice(claimed === 'none')} px-4 text-left`}
              >
                {t('matchNone')}
              </button>
            </div>
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
                  <label htmlFor={`${id}-${key}`} className="block text-small font-semibold text-brand-stone">
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
            <p className="mt-2 text-body text-brand-stone">{t('selfieHelper')}</p>
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
            <p className="mt-2 text-body text-brand-stone">{t('endHelper')}</p>
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
                  <input type="checkbox" checked={checked} onChange={(event) => set(event.target.checked)} className="mt-1 size-6 accent-brand-obsidian" />
                  <span>{label}</span>
                </label>
              ))}
            </div>
            <p className="mt-2 flex flex-wrap gap-x-4 text-small">
              <a href={termsHref} target="_blank" rel="noopener" className="font-semibold text-brand-link underline underline-offset-2">
                {t('readTerms')}
              </a>
              <a href={privacyHref} target="_blank" rel="noopener" className="font-semibold text-brand-link underline underline-offset-2">
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
        ) : otpRequired && step === 'mobile' && otpToken === null ? (
          <button
            type="button"
            disabled={!canContinue.mobile || otpBusy}
            onClick={() => void requestCode()}
            className={primary}
          >
            {otpBusy ? t('sendingCode') : t('sendCode')}
          </button>
        ) : step === 'code' && otpToken === null ? (
          <button
            type="button"
            disabled={!canContinue.code || otpBusy}
            onClick={() => void checkCode()}
            className={primary}
          >
            {t('checkCode')}
          </button>
        ) : (
          <button type="button" disabled={!canContinue[step]} onClick={() => go(1)} className={primary}>
            {t('next')}
          </button>
        )}
        {index === 0 ? null : (
          <button type="button" onClick={() => go(-1)} className="min-h-14 w-full text-body font-semibold text-brand-stone">
            {t('back')}
          </button>
        )}
      </div>
    </div>
  );
}

