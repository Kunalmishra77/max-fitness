'use client';

import { useRef, useState, useTransition, type ComponentType, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { GOV_ID_TYPES, govIdSidesFor, TRAINING_SLOTS, type GovIdType, type TrainingSlot } from '@mfp/core';
import { renderIdPhoto } from '@/components/join/render-photo';
import { SelfieCapture, type SelfieCaptureProps } from '@/components/join/selfie-capture';
import { cn } from '@/lib/cn';
import { CrmIcon } from '@/components/crm/crm-icons';
import { SELFIE_REASONS } from './selfie-reasons';

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
  | { ok: true; referenceCode: string; autopay?: { token: string; coveredUntil: string } }
  | { ok: false; code: string; fields?: readonly string[]; requestId?: string | undefined; minAge?: number | undefined; selfieReason?: string | undefined };

export type QrSubmit = (form: FormData) => Promise<QrSubmitResult>;



/**
 * The most one photograph may be once the browser has shrunk it.
 *
 * The host refuses a request over about 4.5 MB before our server runs, so a selfie and
 * two cards have to leave room for each other. A shrunk card is nearer 400 KB; this is
 * the line past which we say so rather than send something that will bounce (ADR-080).
 */
const MAX_UPLOAD_BYTES = 1_200_000;

/**
 * Which answers belong to which screen, in order.
 *
 * Declared here rather than read back out of the rendered steps, so a refusal that names
 * an answer can send the member to the screen holding it without the render having run.
 */
const STEP_KEYS: ReadonlyArray<readonly string[]> = [
  ['fullName', 'mobile'],
  ['dob', 'gender'],
  ['selfie'],
  ['plan', 'endDate'],
  // Straight after the fee, because it is the same subject and the member has the amount
  // in their head (owner, 2026-10-07).
  ['payMethod'],
  ['slot'],
  ['govId'],
  [],
  ['terms'],
];

const PLANS = ['1', '3', '6', '12', 'unsure'] as const;
const PAY_METHODS = ['CASH', 'ONLINE'] as const;
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
  payMethod: 'payMethod',
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
  shrinkId = renderIdPhoto,
}: {
  readonly today: string;
  readonly minAge: number;
  readonly noticeVersion: string;
  readonly termsHref: string;
  readonly privacyHref: string;
  readonly submit: QrSubmit;
  readonly onSubmitted: (referenceCode: string, autopay?: { token: string; coveredUntil: string }) => void;
  /** Injected in tests; the real sheet needs a camera. */
  readonly Camera?: ComponentType<SelfieCaptureProps>;
  /** Injected in tests; the real one needs a canvas. */
  readonly shrinkId?: (file: File) => Promise<Blob>;
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
  // Nothing pre-selected: cash is the common answer, not an answer to assume.
  const [payMethod, setPayMethod] = useState<(typeof PAY_METHODS)[number] | null>(null);
  const [slot, setSlot] = useState<TrainingSlot | null>(null);
  const [govIdType, setGovIdType] = useState<GovIdType | ''>('');
  // Shrunk in the browser as soon as it is picked: a raw phone photo of an Aadhaar is
  // several megabytes, and three of those are more than the request may carry (ADR-080).
  const [govIdFront, setGovIdFront] = useState<Blob | null>(null);
  const [govIdBack, setGovIdBack] = useState<Blob | null>(null);
  // A DigiLocker PDF is the whole card, so once one is picked there is no back to ask
  // for — and asking would be asking for something that does not exist (ADR-081).
  const [govIdIsFile, setGovIdIsFile] = useState(false);
  const [shrinking, setShrinking] = useState(false);
  const [terms, setTerms] = useState(false);
  const [whatsapp, setWhatsapp] = useState(true);
  const [face, setFace] = useState(false);

  // One question on the screen at a time: the gym watched members struggle with the whole
  // form on a phone at reception and asked for this back (ADR-080).
  const [step, setStep] = useState(0);
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

  const sides = govIdType === '' ? [] : govIdIsFile ? (['FRONT'] as const) : govIdSidesFor(govIdType);

  /**
   * Shrink the picked card before it goes anywhere (ADR-080).
   *
   * If the browser cannot decode it — an old phone, an odd format — we keep the original
   * only when it is small enough to arrive. Sending a four-megabyte photo is not a
   * fallback: the host refuses it before our server sees it, and the member is left with
   * a number instead of an answer, which is exactly what happened at reception.
   */
  const keepIdPhoto = (side: 'FRONT' | 'BACK', file: File | null) => {
    const keep = side === 'FRONT' ? setGovIdFront : setGovIdBack;
    const problem = (message: string | null) =>
      setProblems((current) => {
        const next = { ...current };
        if (message === null) delete next['govId'];
        else next['govId'] = message;
        return next;
      });

    if (file === null) {
      keep(null);
      if (side === 'FRONT') setGovIdIsFile(false);
      return;
    }

    // A file the member already has goes up as it is: there is nothing to shrink, and
    // it carries the whole card rather than one side of it.
    const isFile = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    if (side === 'FRONT') {
      setGovIdIsFile(isFile);
      if (isFile) setGovIdBack(null);
    }
    if (isFile) {
      if (file.size > MAX_UPLOAD_BYTES) {
        keep(null);
        problem(t('errors.govIdTooBig'));
        return;
      }
      problem(null);
      keep(file);
      return;
    }

    setShrinking(true);
    void shrinkId(file)
      .catch(() => file)
      .then((blob) => {
        if (blob.size > MAX_UPLOAD_BYTES) {
          keep(null);
          problem(t('errors.govIdTooBig'));
          return;
        }
        problem(null);
        keep(blob);
      })
      .finally(() => setShrinking(false));
  };

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
    if (payMethod === null) found['payMethod'] = t('errors.payMethod');
    if (slot === null) found['slot'] = t('errors.slot');
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
    if (slot !== null) form.set('trainingSlot', slot);
    if (payMethod !== null) form.set('payMethod', payMethod);
    form.set('selfie', photo.blob, 'selfie.jpg');
    if (email.trim() !== '') form.set('email', email.trim());
    if (joinedOn !== '') form.set('joinedOn', joinedOn);
    form.set('govIdType', govIdType);
    if (govIdFront !== null) form.set('govIdFront', govIdFront, 'id-front.jpg');
    if (govIdBack !== null) form.set('govIdBack', govIdBack, 'id-back.jpg');

    start(async () => {
      const result = await submit(form);
      if (result.ok) {
        onSubmitted(result.referenceCode, result.autopay);
        return;
      }

      // A complaint about one answer belongs beside that answer.
      const beside: Record<string, string> = {};
      for (const name of result.fields ?? []) {
        const key = FIELD_OF[name];
        if (key !== undefined) beside[key] = t(`errors.${key}` as never);
      }
      if (result.code === 'UNDER_MINIMUM_AGE') beside['dob'] = t('errors.underAge', { minAge: result.minAge ?? minAge });
      if (result.code === 'SELFIE_REJECTED') {
        beside['selfie'] = t(`errors.${SELFIE_REASONS[result.selfieReason ?? ''] ?? 'selfie'}` as never);
      }
      setProblems(beside);
      // A complaint about an answer two screens back is no use on the last screen.
      const named = Object.keys(beside);
      if (named.length > 0) {
        const owner = STEP_KEYS.findIndex((keys) => keys.some((key) => named.includes(key)));
        if (owner >= 0) setStep(owner);
      }

      // And when it is not about an answer, say what it was — with the reference the
      // gym can quote, rather than a dead end that helps nobody.
      if (Object.keys(beside).length > 0) setFailure(t('errors.checkMarked'));
      else if (result.code === 'RATE_LIMITED') setFailure(t('errors.rateLimited'));
      else setFailure(t('errors.serverSaid', { code: result.code, reference: result.requestId ?? '—' }));
    });
  };

  const inputClass = 'mt-1 min-h-14 w-full rounded-input border-2 border-brand-stone/40 bg-white px-4 text-body-l';

  const field = (name: string) => ({ problem: problems[name], optionalLabel: t('optional') });

  const steps: ReadonlyArray<{ readonly keys: readonly string[]; readonly body: ReactNode }> = [
    {
      keys: STEP_KEYS[0] ?? [],
      body: (
      <div className="grid gap-4">
        <Field {...field('fullName')} label={t('fields.fullName')}>
          <input aria-required="true" value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" className={inputClass} />
        </Field>

        <Field {...field('mobile')} label={t('fields.mobile')}>
          <input aria-required="true" value={mobile} onChange={(e) => setMobile(e.target.value)} inputMode="numeric" autoComplete="tel" maxLength={12} className={inputClass} />
        </Field>
      </div>
      ),
    },
    {
      keys: STEP_KEYS[1] ?? [],
      body: (
      <div className="grid gap-4">
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
      </div>
      ),
    },
    {
      keys: STEP_KEYS[2] ?? [],
      body: (
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
      ),
    },
    {
      keys: STEP_KEYS[3] ?? [],
      body: (
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
      </section>
      ),
    },
    {
      /**
       * "How do you pay?" (owner, 2026-10-07).
       *
       * Cash is what this gym has always run on and is the honest default, so it is first
       * and nothing is pre-selected — a member who pays at the counter should not have to
       * undo an answer somebody else chose for them.
       *
       * Picking online does not set anything up here. The standing instruction's first
       * debit falls the day after this member's cover ends, and that date is still only
       * what they typed; the gym checks it at the desk within minutes, and the link goes
       * out then.
       */
      keys: STEP_KEYS[4] ?? [],
      body: (
      <fieldset>
        <legend className="text-body font-semibold text-brand-ink">{t('fields.payMethod')}</legend>
        <div className="mt-2 grid gap-2">
          {PAY_METHODS.map((value) => (
            <label
              key={value}
              className={cn(
                'min-h-14 cursor-pointer rounded-button border-2 px-5 py-3 font-semibold',
                payMethod === value ? 'border-brand-accent bg-brand-accent text-brand-white' : 'border-brand-stone/40 bg-white',
              )}
            >
              <input type="radio" name="payMethod" value={value} checked={payMethod === value} onChange={() => setPayMethod(value)} className="sr-only" />
              <span className="block">{t(`payMethods.${value}` as never)}</span>
              <span className={cn('mt-0.5 block text-small font-normal', payMethod === value ? 'text-brand-white/80' : 'text-brand-stone')}>
                {t(`payMethods.${value}Help` as never)}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      ),
    },
    {
      // The gym shuts between noon and five, so this is a real question with a real use:
      // it tells the owner when to have a trainer on the floor (ADR-082).
      keys: STEP_KEYS[5] ?? [],
      body: (
      <fieldset>
        <legend className="text-body font-semibold text-brand-ink">{t('fields.slot')}</legend>
        <p className="mt-1 text-small text-brand-stone">{t('slotHelp')}</p>
        <div className="mt-3 grid gap-2">
          {TRAINING_SLOTS.map((value) => (
            <label
              key={value}
              className={cn(
                'min-h-16 cursor-pointer rounded-button border-2 px-5 leading-[3.5rem] font-semibold',
                slot === value ? 'border-brand-accent bg-brand-accent text-brand-white' : 'border-brand-stone/40 bg-white',
              )}
            >
              <input type="radio" name="slot" value={value} checked={slot === value} onChange={() => setSlot(value)} className="sr-only" />
              {t(`slots.${value}` as never)}
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
      keys: STEP_KEYS[6] ?? [],
      body: (
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

        {sides.map((side) => {
          const chosen = side === 'FRONT' ? govIdFront : govIdBack;
          return (
          /* A big obvious target: a member at reception is holding a card in one hand. */
          <label
            key={side}
            className={cn(
              'block cursor-pointer rounded-panel border-2 border-dashed p-5 text-center',
              chosen === null ? 'border-brand-stone/50 bg-white' : 'border-semantic-fee-paid bg-tint-fee-paid-bg',
            )}
          >
            <CrmIcon
              name={chosen === null ? 'camera' : govIdIsFile && side === 'FRONT' ? 'document' : 'success'}
              className={cn('mx-auto size-10', chosen === null ? 'text-brand-stone' : 'text-semantic-fee-paid')}
            />
            <span className="mt-2 block text-body-l font-semibold text-brand-ink">
              {govIdIsFile && side === 'FRONT' ? t('govId.wholeCard') : t(side === 'FRONT' ? 'govId.front' : 'govId.back')}
            </span>
            <span className="mt-1 block text-small text-brand-stone">
              {shrinking ? t('govId.working') : chosen === null ? t('govId.tapToAdd') : t('govId.added')}
            </span>
            {/* No `capture`: the phone then offers the camera *and* the gallery and the
                files app, because plenty of members already have the card as photos or a
                DigiLocker PDF and never have the plastic on them (ADR-081). */}
            <input
              type="file"
              accept="image/*,application/pdf"
              onChange={(e) => keepIdPhoto(side, e.target.files?.[0] ?? null)}
              className="sr-only"
            />
          </label>
          );
        })}
      </section>
      ),
    },
    {
      // Both optional, on a screen of their own so nobody is held up by them.
      keys: STEP_KEYS[7] ?? [],
      body: (
      <div className="grid gap-4">
        <h2 className="text-body font-semibold text-brand-ink">{t('optionalTitle')}</h2>
        <Field {...field('email')} label={t('fields.email')} optional>
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="email" className={inputClass} />
        </Field>

        <Field {...field('joinedOn')} label={t('fields.joinedOn')} optional>
          <input type="date" value={joinedOn} max={today} onChange={(e) => setJoinedOn(e.target.value)} className={inputClass} />
          <span className="mt-1 block text-small text-brand-stone">{t('joinedOnHelp')}</span>
        </Field>
      </div>
      ),
    },
    {
      keys: STEP_KEYS[8] ?? [],
      body: (
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
      ),
    },
  ];

  const last = steps.length - 1;
  const here = steps[Math.min(step, last)];

  /** Only this screen's answers hold the member up; the rest are asked later. */
  const goNext = () => {
    setFailure(null);
    const found = missing();
    const mine = Object.fromEntries(Object.entries(found).filter(([key]) => here?.keys.includes(key)));
    setProblems(mine);
    if (Object.keys(mine).length > 0) return;
    setStep((current) => Math.min(current + 1, last));
  };

  return (
    <div className="grid gap-6">
      <div>
        <p className="text-small font-semibold text-brand-stone">
          {step + 1} / {steps.length}
        </p>
        <div aria-hidden className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-brand-stone/20">
          <span className="block h-full rounded-full bg-brand-accent transition-[width] duration-300" style={{ width: `${((step + 1) / steps.length) * 100}%` }} />
        </div>
      </div>

      {here?.body}

      {failure === null ? null : (
        <p role="alert" className="rounded-panel bg-tint-fee-expired-bg p-4 text-body font-semibold text-semantic-fee-expired">
          {failure}
        </p>
      )}

      <div className="flex gap-3">
        {step === 0 ? null : (
          <button type="button" onClick={() => setStep(step - 1)} className="min-h-16 rounded-button border-2 border-brand-stone/40 px-6 text-body-l font-semibold text-brand-ink">
            {t('back')}
          </button>
        )}
        {step === last ? (
          <button type="button" onClick={send} disabled={pending} className="min-h-16 flex-1 rounded-button bg-brand-accent text-[1.25rem] font-bold text-brand-white disabled:opacity-60">
            {pending ? t('sending') : t('send')}
          </button>
        ) : (
          <button type="button" onClick={goNext} className="min-h-16 flex-1 rounded-button bg-brand-obsidian text-[1.25rem] font-bold text-brand-white">
            {t('next')}
          </button>
        )}
      </div>
    </div>
  );
}
