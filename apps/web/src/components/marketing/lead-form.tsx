'use client';

import { LEAD_ERROR_CODES, LEAD_GOALS, type LeadErrorCode } from '@mfp/shared/schemas/lead-constants';
import type { LeadFormValues, LeadUtm } from '@mfp/shared/schemas/lead';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState } from 'react';
import { useForm, type FieldErrors, type Resolver } from 'react-hook-form';
import { track } from '@/lib/analytics';
import { cn } from '@/lib/cn';
import { buttonVariants } from '@/components/ui/button';
import { ChatIcon, ChevronDownIcon } from './icons';

/**
 * "Get a call back" form (PRD LP-04).
 *
 * Validated in the browser with the same Zod schema the API uses (CLAUDE.md §2.3).
 * Messages are codes from the schema, looked up in the catalogue, so errors read the
 * same in the browser and after a server-side rejection.
 *
 * The schema — and Zod with it — loads on the first interaction with the form, not
 * with the page (ADR-033); the goal list and error codes come from a schema-free
 * module so the form renders without it.
 *
 * Bot signals travel with the request but are never shown: a honeypot field people
 * cannot see, and the time the form was rendered.
 */

type LeadFormInput = { name: string; mobile: string; goal: string };
type FormProblem = 'rateLimited' | 'generic' | 'network';

const ERROR_CODES = new Set<string>(LEAD_ERROR_CODES);
const FIELDS = new Set<string>(['name', 'mobile', 'goal']);

const loadSchema = () => import('@mfp/shared/schemas/lead');

export const leadResolver: Resolver<LeadFormInput, unknown, LeadFormValues> = async (values) => {
  const { LeadFormSchema } = await loadSchema();
  const parsed = LeadFormSchema.safeParse(values);
  if (parsed.success) return { values: parsed.data, errors: {} };

  const errors: Record<string, { type: string; message: string }> = {};
  for (const issue of parsed.error.issues) {
    const field = issue.path[0];
    if (typeof field === 'string' && errors[field] === undefined) {
      errors[field] = { type: issue.code, message: issue.message };
    }
  }
  return { values: {}, errors: errors as FieldErrors<LeadFormInput> };
};

function utmFromLocation(): LeadUtm | undefined {
  const params = new URLSearchParams(window.location.search);
  const utm: Record<string, string> = {};
  for (const key of ['source', 'medium', 'campaign', 'term', 'content'] as const) {
    const value = params.get(`utm_${key}`)?.trim();
    if (value) utm[key] = value.slice(0, 100);
  }
  return Object.keys(utm).length > 0 ? utm : undefined;
}

/** `details.fields` from a 400 response, as `{ field: code }`. */
function serverFieldErrors(body: unknown): Array<[keyof LeadFormInput, LeadErrorCode]> {
  const fields = (body as { error?: { details?: { fields?: Record<string, unknown> } } } | null)?.error?.details?.fields;
  if (fields === undefined || fields === null) return [];
  const result: Array<[keyof LeadFormInput, LeadErrorCode]> = [];
  for (const [field, value] of Object.entries(fields)) {
    const code: unknown = Array.isArray(value) ? (value as unknown[])[0] : value;
    if (FIELDS.has(field) && typeof code === 'string' && ERROR_CODES.has(code)) {
      result.push([field as keyof LeadFormInput, code as LeadErrorCode]);
    }
  }
  return result;
}

export function LeadForm() {
  const t = useTranslations('lead');
  const id = useId();
  const [submitted, setSubmitted] = useState(false);
  const [problem, setProblem] = useState<FormProblem | null>(null);
  const renderedAt = useRef(0);
  const honeypot = useRef<HTMLInputElement>(null);

  useEffect(() => {
    renderedAt.current = Date.now();
  }, [submitted]);

  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<LeadFormInput, unknown, LeadFormValues>({
    resolver: leadResolver,
    defaultValues: { name: '', mobile: '', goal: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setProblem(null);
    const company = honeypot.current?.value ?? '';

    let response: Response;
    try {
      response = await fetch('/api/v1/leads', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...values,
          source: 'WEBSITE_HERO',
          consentContact: true,
          renderedAt: renderedAt.current,
          ...(company === '' ? {} : { company }),
          utm: utmFromLocation(),
        }),
      });
    } catch {
      setProblem('network');
      return;
    }

    if (response.status === 201) {
      track('lead_submitted', { goal: values.goal });
      reset();
      setSubmitted(true);
      return;
    }
    if (response.status === 429) {
      setProblem('rateLimited');
      return;
    }
    if (response.status === 400) {
      const fieldErrors = serverFieldErrors(await response.json().catch(() => null));
      if (fieldErrors.length > 0) {
        fieldErrors.forEach(([field, code], index) => setError(field, { type: 'server', message: code }, { shouldFocus: index === 0 }));
        return;
      }
    }
    setProblem('generic');
  });

  const fieldError = (field: keyof LeadFormInput) => {
    const code = errors[field]?.message;
    return code !== undefined && ERROR_CODES.has(code) ? t(`errors.${code as LeadErrorCode}`) : null;
  };

  const inputClass = (invalid: boolean) =>
    cn(
      'min-h-12 w-full rounded-input border bg-brand-white px-3 text-body text-brand-ink',
      invalid ? 'border-2 border-semantic-fee-expired' : 'border-brand-rubber-grey/40',
    );

  if (submitted) {
    return (
      <div className="rounded-panel bg-brand-chalk p-6 text-brand-ink shadow-[var(--shadow-overlay)]">
        <h2 className="font-display text-display-m leading-tight font-bold text-brand-plate-navy">{t('title')}</h2>
        <p role="status" className="mt-4 text-body-l leading-body">
          {t('success')}
        </p>
        <p className="mt-2 flex items-center gap-2 text-body text-brand-ink/80">
          <ChatIcon />
          {t('whatsappToo')}
        </p>
        <button
          type="button"
          onClick={() => setSubmitted(false)}
          className={cn(buttonVariants({ variant: 'outlineDark', full: true }), 'mt-6')}
        >
          {t('sendAnother')}
        </button>
      </div>
    );
  }

  const nameError = fieldError('name');
  const mobileError = fieldError('mobile');
  const goalError = fieldError('goal');

  return (
    <form
      noValidate
      onSubmit={(event) => void onSubmit(event)}
      // Start fetching the schema as soon as someone reaches the form.
      onFocusCapture={() => void loadSchema()}
      aria-labelledby={`${id}-title`}
      className="rounded-panel bg-brand-chalk p-6 text-brand-ink shadow-[var(--shadow-overlay)]"
    >
      <h2 id={`${id}-title`} className="font-display text-display-m leading-tight font-bold text-brand-plate-navy">
        {t('title')}
      </h2>

      <div className="mt-5 grid gap-4">
        <div>
          <label htmlFor={`${id}-name`} className="block text-body font-semibold">
            {t('name')}
          </label>
          <input
            id={`${id}-name`}
            type="text"
            autoComplete="name"
            aria-invalid={nameError !== null}
            aria-describedby={nameError === null ? undefined : `${id}-name-error`}
            className={cn('mt-1.5', inputClass(nameError !== null))}
            {...register('name')}
          />
          {nameError === null ? null : (
            <p id={`${id}-name-error`} className="mt-1 text-small font-medium text-semantic-fee-expired">
              {nameError}
            </p>
          )}
        </div>

        <div>
          <label htmlFor={`${id}-mobile`} className="block text-body font-semibold">
            {t('mobile')}
          </label>
          <div className="mt-1.5 flex">
            <span
              aria-hidden
              className="inline-flex min-h-12 items-center rounded-l-input border border-r-0 border-brand-rubber-grey/40 bg-brand-chalk px-3 text-body text-brand-rubber-grey"
            >
              {t('mobilePrefix')}
            </span>
            <input
              id={`${id}-mobile`}
              type="tel"
              inputMode="numeric"
              autoComplete="tel-national"
              maxLength={14}
              aria-invalid={mobileError !== null}
              aria-describedby={mobileError === null ? undefined : `${id}-mobile-error`}
              className={cn(inputClass(mobileError !== null), 'rounded-l-none')}
              {...register('mobile')}
            />
          </div>
          {mobileError === null ? null : (
            <p id={`${id}-mobile-error`} className="mt-1 text-small font-medium text-semantic-fee-expired">
              {mobileError}
            </p>
          )}
        </div>

        <div>
          <label htmlFor={`${id}-goal`} className="block text-body font-semibold">
            {t('goal')}
          </label>
          <div className="relative mt-1.5">
            <select
              id={`${id}-goal`}
              aria-invalid={goalError !== null}
              aria-describedby={goalError === null ? undefined : `${id}-goal-error`}
              className={cn(inputClass(goalError !== null), 'appearance-none pr-10')}
              {...register('goal')}
            >
              <option value="" disabled>
                {t('goalPlaceholder')}
              </option>
              {LEAD_GOALS.map((goal) => (
                <option key={goal} value={goal}>
                  {t(`goals.${goal}`)}
                </option>
              ))}
            </select>
            <ChevronDownIcon
              aria-hidden
              className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-[1.1rem] text-brand-rubber-grey"
            />
          </div>
          {goalError === null ? null : (
            <p id={`${id}-goal-error`} className="mt-1 text-small font-medium text-semantic-fee-expired">
              {goalError}
            </p>
          )}
        </div>

        {/* Honeypot: off-screen and out of the tab order; people never fill it, many bots do. */}
        <div aria-hidden className="absolute -left-[9999px] h-px w-px overflow-hidden">
          <label htmlFor={`${id}-company`}>{t('honeypotLabel')}</label>
          <input ref={honeypot} id={`${id}-company`} name="company" type="text" tabIndex={-1} autoComplete="off" />
        </div>
      </div>

      {problem === null ? null : (
        <p role="alert" className="mt-4 rounded-input bg-tint-fee-expired-bg p-3 text-body font-medium text-semantic-fee-expired">
          {t(`errors.${problem}`)}
        </p>
      )}

      <button
        type="submit"
        disabled={isSubmitting}
        className={cn(buttonVariants({ variant: 'primary', size: 'hero', full: true }), 'mt-5')}
      >
        {isSubmitting ? t('submitting') : t('submit')}
      </button>
      <p className="mt-3 text-small leading-body text-brand-rubber-grey">{t('consent')}</p>
    </form>
  );
}
