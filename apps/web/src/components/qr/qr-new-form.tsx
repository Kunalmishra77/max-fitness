'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRef, useState, useTransition, type ComponentType, type ReactNode } from 'react';
import { TRAINING_SLOTS, type GovIdType, type TrainingSlot } from '@mfp/core';
import { formatINR } from '@mfp/shared';
import { renderIdPhoto } from '@/components/join/render-photo';
import { SelfieCapture, type SelfieCaptureProps } from '@/components/join/selfie-capture';
import { cn } from '@/lib/cn';
import { Field, GovIdStep, isPdf, MAX_UPLOAD_BYTES, QR_INPUT_CLASS, QrProgress } from './qr-form-parts';
import { SELFIE_REASONS } from './selfie-reasons';

/**
 * "I am new here", at the reception desk (client request, ADR-083).
 *
 * The same shape as the existing-member form — one question per screen, uploads a thumb
 * can hit — but asked of somebody who has never been here. They see what a month costs
 * before they are asked to choose one, and the money is handed over at the counter:
 * the gym has no live payment gateway, and opening a checkout in front of a person
 * already standing at the desk would be theatre (ADR-076).
 */

export interface QrPlanCard {
  readonly planId: string;
  readonly durationMonths: number;
  readonly pricePaise: number;
  readonly gender: 'MALE' | 'FEMALE';
}

export type QrJoinResult =
  | { readonly ok: true; readonly firstName: string; readonly amountPaise: number; readonly reservedUntil: string }
  | {
      readonly ok: false;
      readonly code: string;
      readonly fields?: readonly string[];
      readonly requestId?: string | undefined;
      readonly minAge?: number | undefined;
      readonly selfieReason?: string | undefined;
    };

export type QrJoin = (input: {
  form: FormData;
  /** `null` with `trialDays` when they are buying a trial instead of a plan (ADR-088). */
  planId: string | null;
  trialDays: number | null;
  ptPlanId: string | null;
  startDate: string;
}) => Promise<QrJoinResult>;

const GENDERS = ['MALE', 'FEMALE'] as const;

/** Which answer a server complaint belongs beside. */
const FIELD_OF: Record<string, string> = {
  fullName: 'fullName',
  mobile: 'mobile',
  dob: 'dob',
  gender: 'gender',
  email: 'email',
  selfie: 'selfie',
  planId: 'plan',
  ptPlanId: 'pt',
  govId: 'govId',
  govIdType: 'govId',
  trainingSlot: 'slot',
  terms: 'terms',
  privacy: 'terms',
};

/**
 * Which answers belong to which screen is carried by the screens themselves (`steps`
 * below), because the personal-training screen only exists when the gym sells it — an
 * index-keyed list would have shifted under it (ADR-087).
 */

export function QrNewForm({
  today,
  minAge,
  noticeVersion,
  termsHref,
  privacyHref,
  plans,
  ptPlans = [],
  trialOptions = [],
  admissionFeePaise,
  join,
  Camera = SelfieCapture,
  shrinkId = renderIdPhoto,
}: {
  readonly today: string;
  readonly minAge: number;
  readonly noticeVersion: string;
  readonly termsHref: string;
  readonly privacyHref: string;
  readonly plans: readonly QrPlanCard[];
  /** Personal training on sale; empty means the question is never asked (ADR-087). */
  readonly ptPlans?: readonly QrPlanCard[];
  /** The paid trial's lengths; empty means it is not offered here (ADR-088). */
  readonly trialOptions?: ReadonlyArray<{ readonly days: number; readonly totalPaise: number }>;
  readonly admissionFeePaise: number;
  readonly join: QrJoin;
  readonly Camera?: ComponentType<SelfieCaptureProps>;
  readonly shrinkId?: (file: File) => Promise<Blob>;
}) {
  const t = useTranslations('qrNewForm');
  const te = useTranslations('qrExisting');
  const locale = useLocale();

  const [step, setStep] = useState(0);
  const [fullName, setFullName] = useState('');
  const [mobile, setMobile] = useState('');
  const [dob, setDob] = useState('');
  const [gender, setGender] = useState<(typeof GENDERS)[number] | null>(null);
  const [email, setEmail] = useState('');
  const [photo, setPhoto] = useState<{ blob: Blob; url: string } | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [planId, setPlanId] = useState<string | null>(null);
  // "Do you need personal training?" — no, until they say otherwise (ADR-087).
  const [wantsPt, setWantsPt] = useState(false);
  const [ptPlanId, setPtPlanId] = useState<string | null>(null);
  /** Days of trial, chosen instead of a plan (ADR-088). */
  const [trialDays, setTrialDays] = useState<number | null>(null);
  const [slot, setSlot] = useState<TrainingSlot | null>(null);
  const [govIdType, setGovIdType] = useState<GovIdType | ''>('');
  const [govIdFront, setGovIdFront] = useState<Blob | null>(null);
  const [govIdBack, setGovIdBack] = useState<Blob | null>(null);
  const [govIdIsFile, setGovIdIsFile] = useState(false);
  const [shrinking, setShrinking] = useState(false);
  const [terms, setTerms] = useState(false);
  const [whatsapp, setWhatsapp] = useState(true);

  const [problems, setProblems] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [done, setDone] = useState<{ firstName: string; amountPaise: number } | null>(null);
  const [pending, start] = useTransition();
  const photoUrl = useRef<string | null>(null);

  const keepPhoto = (blob: Blob) => {
    if (photoUrl.current !== null) URL.revokeObjectURL(photoUrl.current);
    const url = URL.createObjectURL(blob);
    photoUrl.current = url;
    setPhoto({ blob, url });
    setCameraOpen(false);
  };

  const problem = (message: string | null) =>
    setProblems((current) => {
      const next = { ...current };
      if (message === null) delete next['govId'];
      else next['govId'] = message;
      return next;
    });

  const keepIdPhoto = (side: 'FRONT' | 'BACK', file: File | null) => {
    const keep = side === 'FRONT' ? setGovIdFront : setGovIdBack;
    if (file === null) {
      keep(null);
      if (side === 'FRONT') setGovIdIsFile(false);
      return;
    }
    const asFile = isPdf(file);
    if (side === 'FRONT') {
      setGovIdIsFile(asFile);
      if (asFile) setGovIdBack(null);
    }
    const settle = (blob: Blob) => {
      if (blob.size > MAX_UPLOAD_BYTES) {
        keep(null);
        problem(te('errors.govIdTooBig'));
        return;
      }
      problem(null);
      keep(blob);
    };
    if (asFile) {
      settle(file);
      return;
    }
    setShrinking(true);
    void shrinkId(file)
      .catch(() => file)
      .then(settle)
      .finally(() => setShrinking(false));
  };

  /** Only the plans for the gender they gave: the rest are not theirs to choose. */
  const forGender = (list: readonly QrPlanCard[]) =>
    gender === null ? [] : list.filter((plan) => plan.gender === gender).sort((a, b) => a.durationMonths - b.durationMonths);
  const myPlans = forGender(plans);
  const chosen = myPlans.find((plan) => plan.planId === planId) ?? null;
  const trial = trialOptions.find((option) => option.days === trialDays) ?? null;
  // A trainer cannot be booked past the membership they are on, and a trial carries none.
  const myPt = chosen === null ? [] : forGender(ptPlans).filter((card) => card.durationMonths <= chosen.durationMonths);
  const ptChosen = myPt.find((card) => card.planId === ptPlanId) ?? null;
  const price = (paise: number) => formatINR(paise, { showPaise: false });

  const missing = (): Record<string, string> => {
    const found: Record<string, string> = {};
    if (fullName.trim().length < 2) found['fullName'] = te('errors.fullName');
    if (!/^\d{10}$/.test(mobile.replace(/\D/g, ''))) found['mobile'] = te('errors.mobile');
    if (dob === '') found['dob'] = te('errors.dob');
    if (gender === null) found['gender'] = te('errors.gender');
    if (photo === null) found['selfie'] = te('errors.selfie');
    // A plan or a trial: one of the two has to be chosen (ADR-088).
    if (chosen === null && trial === null) found['plan'] = t('errors.plan');
    if (wantsPt && myPt.length > 0 && ptChosen === null) found['pt'] = t('errors.pt');
    if (slot === null) found['slot'] = te('errors.slot');
    if (govIdType === '') found['govId'] = te('errors.govIdType');
    else if (govIdFront === null || (!govIdIsFile && govIdType !== 'PAN' && govIdBack === null)) found['govId'] = te('errors.govIdPhotos');
    if (!terms) found['terms'] = te('errors.terms');
    return found;
  };

  if (done !== null) {
    return (
      <div className="grid gap-4 rounded-panel bg-tint-fee-paid-bg p-6">
        <h2 className="font-display text-title font-bold text-brand-obsidian">{t('done.title', { name: done.firstName })}</h2>
        <p className="font-display text-display-m font-bold text-brand-accent-deep">{price(done.amountPaise)}</p>
        <p className="text-body leading-body">{t('done.body')}</p>
      </div>
    );
  }


  const field = (name: string) => ({ problem: problems[name], optionalLabel: te('optional') });
  const chip = (active: boolean) =>
    cn('min-h-16 cursor-pointer rounded-button border-2 px-5 font-semibold', active ? 'border-brand-accent bg-brand-accent text-brand-white' : 'border-brand-stone/40 bg-white');

  const steps: ReadonlyArray<{ readonly keys: readonly string[]; readonly body: ReactNode }> = [
    {
      keys: ['fullName', 'mobile'],
      body: (
        <div className="grid gap-4">
          <Field {...field('fullName')} label={te('fields.fullName')}>
            <input aria-required="true" value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" className={QR_INPUT_CLASS} />
          </Field>
          <Field {...field('mobile')} label={te('fields.mobile')}>
            <input aria-required="true" value={mobile} onChange={(e) => setMobile(e.target.value)} inputMode="numeric" autoComplete="tel" maxLength={12} className={QR_INPUT_CLASS} />
            <span className="mt-1 block text-small text-brand-stone">{t('mobileHelp')}</span>
          </Field>
        </div>
      ),
    },
    {
      keys: ['dob', 'gender'],
      body: (
        <div className="grid gap-4">
          <Field {...field('dob')} label={te('fields.dob')}>
            <input aria-required="true" type="date" value={dob} max={today} onChange={(e) => setDob(e.target.value)} className={QR_INPUT_CLASS} />
          </Field>
          <fieldset>
            <legend className="text-body font-semibold text-brand-ink">{te('fields.gender')}</legend>
            <p className="mt-1 text-small text-brand-stone">{t('genderHelp')}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {GENDERS.map((value) => (
                <label key={value} className={`${chip(gender === value)} leading-[3.5rem]`}>
                  <input type="radio" name="gender" value={value} checked={gender === value} onChange={() => { setGender(value); setPlanId(null); }} className="sr-only" />
                  {te(`gender.${value}` as never)}
                </label>
              ))}
            </div>
            {problems['gender'] === undefined ? null : (
              <p role="alert" className="mt-1 text-small font-semibold text-semantic-fee-expired">
                {problems['gender']}
              </p>
            )}
          </fieldset>
        </div>
      ),
    },
    {
      keys: ['selfie'],
      body: (
        <section className="grid gap-2">
          <h2 className="text-body font-semibold text-brand-ink">{te('fields.selfie')}</h2>
          <p className="text-small text-brand-stone">{t('selfieHelp')}</p>
          <Camera open={cameraOpen} onOpenChange={setCameraOpen} onCaptured={keepPhoto} />
          {photo === null ? (
            <button type="button" onClick={() => setCameraOpen(true)} className="min-h-16 rounded-button border-2 border-dashed border-brand-stone/50 font-semibold text-brand-ink">
              {te('takePhoto')}
            </button>
          ) : (
            <div className="flex items-center gap-4">
              <img src={photo.url} alt="" className="size-24 rounded-panel object-cover" />
              <button type="button" onClick={() => setCameraOpen(true)} className="min-h-14 rounded-button border-2 border-brand-stone/40 px-4 font-semibold">
                {te('retakePhoto')}
              </button>
            </div>
          )}
          {problems['selfie'] === undefined ? null : (
            <p role="alert" className="text-small font-semibold text-semantic-fee-expired">
              {problems['selfie']}
            </p>
          )}
        </section>
      ),
    },
    {
      keys: ['plan'],
      body: (
        <fieldset>
          <legend className="text-body font-semibold text-brand-ink">{t('planTitle')}</legend>
          <p className="mt-1 text-small text-brand-stone">{t('planHelp')}</p>
          <div className="mt-3 grid gap-2">
            {myPlans.map((plan) => (
              <label key={plan.planId} className={cn(chip(planId === plan.planId), 'flex items-center justify-between py-4 text-left')}>
                <input
                  type="radio"
                  name="plan"
                  value={plan.planId}
                  checked={planId === plan.planId}
                  onChange={() => {
                    setPlanId(plan.planId);
                    setTrialDays(null);
                  }}
                  className="sr-only"
                />
                <span>{t('months', { count: plan.durationMonths })}</span>
                <span className="font-display text-title font-bold">{price(plan.pricePaise)}</span>
              </label>
            ))}
          </div>
          {admissionFeePaise > 0 ? <p className="mt-2 text-small text-brand-stone">{t('joiningFee', { amount: price(admissionFeePaise) })}</p> : null}

          {/* Or a few days first (ADR-088). Below the plans, so they see what a month
              costs before deciding to try three days. */}
          {trialOptions.length === 0 ? null : (
            <>
              <p className="mt-5 text-body font-semibold text-brand-ink">{t('trialTitle')}</p>
              <p className="mt-1 text-small text-brand-stone">{t('trialHelp')}</p>
              <div className="mt-3 grid gap-2">
                {trialOptions.map((option) => (
                  <label key={option.days} className={cn(chip(trialDays === option.days), 'flex items-center justify-between py-4 text-left')}>
                    <input
                      type="radio"
                      name="plan"
                      value={`trial-${option.days}`}
                      checked={trialDays === option.days}
                      onChange={() => {
                        setTrialDays(option.days);
                        setPlanId(null);
                        setPtPlanId(null);
                        setWantsPt(false);
                      }}
                      className="sr-only"
                    />
                    <span>{t('trialDays', { count: option.days })}</span>
                    <span className="font-display text-title font-bold">{price(option.totalPaise)}</span>
                  </label>
                ))}
              </div>
            </>
          )}

          {problems['plan'] === undefined ? null : (
            <p role="alert" className="mt-1 text-small font-semibold text-semantic-fee-expired">
              {problems['plan']}
            </p>
          )}
        </fieldset>
      ),
    },
    // Personal training, only when the gym sells it and only terms that fit inside the
    // plan they just chose (ADR-087). "No" is the answer until they say otherwise.
    ...(myPt.length === 0
      ? []
      : [
          {
            keys: ['pt'],
            body: (
              <fieldset>
                <legend className="text-body font-semibold text-brand-ink">{t('ptTitle')}</legend>
                <p className="mt-1 text-small text-brand-stone">{t('ptHelp')}</p>
                <div className="mt-3 flex gap-2">
                  {([false, true] as const).map((wants) => (
                    <label key={String(wants)} className={cn(chip(wantsPt === wants), 'flex-1 text-center leading-[3.5rem]')}>
                      <input
                        type="radio"
                        name="wants-pt"
                        value={wants ? 'yes' : 'no'}
                        checked={wantsPt === wants}
                        onChange={() => {
                          setWantsPt(wants);
                          if (!wants) setPtPlanId(null);
                        }}
                        className="sr-only"
                      />
                      {t(wants ? 'ptYes' : 'ptNo')}
                    </label>
                  ))}
                </div>
                {!wantsPt ? null : (
                  <div className="mt-3 grid gap-2">
                    {myPt.map((card) => (
                      <label key={card.planId} className={cn(chip(ptPlanId === card.planId), 'flex items-center justify-between py-4 text-left')}>
                        <input type="radio" name="pt" value={card.planId} checked={ptPlanId === card.planId} onChange={() => setPtPlanId(card.planId)} className="sr-only" />
                        <span>
                          <span className="block">{t('months', { count: card.durationMonths })}</span>
                          <span className="block text-small opacity-80">{t('ptPerMonth', { price: price(Math.round(card.pricePaise / card.durationMonths)) })}</span>
                        </span>
                        <span className="font-display text-title font-bold">{price(card.pricePaise)}</span>
                      </label>
                    ))}
                  </div>
                )}
                {problems['pt'] === undefined ? null : (
                  <p role="alert" className="mt-1 text-small font-semibold text-semantic-fee-expired">
                    {problems['pt']}
                  </p>
                )}
              </fieldset>
            ),
          },
        ]),
    {
      keys: ['slot'],
      body: (
        <fieldset>
          <legend className="text-body font-semibold text-brand-ink">{t('slotTitle')}</legend>
          <p className="mt-1 text-small text-brand-stone">{te('slotHelp')}</p>
          <div className="mt-3 grid gap-2">
            {TRAINING_SLOTS.map((value) => (
              <label key={value} className={`${chip(slot === value)} leading-[3.5rem]`}>
                <input type="radio" name="slot" value={value} checked={slot === value} onChange={() => setSlot(value)} className="sr-only" />
                {te(`slots.${value}` as never)}
              </label>
            ))}
          </div>
          {problems['slot'] === undefined ? null : (
            <p role="alert" className="mt-1 text-small font-semibold text-semantic-fee-expired">
              {problems['slot']}
            </p>
          )}
        </fieldset>
      ),
    },
    {
      keys: ['govId'],
      body: (
        <GovIdStep
          type={govIdType}
          onType={(value) => {
            setGovIdType(value);
            setGovIdFront(null);
            setGovIdBack(null);
            setGovIdIsFile(false);
          }}
          front={govIdFront}
          back={govIdBack}
          isFile={govIdIsFile}
          busy={shrinking}
          problem={problems['govId']}
          onPick={keepIdPhoto}
        />
      ),
    },
    {
      keys: [],
      body: (
        <div className="grid gap-4">
          <h2 className="text-body font-semibold text-brand-ink">{te('optionalTitle')}</h2>
          <Field {...field('email')} label={te('fields.email')} optional>
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="email" className={QR_INPUT_CLASS} />
            <span className="mt-1 block text-small text-brand-stone">{t('emailHelp')}</span>
          </Field>
        </div>
      ),
    },
    {
      keys: ['terms'],
      body: (
        <section className="grid gap-3">
          <h2 className="text-body font-semibold text-brand-ink">{te('beforeSend')}</h2>
          {chosen === null ? null : (
            <div className="rounded-panel bg-tint-fee-none-bg p-4">
              <p className="text-body font-semibold text-brand-obsidian">{t('summary', { months: chosen.durationMonths, amount: price(chosen.pricePaise + admissionFeePaise) })}</p>
              {/* Both amounts, and the total, before anything is handed over (PRD PT-04). */}
              {ptChosen === null ? null : (
                <p className="mt-1 text-body font-semibold text-brand-obsidian">
                  {t('ptSummary', {
                    months: ptChosen.durationMonths,
                    pt: price(ptChosen.pricePaise),
                    total: price(chosen.pricePaise + admissionFeePaise + ptChosen.pricePaise),
                  })}
                </p>
              )}
              {/* The gym has no live gateway; the money is handed over at the counter. */}
              <p className="mt-1 text-small text-brand-stone">{t('payAtReception')}</p>
            </div>
          )}
          <label className="flex items-start gap-3">
            <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} className="mt-1 size-6 accent-brand-accent" />
            <span className="text-body">{te('consent.terms')}</span>
          </label>
          <label className="flex items-start gap-3">
            <input type="checkbox" checked={whatsapp} onChange={(e) => setWhatsapp(e.target.checked)} className="mt-1 size-6 accent-brand-accent" />
            <span className="text-body">{te('consent.whatsapp')}</span>
          </label>
          <p className="flex gap-4 text-small">
            <a href={termsHref} className="font-semibold underline">
              {te('consent.readTerms')}
            </a>
            <a href={privacyHref} className="font-semibold underline">
              {te('consent.readPrivacy')}
            </a>
          </p>
          {problems['terms'] === undefined ? null : (
            <p role="alert" className="text-small font-semibold text-semantic-fee-expired">
              {problems['terms']}
            </p>
          )}
        </section>
      ),
    },
  ];

  const last = steps.length - 1;
  const here = steps[Math.min(step, last)];

  const goNext = () => {
    setFailure(null);
    const found = missing();
    const mine = Object.fromEntries(Object.entries(found).filter(([key]) => here?.keys.includes(key)));
    setProblems(mine);
    if (Object.keys(mine).length > 0) return;
    setStep((current) => Math.min(current + 1, last));
  };

  const send = () => {
    setFailure(null);
    const found = missing();
    setProblems(found);
    if (Object.keys(found).length > 0) {
      setFailure(te('errors.fillFirst'));
      return;
    }
    if (photo === null || gender === null || (chosen === null && trial === null) || govIdType === '' || slot === null) return;

    const form = new FormData();
    form.set('fullName', fullName.trim());
    form.set('mobile', mobile.replace(/\D/g, ''));
    form.set('dob', dob);
    form.set('gender', gender);
    form.set('language', locale === 'hi' ? 'hi' : 'en');
    form.set('noticeVersion', noticeVersion);
    form.set('consents', JSON.stringify({ terms, privacy: terms, whatsappUpdates: whatsapp, faceAttendance: false }));
    form.set('selfie', photo.blob, 'selfie.jpg');
    form.set('source', 'QR_NEW');
    form.set('trainingSlot', slot);
    if (email.trim() !== '') form.set('email', email.trim());
    form.set('govIdType', govIdType);
    if (govIdFront !== null) form.set('govIdFront', govIdFront, govIdIsFile ? 'id.pdf' : 'id-front.jpg');
    if (govIdBack !== null) form.set('govIdBack', govIdBack, 'id-back.jpg');

    start(async () => {
      // A sign-up needs a start date, and somebody standing at the desk starts today.
      const result = await join({
        form,
        planId: chosen?.planId ?? null,
        trialDays: trial?.days ?? null,
        ptPlanId: chosen === null || !wantsPt ? null : (ptChosen?.planId ?? null),
        startDate: today,
      });
      if (result.ok) {
        setDone({ firstName: result.firstName, amountPaise: result.amountPaise });
        return;
      }
      const beside: Record<string, string> = {};
      for (const name of result.fields ?? []) {
        const key = FIELD_OF[name];
        if (key !== undefined) beside[key] = key === 'plan' || key === 'pt' ? t(`errors.${key}`) : te(`errors.${key}` as never);
      }
      if (result.code === 'UNDER_MINIMUM_AGE') beside['dob'] = te('errors.underAge', { minAge: result.minAge ?? minAge });
      // The gate names what is wrong with the photograph, and the member is sent back to the
      // screen that holds it rather than left on the last one (ADR-080).
      if (result.code === 'SELFIE_REJECTED') {
        beside['selfie'] = te(`errors.${SELFIE_REASONS[result.selfieReason ?? ''] ?? 'selfie'}` as never);
      }
      setProblems(beside);

      const named = Object.keys(beside);
      if (named.length > 0) {
        // The screens themselves say which answers they hold, so a refusal lands where
        // the member can act on it even though the PT screen comes and goes (ADR-087).
        const owner = steps.findIndex((candidate) => candidate.keys.some((key) => named.includes(key)));
        if (owner >= 0) setStep(owner);
        setFailure(te('errors.checkMarked'));
      } else if (result.code === 'RATE_LIMITED') setFailure(te('errors.rateLimited'));
      else setFailure(te('errors.serverSaid', { code: result.code, reference: result.requestId ?? '—' }));
    });
  };

  return (
    <div className="grid gap-6">
      <QrProgress step={step} total={steps.length} />
      {here?.body}

      {failure === null ? null : (
        <p role="alert" className="rounded-panel bg-tint-fee-expired-bg p-4 text-body font-semibold text-semantic-fee-expired">
          {failure}
        </p>
      )}

      <div className="flex gap-3">
        {step === 0 ? null : (
          <button type="button" onClick={() => setStep(step - 1)} className="min-h-16 rounded-button border-2 border-brand-stone/40 px-6 text-body-l font-semibold text-brand-ink">
            {te('back')}
          </button>
        )}
        {step === last ? (
          <button type="button" onClick={send} disabled={pending} className="min-h-16 flex-1 rounded-button bg-brand-accent text-[1.25rem] font-bold text-brand-white disabled:opacity-60">
            {pending ? te('sending') : te('send')}
          </button>
        ) : (
          <button type="button" onClick={goNext} className="min-h-16 flex-1 rounded-button bg-brand-obsidian text-[1.25rem] font-bold text-brand-white">
            {te('next')}
          </button>
        )}
      </div>
    </div>
  );
}
