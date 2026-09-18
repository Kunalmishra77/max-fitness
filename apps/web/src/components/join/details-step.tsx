'use client';

import { ageOn, isMinorOn } from '@mfp/core/membership';
import type { ISTDate } from '@mfp/shared';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { buttonVariants } from '@/components/ui/button';
import { track } from '@/lib/analytics';
import { cn } from '@/lib/cn';
import { ChevronDownIcon } from '@/components/marketing/icons';
import type { JoinState } from './join-state';
import { SelfieCapture } from './selfie-capture';

/**
 * Step 1 of sign-up: details, selfie and consents (PRD SU-02…SU-06; wireframes "Your details").
 *
 * Validated in the browser with the schema the API uses, loaded on first submit so Zod
 * stays out of the first paint (ADR-033), and again on the server, whose field errors
 * come back as the same codes. Face attendance is un-ticked by default and unavailable
 * to minors (privacy plan §3.3); WhatsApp updates are un-ticked too, with a plain note
 * about what leaving them off means.
 */

type Field = 'fullName' | 'mobile' | 'email' | 'dob' | 'gender' | 'selfie' | 'terms';
type ErrorKey =
  | 'fullName'
  | 'mobile'
  | 'email'
  | 'dob'
  | 'gender'
  | 'selfie'
  | 'terms'
  | 'underAge'
  | 'selfieUnsupported'
  | 'selfieUnreadable'
  | 'selfieTooLarge'
  | 'selfieTooSmall';
type Problem = 'rateLimited' | 'network' | 'generic';

export type RegisteredState = Required<Pick<JoinState, 'registrationToken' | 'firstName' | 'gender' | 'isMinor' | 'whatsappUpdates'>>;

export interface DetailsStepProps {
  /** Today's IST date from the server, for the age rules. */
  readonly today: ISTDate;
  readonly minAge: number;
  readonly noticeVersion: string;
  readonly termsHref: string;
  readonly privacyHref: string;
  readonly onRegistered: (state: RegisteredState) => void;
  /** Set on `/qr/new`, so reports can tell the reception QR from the website. */
  readonly source?: 'QR_NEW';
}

const FIELD_ORDER: readonly Field[] = ['fullName', 'mobile', 'email', 'dob', 'gender', 'selfie', 'terms'];
const SELFIE_REASONS: Record<string, ErrorKey> = {
  unsupported_type: 'selfieUnsupported',
  unreadable: 'selfieUnreadable',
  too_large: 'selfieTooLarge',
  too_small: 'selfieTooSmall',
};
const SERVER_FIELDS: Record<string, Field> = {
  fullName: 'fullName',
  mobile: 'mobile',
  email: 'email',
  dob: 'dob',
  gender: 'gender',
  selfie: 'selfie',
  terms: 'terms',
  privacy: 'terms',
};

const loadSchema = () => import('@mfp/shared/schemas/registration');
const pad = (n: string) => n.padStart(2, '0');

export function DetailsStep({
  today,
  minAge,
  noticeVersion,
  termsHref,
  privacyHref,
  onRegistered,
  source,
}: DetailsStepProps) {
  const t = useTranslations('signup');
  const locale = useLocale();
  const id = useId();

  const [fullName, setFullName] = useState('');
  const [mobile, setMobile] = useState('');
  const [email, setEmail] = useState('');
  const [dob, setDob] = useState({ day: '', month: '', year: '' });
  const [gender, setGender] = useState<'MALE' | 'FEMALE' | ''>('');
  const [selfie, setSelfie] = useState<{ blob: Blob; url: string } | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [terms, setTerms] = useState(false);
  const [whatsapp, setWhatsapp] = useState(false);
  const [face, setFace] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<Field, ErrorKey>>>({});
  const [problem, setProblem] = useState<Problem | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const fieldRefs = useRef<Partial<Record<Field, HTMLElement | null>>>({});

  const dobValue = dob.day !== '' && dob.month !== '' && dob.year !== '' ? `${dob.year}-${pad(dob.month)}-${pad(dob.day)}` : '';
  const dobIsDate = /^\d{4}-\d{2}-\d{2}$/.test(dobValue) && !Number.isNaN(Date.parse(`${dobValue}T00:00:00Z`)) && new Date(`${dobValue}T00:00:00Z`).toISOString().startsWith(dobValue);
  const minor = dobIsDate && isMinorOn(dobValue as ISTDate, today);

  // Face attendance is never offered to a minor (BR-12.2); undo a tick made before the DOB.
  useEffect(() => {
    if (minor) setFace(false);
  }, [minor]);

  useEffect(() => () => {
    if (selfie !== null) URL.revokeObjectURL(selfie.url);
  }, [selfie]);

  const monthNames = useMemo(() => {
    const format = new Intl.DateTimeFormat(locale === 'hi' ? 'hi-IN' : 'en-IN', { month: 'long', timeZone: 'UTC' });
    return Array.from({ length: 12 }, (_, i) => format.format(new Date(Date.UTC(2000, i, 1))));
  }, [locale]);
  const currentYear = Number(today.slice(0, 4));
  const years = Array.from({ length: 91 }, (_, i) => currentYear - i);

  const showErrors = (next: Partial<Record<Field, ErrorKey>>) => {
    setErrors(next);
    const first = FIELD_ORDER.find((field) => next[field] !== undefined);
    if (first !== undefined) fieldRefs.current[first]?.focus();
  };

  const validate = async (): Promise<Partial<Record<Field, ErrorKey>>> => {
    const { RegistrationFieldsSchema } = await loadSchema();
    const parsed = RegistrationFieldsSchema.safeParse({
      fullName,
      mobile,
      email,
      dob: dobValue,
      gender: gender === '' ? undefined : gender,
      language: locale === 'hi' ? 'hi' : 'en',
      consents: { terms, privacy: terms, whatsappUpdates: whatsapp, faceAttendance: face },
      noticeVersion,
    });

    const next: Partial<Record<Field, ErrorKey>> = {};
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const [first] = issue.path;
        const field = first === 'consents' ? 'terms' : SERVER_FIELDS[String(first)];
        if (field !== undefined) next[field] ??= field;
      }
    }
    if (next.dob === undefined && dobIsDate && ageOn(dobValue as ISTDate, today) < minAge) next.dob = 'underAge';
    if (selfie === null) next.selfie = 'selfie';
    return next;
  };

  const onSubmit = async () => {
    setProblem(null);
    const found = await validate();
    if (Object.keys(found).length > 0 || selfie === null) {
      showErrors(found);
      return;
    }
    setErrors({});
    setSubmitting(true);

    const form = new FormData();
    form.append('fullName', fullName);
    form.append('mobile', mobile);
    if (email.trim() !== '') form.append('email', email);
    form.append('dob', dobValue);
    form.append('gender', gender);
    form.append('language', locale === 'hi' ? 'hi' : 'en');
    form.append('consents', JSON.stringify({ terms, privacy: terms, whatsappUpdates: whatsapp, faceAttendance: minor ? false : face }));
    form.append('noticeVersion', noticeVersion);
    form.append('selfie', selfie.blob, 'selfie.jpg');
    if (source !== undefined) form.append('source', source);

    let response: Response;
    try {
      response = await fetch('/api/v1/registrations', { method: 'POST', body: form });
    } catch {
      setSubmitting(false);
      setProblem('network');
      return;
    }

    const body = (await response.json().catch(() => null)) as {
      data?: { registrationToken: string; isMinor: boolean };
      error?: { code?: string; details?: { fields?: Record<string, unknown>; reason?: string } };
    } | null;
    setSubmitting(false);

    if (response.status === 201 && body?.data !== undefined && gender !== '') {
      track('signup_submitted');
      onRegistered({
        registrationToken: body.data.registrationToken,
        firstName: fullName.trim().split(/\s+/)[0] ?? fullName.trim(),
        gender,
        isMinor: body.data.isMinor,
        whatsappUpdates: whatsapp,
      });
      return;
    }

    const code = body?.error?.code;
    if (response.status === 400 && body?.error?.details?.fields !== undefined) {
      const next: Partial<Record<Field, ErrorKey>> = {};
      for (const key of Object.keys(body.error.details.fields)) {
        const field = SERVER_FIELDS[key];
        if (field !== undefined) next[field] ??= field;
      }
      if (Object.keys(next).length > 0) return showErrors(next);
    }
    if (code === 'UNDER_MINIMUM_AGE') return showErrors({ dob: 'underAge' });
    if (code === 'SELFIE_REJECTED') return showErrors({ selfie: SELFIE_REASONS[body?.error?.details?.reason ?? ''] ?? 'selfieUnreadable' });
    setProblem(response.status === 429 ? 'rateLimited' : 'generic');
  };

  const message = (field: Field) => {
    const key = errors[field];
    if (key === undefined) return null;
    return key === 'underAge' ? t('errors.underAge', { minAge }) : t(`errors.${key}`);
  };

  const inputClass = (invalid: boolean) =>
    cn(
      'min-h-12 w-full rounded-input border bg-brand-white px-3 text-body text-brand-ink',
      invalid ? 'border-2 border-semantic-fee-expired' : 'border-brand-rubber-grey/40',
    );

  const errorText = (field: Field) => {
    const text = message(field);
    return text === null ? null : (
      <p id={`${id}-${field}-error`} className="mt-1 text-small font-medium text-semantic-fee-expired">
        {text}
      </p>
    );
  };
  const describedBy = (field: Field) => (errors[field] === undefined ? undefined : `${id}-${field}-error`);

  const link = (href: string) => (chunks: ReactNode) => (
    <a href={href} target="_blank" rel="noopener" className="font-semibold text-brand-wall-blue underline underline-offset-2">
      {chunks}
    </a>
  );

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void onSubmit();
      }}
      onFocusCapture={() => void loadSchema()}
      className="grid gap-5"
    >
      <div>
        <label htmlFor={`${id}-fullName`} className="block text-body font-semibold">
          {t('fullName')}
        </label>
        <input
          id={`${id}-fullName`}
          ref={(el) => {
            fieldRefs.current.fullName = el;
          }}
          type="text"
          autoComplete="name"
          maxLength={60}
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          aria-invalid={errors.fullName !== undefined}
          aria-describedby={describedBy('fullName')}
          className={cn('mt-1.5', inputClass(errors.fullName !== undefined))}
        />
        {errorText('fullName')}
      </div>

      <div>
        <label htmlFor={`${id}-mobile`} className="block text-body font-semibold">
          {t('mobile')}
        </label>
        <div className="mt-1.5 flex">
          <span aria-hidden className="inline-flex min-h-12 items-center rounded-l-input border border-r-0 border-brand-rubber-grey/40 bg-brand-chalk px-3 text-body text-brand-rubber-grey">
            {t('mobilePrefix')}
          </span>
          <input
            id={`${id}-mobile`}
            ref={(el) => {
              fieldRefs.current.mobile = el;
            }}
            type="tel"
            inputMode="numeric"
            autoComplete="tel-national"
            maxLength={14}
            value={mobile}
            onChange={(e) => setMobile(e.target.value)}
            aria-invalid={errors.mobile !== undefined}
            aria-describedby={describedBy('mobile')}
            className={cn(inputClass(errors.mobile !== undefined), 'rounded-l-none')}
          />
        </div>
        {errorText('mobile')}
      </div>

      <div>
        <label htmlFor={`${id}-email`} className="block text-body font-semibold">
          {t('email')} <span className="font-normal text-brand-rubber-grey">({t('optional')})</span>
        </label>
        <input
          id={`${id}-email`}
          ref={(el) => {
            fieldRefs.current.email = el;
          }}
          type="email"
          autoComplete="email"
          maxLength={120}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={errors.email !== undefined}
          aria-describedby={describedBy('email')}
          className={cn('mt-1.5', inputClass(errors.email !== undefined))}
        />
        {errorText('email')}
      </div>

      <fieldset aria-describedby={describedBy('dob')}>
        <legend className="text-body font-semibold">{t('dob')}</legend>
        <div className="mt-1.5 grid grid-cols-[1fr_1.6fr_1.3fr] gap-2">
          {(
            [
              ['day', t('dobDay'), Array.from({ length: 31 }, (_, i) => [String(i + 1), String(i + 1)])],
              ['month', t('dobMonth'), monthNames.map((name, i) => [String(i + 1), name])],
              ['year', t('dobYear'), years.map((y) => [String(y), String(y)])],
            ] as const
          ).map(([part, label, options]) => (
            <div key={part} className="relative">
              <select
                ref={
                  part === 'day'
                    ? (el) => {
                        fieldRefs.current.dob = el;
                      }
                    : undefined
                }
                aria-label={label}
                value={dob[part]}
                onChange={(e) => setDob((current) => ({ ...current, [part]: e.target.value }))}
                aria-invalid={errors.dob !== undefined}
                className={cn(inputClass(errors.dob !== undefined), 'appearance-none pr-8')}
              >
                <option value="" disabled>
                  {label}
                </option>
                {options.map(([value, text]) => (
                  <option key={value} value={value}>
                    {text}
                  </option>
                ))}
              </select>
              <ChevronDownIcon aria-hidden className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-brand-rubber-grey" />
            </div>
          ))}
        </div>
        {errorText('dob')}
      </fieldset>

      {minor ? <p className="rounded-input bg-tint-fee-due-soon-bg p-3 text-body leading-body">{t('minorNote')}</p> : null}

      <fieldset aria-describedby={describedBy('gender')}>
        <legend className="text-body font-semibold">{t('gender')}</legend>
        <div className="mt-1.5 grid grid-cols-2 gap-2">
          {(['MALE', 'FEMALE'] as const).map((value, index) => (
            <label
              key={value}
              className={cn(
                'flex min-h-12 cursor-pointer items-center justify-center rounded-input border-2 text-body font-semibold',
                'has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2',
                gender === value ? 'border-brand-plate-navy bg-brand-plate-navy text-brand-chalk' : 'border-brand-rubber-grey/40 bg-brand-white text-brand-ink',
              )}
            >
              <input
                ref={
                  index === 0
                    ? (el) => {
                        fieldRefs.current.gender = el;
                      }
                    : undefined
                }
                type="radio"
                name={`${id}-gender`}
                value={value}
                checked={gender === value}
                onChange={() => setGender(value)}
                className="sr-only"
              />
              {t(`genders.${value}`)}
            </label>
          ))}
        </div>
        {errorText('gender')}
      </fieldset>

      <div>
        <p className="text-body font-semibold">{t('selfie')}</p>
        <div className="mt-1.5 flex items-center gap-4">
          {selfie === null ? null : (
            // A local object URL: next/image cannot optimise it.
            <img src={selfie.url} alt={t('selfieAdded')} width={96} height={96} className="size-24 rounded-panel object-cover" />
          )}
          <button
            type="button"
            ref={(el) => {
              fieldRefs.current.selfie = el;
            }}
            onClick={() => setCameraOpen(true)}
            aria-describedby={describedBy('selfie')}
            className={cn(
              buttonVariants({ variant: selfie === null ? 'outlineDark' : 'ghost' }),
              'min-h-24 flex-col gap-1 whitespace-normal',
              selfie === null ? 'w-full sm:w-auto' : '',
              errors.selfie !== undefined ? 'border-semantic-fee-expired' : '',
            )}
          >
            <span>{selfie === null ? t('takeSelfie') : t('retake')}</span>
            {selfie === null ? <span className="text-small font-normal text-brand-rubber-grey">{t('selfieHelper')}</span> : null}
          </button>
        </div>
        {errorText('selfie')}
        <SelfieCapture
          open={cameraOpen}
          onOpenChange={setCameraOpen}
          onCaptured={(blob) => {
            setSelfie({ blob, url: URL.createObjectURL(blob) });
            setErrors(({ selfie: _cleared, ...rest }) => rest);
          }}
        />
      </div>

      <div className="grid gap-3">
        <label className="flex items-start gap-3 text-body leading-body">
          <input
            ref={(el) => {
              fieldRefs.current.terms = el;
            }}
            type="checkbox"
            checked={terms}
            onChange={(e) => setTerms(e.target.checked)}
            aria-invalid={errors.terms !== undefined}
            aria-describedby={describedBy('terms')}
            className="mt-1 size-5 shrink-0 accent-brand-plate-navy"
          />
          <span>{t.rich('consentTerms', { terms: link(termsHref), privacy: link(privacyHref) })}</span>
        </label>
        {errorText('terms')}

        <label className="flex items-start gap-3 text-body leading-body">
          <input type="checkbox" checked={whatsapp} onChange={(e) => setWhatsapp(e.target.checked)} className="mt-1 size-5 shrink-0 accent-brand-plate-navy" />
          <span>
            {t('consentWhatsapp')}
            {whatsapp ? null : <span className="mt-0.5 block text-small text-brand-rubber-grey">{t('consentWhatsappOff')}</span>}
          </span>
        </label>

        <label className={cn('flex items-start gap-3 text-body leading-body', minor ? 'opacity-60' : '')}>
          <input
            type="checkbox"
            checked={face}
            disabled={minor}
            onChange={(e) => setFace(e.target.checked)}
            className="mt-1 size-5 shrink-0 accent-brand-plate-navy"
          />
          <span>
            {t('consentFace')}
            <span className="mt-0.5 block text-small text-brand-rubber-grey">{minor ? t('consentFaceMinor') : t('consentFaceHelper')}</span>
          </span>
        </label>
      </div>

      {problem === null ? null : (
        <p role="alert" className="rounded-input bg-tint-fee-expired-bg p-3 text-body font-medium text-semantic-fee-expired">
          {t(`errors.${problem}`)}
        </p>
      )}

      <button type="submit" disabled={submitting} className={buttonVariants({ variant: 'primary', size: 'hero', full: true })}>
        {submitting ? t('submitting') : t('continueToPlans')}
      </button>
    </form>
  );
}
