'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useId, useState, useTransition } from 'react';
import { GENDERS, LANGUAGES, MemberEditSchema, TRAINING_SLOTS, type MemberEditErrorCode } from '@mfp/shared';

/**
 * Correcting a member's details (crm-ux-blueprint §5).
 *
 * One screen, not a wizard: this is a correction, so whoever opened it already knows which
 * field is wrong and should not be walked through the other six. The same Zod schema the
 * action uses runs here first, so a mistyped number is caught before a round trip
 * (CLAUDE.md §2.3), and the field it names is the one that gets the error.
 *
 * Date of birth and training slot can be cleared: plenty of members on the paper register
 * have neither, and a blank must stay saveable rather than forcing a made-up birthday.
 */

export interface MemberEditValuesInput {
  readonly fullName: string;
  readonly mobile: string;
  readonly email: string;
  readonly dob: string;
  readonly gender: string;
  readonly language: string;
  readonly trainingSlot: string;
  readonly joinedOn: string;
  readonly notes: string;
  readonly whatsappOptIn: boolean;
}

export type MemberEditOutcome =
  | { ok: true; changed: readonly string[]; sharesMobileWith: number }
  | { ok: false; code: MemberEditErrorCode | 'FORBIDDEN' | 'NOT_FOUND' | 'ERASED' | 'generic' };

const FIELD = 'mt-1 min-h-14 w-full rounded-input border-2 border-brand-stone/40 bg-white px-4 text-crm-body text-brand-obsidian';

export function MemberEditForm({
  memberId,
  initial,
  save,
}: {
  readonly memberId: string;
  readonly initial: MemberEditValuesInput;
  readonly save: (memberId: string, values: MemberEditValuesInput) => Promise<MemberEditOutcome>;
}) {
  const t = useTranslations('crm.edit');
  // The profile's own words for these, so the form and the record cannot disagree.
  const gender = useTranslations('crm.gender');
  const slot = useTranslations('crm.verify.slot');
  const router = useRouter();
  const id = useId();
  const [values, setValues] = useState<MemberEditValuesInput>(initial);
  const [error, setError] = useState<{ field: string | null; message: string } | null>(null);
  const [shared, setShared] = useState(0);
  const [pending, start] = useTransition();

  const set = (field: keyof MemberEditValuesInput) => (next: string) => {
    setValues((was) => ({ ...was, [field]: next }));
    setError(null);
  };

  const setFlag = (field: keyof MemberEditValuesInput) => (next: boolean) => {
    setValues((was) => ({ ...was, [field]: next }));
    setError(null);
  };

  const submit = () => {
    const parsed = MemberEditSchema.safeParse(values);
    if (!parsed.success) {
      const code = parsed.error.issues[0]?.message ?? 'generic';
      setError({ field: code, message: t(`errors.${code}` as never) });
      return;
    }
    setError(null);
    start(async () => {
      const result = await save(memberId, values);
      if (result.ok) {
        router.refresh();
        // Saved either way — but if that number now belongs to two members, say so here
        // rather than flashing it past on the way back to the profile (SU-08).
        if (result.sharesMobileWith > 0) {
          setShared(result.sharesMobileWith);
          return;
        }
        router.push(`/crm/members/${memberId}`);
        return;
      }
      setError({ field: null, message: t(`errors.${result.code}` as never) });
    });
  };

  const label = 'block text-crm-body font-semibold text-brand-obsidian';
  const invalid = (field: string) => (error !== null && error.field === field ? 'border-semantic-fee-expired' : '');

  return (
    <div className="bg-white px-4 py-5 lg:rounded-panel lg:border lg:border-brand-stone/15 lg:p-6 lg:shadow-sm">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor={`${id}-name`} className={label}>
            {t('fullName')}
          </label>
          <input
            id={`${id}-name`}
            type="text"
            value={values.fullName}
            onChange={(event) => set('fullName')(event.target.value)}
            autoComplete="off"
            className={`${FIELD} ${invalid('fullName')}`}
          />
        </div>

        <div>
          <label htmlFor={`${id}-mobile`} className={label}>
            {t('mobile')}
          </label>
          <input
            id={`${id}-mobile`}
            type="tel"
            inputMode="numeric"
            value={values.mobile}
            onChange={(event) => set('mobile')(event.target.value)}
            className={`${FIELD} ${invalid('mobile')}`}
          />
          <p className="mt-1 text-small text-brand-stone">{t('mobileHelper')}</p>
        </div>

        <div>
          <label htmlFor={`${id}-email`} className={label}>
            {t('email')}
          </label>
          <input
            id={`${id}-email`}
            type="email"
            value={values.email}
            onChange={(event) => set('email')(event.target.value)}
            className={`${FIELD} ${invalid('email')}`}
          />
        </div>

        <div>
          <label htmlFor={`${id}-dob`} className={label}>
            {t('dob')}
          </label>
          <input id={`${id}-dob`} type="date" value={values.dob} onChange={(event) => set('dob')(event.target.value)} className={`${FIELD} ${invalid('dob')}`} />
          <p className="mt-1 text-small text-brand-stone">{t('dobHelper')}</p>
        </div>

        <div>
          <label htmlFor={`${id}-gender`} className={label}>
            {t('gender')}
          </label>
          <select id={`${id}-gender`} value={values.gender} onChange={(event) => set('gender')(event.target.value)} className={`${FIELD} ${invalid('gender')}`}>
            {GENDERS.map((value) => (
              <option key={value} value={value}>
                {gender(value)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor={`${id}-slot`} className={label}>
            {t('trainingSlot')}
          </label>
          <select
            id={`${id}-slot`}
            value={values.trainingSlot}
            onChange={(event) => set('trainingSlot')(event.target.value)}
            className={`${FIELD} ${invalid('trainingSlot')}`}
          >
            <option value="">{t('slotUnknown')}</option>
            {TRAINING_SLOTS.map((value) => (
              <option key={value} value={value}>
                {slot(value)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor={`${id}-language`} className={label}>
            {t('language')}
          </label>
          <select
            id={`${id}-language`}
            value={values.language}
            onChange={(event) => set('language')(event.target.value)}
            className={`${FIELD} ${invalid('language')}`}
          >
            {LANGUAGES.map((language) => (
              <option key={language} value={language}>
                {t(`languages.${language}` as never)}
              </option>
            ))}
          </select>
          <p className="mt-1 text-small text-brand-stone">{t('languageHelper')}</p>
        </div>

        {/* When they joined: on the profile since ADR-074 and on no form until now, so a
            wrong one could only be fixed in the database. */}
        <div>
          <label htmlFor={`${id}-joined`} className={label}>
            {t('joinedOn')}
          </label>
          <input
            id={`${id}-joined`}
            type="date"
            value={values.joinedOn}
            onChange={(event) => set('joinedOn')(event.target.value)}
            className={`${FIELD} ${invalid('joinedOn')}`}
          />
          <p className="mt-1 text-small text-brand-stone">{t('joinedOnHelper')}</p>
        </div>

        <div className="sm:col-span-2">
          <label htmlFor={`${id}-notes`} className={label}>
            {t('notes')}
          </label>
          <textarea
            id={`${id}-notes`}
            rows={3}
            maxLength={500}
            value={values.notes}
            onChange={(event) => set('notes')(event.target.value)}
            className={`${FIELD} py-3 ${invalid('notes')}`}
          />
          <p className="mt-1 text-small text-brand-stone">{t('notesHelper')}</p>
        </div>

        {/* Consent is withdrawn at the counter as often as it is given. */}
        <div className="sm:col-span-2">
          <label className="flex items-start gap-3 text-crm-body">
            <input
              type="checkbox"
              checked={values.whatsappOptIn}
              onChange={(event) => setFlag('whatsappOptIn')(event.target.checked)}
              className="mt-1 size-6 shrink-0 accent-brand-obsidian"
            />
            <span>
              <span className="font-semibold text-brand-obsidian">{t('whatsappOptIn')}</span>
              <span className="mt-0.5 block text-small text-brand-stone">{t('whatsappOptInHelper')}</span>
            </span>
          </label>
        </div>
      </div>

      {error === null ? null : (
        <p role="alert" className="mt-4 rounded-input bg-tint-fee-expired-bg p-3 text-crm-body font-semibold text-semantic-fee-expired">
          {error.message}
        </p>
      )}
      {shared === 0 ? null : (
        <p role="status" className="mt-4 rounded-input bg-tint-fee-due-soon-bg p-3 text-crm-body font-semibold text-semantic-fee-due-soon">
          {t('sharedMobile', { count: shared })}
        </p>
      )}

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          disabled={pending}
          onClick={submit}
          className="min-h-16 rounded-panel bg-brand-accent text-crm-body font-bold text-brand-white disabled:opacity-50"
        >
          {pending ? t('saving') : t('save')}
        </button>
        <button type="button" onClick={() => router.push(`/crm/members/${memberId}`)} className="min-h-16 rounded-panel border-2 border-brand-stone/40 text-crm-body font-semibold text-brand-obsidian">
          {shared === 0 ? t('cancel') : t('backToProfile')}
        </button>
      </div>
    </div>
  );
}
