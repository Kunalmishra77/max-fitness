'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { GOV_ID_TYPES, govIdSidesFor, type GovIdType } from '@mfp/core';
import { cn } from '@/lib/cn';

/**
 * The pieces both reception forms are made of (ADR-083).
 *
 * The member filling one of these is standing at a desk with a queue behind them,
 * whether they joined in 2019 or five minutes ago, so the two forms ask differently but
 * behave identically: one question on the screen, uploads you can hit with a thumb, and
 * a complaint underneath the answer it is about.
 */

export const QR_INPUT_CLASS = 'mt-1 min-h-14 w-full rounded-input border-2 border-brand-stone/40 bg-white px-4 text-body-l';

/**
 * The most one photograph may be once the browser has shrunk it.
 *
 * The host refuses a request over about 4.5 MB before our server runs, so a selfie and
 * the ID have to leave room for each other. A shrunk card is nearer 400 KB; this is the
 * line past which we say so rather than send something that will bounce (ADR-080).
 */
export const MAX_UPLOAD_BYTES = 1_200_000;

export const isPdf = (file: File) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name);

/**
 * One labelled answer, with its own complaint underneath.
 *
 * Declared at module level, never inside a form. A component defined inside another one
 * is a new component type on every render, so React unmounts and remounts it — which
 * takes the focus away after each keystroke and makes the field impossible to type into.
 */
export function Field({
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

/** How far through the member is. A bar, not "Question 4 of 8" shouted at them. */
export function QrProgress({ step, total }: { step: number; total: number }) {
  return (
    <div>
      <p className="text-small font-semibold text-brand-stone">
        {step + 1} / {total}
      </p>
      <div aria-hidden className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-brand-stone/20">
        <span className="block h-full rounded-full bg-brand-accent transition-[width] duration-300" style={{ width: `${((step + 1) / total) * 100}%` }} />
      </div>
    </div>
  );
}

/**
 * Which card, and a photograph of each side it has — or the one file the member already
 * has, which carries the whole card and makes a "back" meaningless (ADR-081).
 */
export function GovIdStep({
  type,
  onType,
  front,
  back,
  isFile,
  busy,
  problem,
  onPick,
}: {
  readonly type: GovIdType | '';
  readonly onType: (type: GovIdType | '') => void;
  readonly front: Blob | null;
  readonly back: Blob | null;
  readonly isFile: boolean;
  readonly busy: boolean;
  readonly problem: string | undefined;
  readonly onPick: (side: 'FRONT' | 'BACK', file: File | null) => void;
}) {
  const t = useTranslations('qrExisting');
  const sides = type === '' ? [] : isFile ? (['FRONT'] as const) : govIdSidesFor(type);

  return (
    <section className="grid gap-3">
      <Field label={t('fields.govIdType')} problem={problem} optionalLabel={t('optional')}>
        <select aria-required="true" value={type} onChange={(event) => onType(event.target.value as GovIdType | '')} className={QR_INPUT_CLASS}>
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
        const chosen = side === 'FRONT' ? front : back;
        return (
          /* A big obvious target: the member is holding a card in their other hand. */
          <label
            key={side}
            className={cn(
              'block cursor-pointer rounded-panel border-2 border-dashed p-5 text-center',
              chosen === null ? 'border-brand-stone/50 bg-white' : 'border-semantic-fee-paid bg-tint-fee-paid-bg',
            )}
          >
            <span aria-hidden className="block text-[2.5rem] leading-none">{chosen === null ? '📷' : isFile && side === 'FRONT' ? '📄' : '✓'}</span>
            <span className="mt-2 block text-body-l font-semibold text-brand-ink">
              {isFile && side === 'FRONT' ? t('govId.wholeCard') : t(side === 'FRONT' ? 'govId.front' : 'govId.back')}
            </span>
            <span className="mt-1 block text-small text-brand-stone">{busy ? t('govId.working') : chosen === null ? t('govId.tapToAdd') : t('govId.added')}</span>
            {/* No `capture`: the phone then offers the camera *and* the gallery and the
                files app, because plenty of members have the card only as a file. */}
            <input type="file" accept="image/*,application/pdf" onChange={(event) => onPick(side, event.target.files?.[0] ?? null)} className="sr-only" />
          </label>
        );
      })}
    </section>
  );
}
