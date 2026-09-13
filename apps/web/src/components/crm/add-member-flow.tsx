'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useId, useMemo, useState, useTransition } from 'react';

/**
 * Add a member at the desk (crm-ux-blueprint §7).
 *
 * One question per screen, in the order staff actually ask them, with the photo first
 * and skippable. Nothing is written until the last tap; the server validates the same
 * fields again with the shared schema and answers with a code this screen looks up, so
 * the two languages stay in the message catalogues.
 */

export type AddMemberErrorCode = 'fullName' | 'mobile' | 'dob' | 'gender' | 'terms' | 'underAge' | 'FORBIDDEN' | 'generic';
export type AddMemberResult =
  | { ok: true; memberId: string; possibleDuplicate: boolean }
  | { ok: false; code: AddMemberErrorCode; minAge?: number };

export interface AddMemberFields {
  readonly fullName: string;
  readonly mobile: string;
  readonly gender: 'MALE' | 'FEMALE' | 'OTHER';
  readonly dob: string;
  /** Staff confirm the member heard the terms and the privacy notice; the server records it. */
  readonly terms: boolean;
  readonly whatsappUpdates: boolean;
  readonly faceAttendance: boolean;
}

const GENDERS = ['MALE', 'FEMALE', 'OTHER'] as const;
const STEPS = ['photo', 'name', 'mobile', 'gender', 'dob', 'consent'] as const;
type Step = (typeof STEPS)[number];

const pad = (value: string) => value.padStart(2, '0');

export function AddMemberFlow({ action }: { action: (fields: AddMemberFields) => Promise<AddMemberResult> }) {
  const t = useTranslations('crm.add');
  const router = useRouter();
  const id = useId();
  const [step, setStep] = useState<Step>('photo');
  const [fullName, setFullName] = useState('');
  const [mobile, setMobile] = useState('');
  const [gender, setGender] = useState<AddMemberFields['gender'] | null>(null);
  const [dob, setDob] = useState({ day: '', month: '', year: '' });
  const [terms, setTerms] = useState(false);
  const [whatsappUpdates, setWhatsapp] = useState(true);
  const [faceAttendance, setFace] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ memberId: string; possibleDuplicate: boolean } | null>(null);
  const [pending, start] = useTransition();

  const index = STEPS.indexOf(step);
  const dobValue = useMemo(
    () => (dob.day === '' || dob.month === '' || dob.year.length !== 4 ? '' : `${dob.year}-${pad(dob.month)}-${pad(dob.day)}`),
    [dob],
  );

  const canContinue =
    step === 'photo'
      ? true
      : step === 'name'
        ? fullName.trim().length >= 2
        : step === 'mobile'
          ? mobile.replace(/\D/g, '').length >= 10
          : step === 'gender'
            ? gender !== null
            : step === 'dob'
              ? dobValue !== ''
              : terms;

  const go = (delta: 1 | -1) => {
    setError(null);
    const next = STEPS[index + delta];
    if (next !== undefined) setStep(next);
  };

  const submit = () => {
    if (gender === null) return;
    setError(null);
    start(async () => {
      const result = await action({ fullName: fullName.trim(), mobile, gender, dob: dobValue, terms, whatsappUpdates, faceAttendance });
      if (result.ok) {
        setDone({ memberId: result.memberId, possibleDuplicate: result.possibleDuplicate });
        router.refresh();
      } else {
        setError(
          result.code === 'FORBIDDEN'
            ? t('notAllowed')
            : result.code === 'underAge'
              ? t('errors.underAge', { minAge: result.minAge ?? 16 })
              : t(`errors.${result.code}` as never),
        );
        // Send them back to the step that needs fixing.
        if (result.code === 'fullName') setStep('name');
        if (result.code === 'mobile') setStep('mobile');
        if (result.code === 'dob' || result.code === 'underAge') setStep('dob');
      }
    });
  };

  const field = 'mt-3 min-h-16 w-full rounded-input border-2 border-brand-rubber-grey/40 bg-white px-4 text-crm-body';
  const primary = 'min-h-16 w-full rounded-panel bg-brand-signboard-red text-crm-body font-bold text-white disabled:opacity-50';

  if (done !== null) {
    return (
      <div className="grid gap-4 p-6 text-center">
        <p aria-hidden className="text-6xl">
          ✅
        </p>
        <h2 className="font-display text-display-m font-bold text-brand-plate-navy">{t('done')}</h2>
        <p className="text-crm-body">{fullName.trim()}</p>
        {done.possibleDuplicate ? (
          <p role="alert" className="rounded-input bg-tint-fee-due-soon-bg p-3 text-crm-body font-medium text-semantic-fee-due-soon">
            {t('duplicate')}
          </p>
        ) : null}
        <a href={`/crm/members/${done.memberId}/renew`} className={`flex items-center justify-center ${primary}`}>
          {t('takeFees')}
        </a>
        <a href={`/crm/members/${done.memberId}`} className="flex min-h-14 items-center justify-center text-crm-body font-semibold text-brand-rubber-grey">
          {t('later')}
        </a>
      </div>
    );
  }

  return (
    <div className="p-4">
      <p className="text-small text-brand-rubber-grey">{t('step', { current: index + 1, total: STEPS.length })}</p>
      <div aria-hidden className="mt-2 flex gap-1.5">
        {STEPS.map((name, i) => (
          <span key={name} className={`h-1.5 flex-1 rounded-full ${i <= index ? 'bg-brand-signboard-red' : 'bg-brand-rubber-grey/25'}`} />
        ))}
      </div>

      <div className="mt-6">
        {step === 'photo' ? (
          <div className="text-center">
            <h2 className="font-display text-title font-bold text-brand-plate-navy">{t('photoTitle')}</h2>
            <p aria-hidden className="mt-6 text-6xl">
              📷
            </p>
            <p className="mt-4 text-crm-body text-brand-rubber-grey">{t('photoHelper')}</p>
          </div>
        ) : null}

        {step === 'name' ? (
          <div>
            <label htmlFor={`${id}-name`} className="font-display text-title font-bold text-brand-plate-navy">
              {t('nameTitle')}
            </label>
            <input id={`${id}-name`} type="text" autoComplete="off" value={fullName} onChange={(e) => setFullName(e.target.value)} className={field} aria-label={t('nameLabel')} />
          </div>
        ) : null}

        {step === 'mobile' ? (
          <div>
            <label htmlFor={`${id}-mobile`} className="font-display text-title font-bold text-brand-plate-navy">
              {t('mobileTitle')}
            </label>
            <input
              id={`${id}-mobile`}
              type="tel"
              inputMode="numeric"
              maxLength={14}
              value={mobile}
              onChange={(e) => setMobile(e.target.value)}
              className={`${field} text-2xl tracking-widest`}
              aria-label={t('mobileLabel')}
            />
            <p className="mt-2 text-small text-brand-rubber-grey">{t('mobileHelper')}</p>
          </div>
        ) : null}

        {step === 'gender' ? (
          <div>
            <h2 className="font-display text-title font-bold text-brand-plate-navy">{t('genderTitle')}</h2>
            <div className="mt-4 grid gap-3">
              {GENDERS.map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={gender === value}
                  onClick={() => setGender(value)}
                  className={`min-h-16 w-full rounded-panel border-2 text-crm-body font-semibold ${
                    gender === value ? 'border-brand-signboard-red bg-tint-fee-expired-bg text-brand-signboard-red' : 'border-brand-rubber-grey/40 bg-white'
                  }`}
                >
                  {t(value)}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {step === 'dob' ? (
          <div>
            <h2 className="font-display text-title font-bold text-brand-plate-navy">{t('dobTitle')}</h2>
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
                    onChange={(e) => setDob({ ...dob, [key]: e.target.value.replace(/\D/g, '') })}
                    className={`${field} mt-1 text-center text-2xl`}
                  />
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {step === 'consent' ? (
          <div>
            <h2 className="font-display text-title font-bold text-brand-plate-navy">{t('consentTitle')}</h2>
            <div className="mt-4 grid gap-4">
              {(
                [
                  [terms, setTerms, t('consentTerms')],
                  [whatsappUpdates, setWhatsapp, t('consentWhatsapp')],
                  [faceAttendance, setFace, t('consentFace')],
                ] as const
              ).map(([checked, set, label]) => (
                <label key={label} className="flex min-h-14 items-start gap-3 text-crm-body">
                  <input type="checkbox" checked={checked} onChange={(e) => set(e.target.checked)} className="mt-1 size-6 accent-brand-plate-navy" />
                  <span>{label}</span>
                </label>
              ))}
            </div>
            <p className="mt-2 text-small text-brand-rubber-grey">{t('consentFaceMinor')}</p>
          </div>
        ) : null}
      </div>

      {error === null ? null : (
        <p role="alert" className="mt-4 rounded-input bg-tint-fee-expired-bg p-3 text-crm-body font-medium text-semantic-fee-expired">
          {error}
        </p>
      )}

      <div className="mt-8 grid gap-3">
        {step === 'consent' ? (
          <button type="button" disabled={!canContinue || pending} onClick={submit} className={primary}>
            {pending ? t('saving') : t('save')}
          </button>
        ) : (
          <button type="button" disabled={!canContinue} onClick={() => go(1)} className={primary}>
            {step === 'photo' ? t('skip') : t('next')}
          </button>
        )}
        {index === 0 ? null : (
          <button type="button" onClick={() => go(-1)} className="min-h-14 w-full text-crm-body font-semibold text-brand-rubber-grey">
            {t('back')}
          </button>
        )}
      </div>
    </div>
  );
}
