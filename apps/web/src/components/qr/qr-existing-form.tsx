'use client';

import { useRef, useState, useTransition, type ComponentType, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { GOV_ID_TYPES, govIdSidesFor, type GovIdType } from '@mfp/core';
import { SelfieCapture, type SelfieCaptureProps } from '@/components/join/selfie-capture';
import { cn } from '@/lib/cn';

/**
 * "I am already a member", on one page (client decision, ADR-075).
 *
 * It used to be nine questions, one per screen. A member standing at reception with a
 * queue behind them wants to see the whole thing, fill it in and press send — and
 * when something is wrong they want to be told *which answer*, beside that answer.
 * The old flow answered every refusal with "that could not be sent" on a screen that
 * showed none of the answers, which is how a member ends up asking reception what
 * they did wrong, which is the thing the QR was supposed to avoid.
 *
 * Two answers are optional, because a member who joined in 2019 will not remember the
 * day and many will not have an email. Everything else the gym insists on, including
 * a photograph of an ID — of which the gym keeps the picture and never the number
 * (ADR-074).
 */

export type QrSubmitResult =
  | { ok: true; referenceCode: string }
  | { ok: false; code: string; fields?: readonly string[]; requestId?: string | undefined; minAge?: number | undefined };

export type QrSubmit = (form: FormData) => Promise<QrSubmitResult>;

const PLANS = ['1', '3', '6', '12', 'unsure'] as const;
const GENDERS = ['MALE', 'FEMALE', 'OTHER'] as const;

/** Which answer a server complaint belongs beside. */
const FIELD_OF: Record<string, string> = {
  mobile: 'mobile',
  fullName: 'fullName',
  gender: 'gender',
  dob: 'dob',
  email: 'email',
  joinedOn: 'joinedOn',
  selfie: 'selfie',
  declaredPlanMonths: 'plan',
  declaredEndDate: 'endDate',
  declaredAmount: 'amount',
  govId: 'govId',
  govIdType: 'govId',
  terms: 'terms',
  privacy: 'terms',
};

/**
 * One labelled answer, with its own complaint underneath.
 *
 * Declared out here rather than inside the form. A component defined inside another
 * one is a new component type on every render, so React unmounts and remounts it —
 * which takes the focus away after each keystroke and makes the field impossible to
 * type into.
 */
function Field({
  label,
  problem,
  optional,
  optionalLabel,
  children,
}: {
  readonly label: string;
  readonly problem: string | undefined;
  readonly optional?: boolean;
  readonly optionalLabel: string;
  readonly children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-body font-semibold text-brand-ink">
        {label}
        {optional === true ? <span className="ml-1 font-normal text-brand-stone">{optionalLabel}</span> : null}
      </span>
      {children}
      {problem === undefined ? null : (
        <span role="alert" className="mt-1 block text-small font-semibold text-semantic-fee-expired">
          {problem}
        </span>
      )}
    </label>
  );
}

export function QrExistingForm({
  today,
  minAge,
  noticeVersion,
  termsHref,
  privacyHref,
  submit,
  onSubmitted,
  Camera = SelfieCapture,
}: {
  readonly today: string;
  readonly minAge: number;
  readonly noticeVersion: string;
  readonly termsHref: string;
  readonly privacyHref: string;
  readonly submit: QrSubmit;
  readonly onSubmitted: (referenceCode: string) => void;
  /** Injected in tests; the real sheet needs a camera. */
  readonly Camera?: ComponentType<SelfieCaptureProps>;
}) {
  const t = useTranslations('qrExisting');
  const locale = useLocale();

  const [fullName, setFullName] = useState('');
  const [mobile, setMobile] = useState('');
  const [dob, setDob] = useState('');
  const [gender, setGender] = useState<(typeof GENDERS)[number] | null>(null);
  const [email, setEmail] = useState('');
  const [joinedOn, setJoinedOn] = useState('');
  const [photo, setPhoto] = useState<{ blob: Blob; url: string } | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [plan, setPlan] = useState<(typeof PLANS)[number] | null>(null);
  const [endDate, setEndDate] = useState('');
  const [amount, setAmount] = useState('');
  const [govIdType, setGovIdType] = useState<GovIdType | ''>('');
  const [govIdFront, setGovIdFront] = useState<File | null>(null);
  const [govIdBack, setGovIdBack] = useState<File | null>(null);
  const [terms, setTerms] = useState(false);
  const [whatsapp, setWhatsapp] = useState(true);
  const [face, setFace] = useState(false);

  const [problems, setProblems] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const photoUrl = useRef<string | null>(null);

  const keepPhoto = (blob: Blob) => {
    if (photoUrl.current !== null) URL.revokeObjectURL(photoUrl.current);
    const url = URL.createObjectURL(blob);
    photoUrl.current = url;
    setPhoto({ blob, url });
    setCameraOpen(false);
  };

  const sides = govIdType === '' ? [] : govIdSidesFor(govIdType);

  /** Everything the gym insists on, checked here so nothing travels for nothing. */
  const missing = (): Record<string, string> => {
    const found: Record<string, string> = {};
    if (fullName.trim().length < 2) found['fullName'] = t('errors.fullName');
    if (!/^\d{10}$/.test(mobile.replace(/\D/g, ''))) found['mobile'] = t('errors.mobile');
    if (dob === '') found['dob'] = t('errors.dob');
    if (gender === null) found['gender'] = t('errors.gender');
    if (photo === null) found['selfie'] = t('errors.selfie');
    if (plan === null) found['plan'] = t('errors.plan');
    if (endDate === '') found['endDate'] = t('errors.endDate');
    if (govIdType === '') found['govId'] = t('errors.govIdType');
    else if (govIdFront === null || (sides.includes('BACK') && govIdBack === null)) found['govId'] = t('errors.govIdPhotos');
    if (!terms) found['terms'] = t('errors.terms');
    return found;
  };

  const send = () => {
    setFailure(null);
    const found = missing();
    setProblems(found);
    if (Object.keys(found).length > 0) {
      setFailure(t('errors.fillFirst'));
      return;
    }
    if (photo === null || gender === null || plan === null || govIdType === '') return;

    const form = new FormData();
    form.set('fullName', fullName.trim());
    form.set('mobile', mobile.replace(/\D/g, ''));
    form.set('dob', dob);
    form.set('gender', gender);
    form.set('language', locale === 'hi' ? 'hi' : 'en');
    form.set('noticeVersion', noticeVersion);
    form.set('consents', JSON.stringify({ terms, privacy: terms, whatsappUpdates: whatsapp, faceAttendance: face }));
    form.set('declaredPlanMonths', plan === 'unsure' ? '' : plan);
    form.set('declaredEndDate', endDate);
    form.set('declaredAmount', amount.replace(/\D/g, ''));
    form.set('selfie', photo.blob, 'selfie.jpg');
    if (email.trim() !== '') form.set('email', email.trim());
    if (joinedOn !== '') form.set('joinedOn', joinedOn);
    form.set('govIdType', govIdType);
    if (govIdFront !== null) form.set('govIdFront', govIdFront, 'id-front.jpg');
    if (govIdBack !== null) form.set('govIdBack', govIdBack, 'id-back.jpg');

    start(async () => {
      const result = await submit(form);
      if (result.ok) {
        onSubmitted(result.referenceCode);
        return;
      }

      // A complaint about one answer belongs beside that answer.
      const beside: Record<string, string> = {};
      for (const name of result.fields ?? []) {
        const key = FIELD_OF[name];
        if (key !== undefined) beside[key] = t(`errors.${key}` as never);
      }
      if (result.code === 'UNDER_MINIMUM_AGE') beside['dob'] = t('errors.underAge', { minAge: result.minAge ?? minAge });
      setProblems(beside);

      // And when it is not about an answer, say what it was — with the reference the
      // gym can quote, rather than a dead end that helps nobody.
      if (Object.keys(beside).length > 0) setFailure(t('errors.checkMarked'));
      else if (result.code === 'RATE_LIMITED') setFailure(t('errors.rateLimited'));
      else setFailure(t('errors.serverSaid', { code: result.code, reference: result.requestId ?? '—' }));
    });
  };

  const inputClass = 'mt-1 min-h-14 w-full rounded-input border-2 border-brand-stone/40 bg-white px-4 text-body-l';

  const field = (name: string) => ({ problem: problems[name], optionalLabel: t('optional') });

  return (
    <div className="grid gap-6">
      <div className="grid gap-4">
        <Field {...field('fullName')} label={t('fields.fullName')}>
          <input aria-required="true" value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" className={inputClass} />
        </Field>

        <Field {...field('mobile')} label={t('fields.mobile')}>
          <input aria-required="true" value={mobile} onChange={(e) => setMobile(e.target.value)} inputMode="numeric" autoComplete="tel" maxLength={12} className={inputClass} />
        </Field>

        <Field {...field('dob')} label={t('fields.dob')}>
          <input aria-required="true" type="date" value={dob} max={today} onChange={(e) => setDob(e.target.value)} className={inputClass} />
        </Field>

        <fieldset>
          <legend className="text-body font-semibold text-brand-ink">{t('fields.gender')}</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {GENDERS.map((value) => (
              <label key={value} className={cn('min-h-14 cursor-pointer rounded-button border-2 px-5 leading-[3.25rem] font-semibold', gender === value ? 'border-brand-accent bg-brand-accent text-brand-white' : 'border-brand-stone/40 bg-white')}>
                <input type="radio" name="gender" value={value} checked={gender === value} onChange={() => setGender(value)} className="sr-only" />
                {t(`gender.${value}` as never)}
              </label>
            ))}
          </div>
          {problems['gender'] === undefined ? null : (
            <p role="alert" className="mt-1 text-small font-semibold text-semantic-fee-expired">
              {problems['gender']}
            </p>
          )}
        </fieldset>

        <Field {...field('email')} label={t('fields.email')} optional>
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="email" className={inputClass} />
        </Field>

        <Field {...field('joinedOn')} label={t('fields.joinedOn')} optional>
          <input type="date" value={joinedOn} max={today} onChange={(e) => setJoinedOn(e.target.value)} className={inputClass} />
          <span className="mt-1 block text-small text-brand-stone">{t('joinedOnHelp')}</span>
        </Field>
      </div>

      <section className="grid gap-2">
        <h2 className="text-body font-semibold text-brand-ink">{t('fields.selfie')}</h2>
        <Camera open={cameraOpen} onOpenChange={setCameraOpen} onCaptured={keepPhoto} />
        {photo === null ? (
          <button type="button" onClick={() => setCameraOpen(true)} className="min-h-16 rounded-button border-2 border-dashed border-brand-stone/50 font-semibold text-brand-ink">
            {t('takePhoto')}
          </button>
        ) : (
          <div className="flex items-center gap-4">
            {/* A local object URL for something taken a second ago, not an asset. */}
            <img src={photo.url} alt="" className="size-24 rounded-panel object-cover" />
            <button type="button" onClick={() => setCameraOpen(true)} className="min-h-14 rounded-button border-2 border-brand-stone/40 px-4 font-semibold">
              {t('retakePhoto')}
            </button>
          </div>
        )}
        {problems['selfie'] === undefined ? null : (
          <p role="alert" className="text-small font-semibold text-semantic-fee-expired">
            {problems['selfie']}
          </p>
        )}
      </section>

      <section className="grid gap-4">
        <fieldset>
          <legend className="text-body font-semibold text-brand-ink">{t('fields.plan')}</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {PLANS.map((value) => (
              <label key={value} className={cn('min-h-14 cursor-pointer rounded-button border-2 px-5 leading-[3.25rem] font-semibold', plan === value ? 'border-brand-accent bg-brand-accent text-brand-white' : 'border-brand-stone/40 bg-white')}>
                <input type="radio" name="plan" value={value} checked={plan === value} onChange={() => setPlan(value)} className="sr-only" />
                {t(`plans.${value}` as never)}
              </label>
            ))}
          </div>
          {problems['plan'] === undefined ? null : (
            <p role="alert" className="mt-1 text-small font-semibold text-semantic-fee-expired">
              {problems['plan']}
            </p>
          )}
        </fieldset>

        <Field {...field('endDate')} label={t('fields.endDate')}>
          <input aria-required="true" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={inputClass} />
          <span className="mt-1 block text-small text-brand-stone">{t('endDateHelp')}</span>
        </Field>

        <Field {...field('amount')} label={t('fields.amount')} optional>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="numeric" className={inputClass} />
        </Field>
      </section>

      <section className="grid gap-3">
        <Field {...field('govId')} label={t('fields.govIdType')}>
          <select
            aria-required="true"
            value={govIdType}
            onChange={(e) => {
              setGovIdType(e.target.value as GovIdType | '');
              setGovIdFront(null);
              setGovIdBack(null);
            }}
            className={inputClass}
          >
            <option value="">{t('govId.choose')}</option>
            {GOV_ID_TYPES.map((value) => (
              <option key={value} value={value}>
                {t(`govId.${value}` as never)}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-small text-brand-stone">{t('govId.help')}</span>
        </Field>

        {sides.map((side) => (
          <label key={side} className="block">
            <span className="text-body font-semibold text-brand-ink">{t(side === 'FRONT' ? 'govId.front' : 'govId.back')}</span>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(e) => (side === 'FRONT' ? setGovIdFront(e.target.files?.[0] ?? null) : setGovIdBack(e.target.files?.[0] ?? null))}
              className="mt-1 block w-full text-body"
            />
          </label>
        ))}
      </section>

      <section className="grid gap-3">
        <h2 className="text-body font-semibold text-brand-ink">{t('beforeSend')}</h2>
        <label className="flex items-start gap-3">
          <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} className="mt-1 size-6 accent-brand-accent" />
          <span className="text-body">{t('consent.terms')}</span>
        </label>
        <label className="flex items-start gap-3">
          <input type="checkbox" checked={whatsapp} onChange={(e) => setWhatsapp(e.target.checked)} className="mt-1 size-6 accent-brand-accent" />
          <span className="text-body">{t('consent.whatsapp')}</span>
        </label>
        <label className="flex items-start gap-3">
          <input type="checkbox" checked={face} onChange={(e) => setFace(e.target.checked)} className="mt-1 size-6 accent-brand-accent" />
          <span className="text-body">{t('consent.face')}</span>
        </label>
        <p className="flex gap-4 text-small">
          <a href={termsHref} className="font-semibold underline">
            {t('consent.readTerms')}
          </a>
          <a href={privacyHref} className="font-semibold underline">
            {t('consent.readPrivacy')}
          </a>
        </p>
        {problems['terms'] === undefined ? null : (
          <p role="alert" className="text-small font-semibold text-semantic-fee-expired">
            {problems['terms']}
          </p>
        )}
      </section>

      {failure === null ? null : (
        <p role="alert" className="rounded-panel bg-tint-fee-expired-bg p-4 text-body font-semibold text-semantic-fee-expired">
          {failure}
        </p>
      )}

      <button type="button" onClick={send} disabled={pending} className="min-h-16 rounded-button bg-brand-accent text-[1.25rem] font-bold text-brand-white disabled:opacity-60">
        {pending ? t('sending') : t('send')}
      </button>
    </div>
  );
}
