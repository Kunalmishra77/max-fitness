import { govIdSidesFor, isGovIdType, type GovIdType } from '@mfp/core';
import { istDate, PLAN_DURATIONS, type ISTDate, type PlanDurationMonths, type RegistrationFields } from '@mfp/shared';
import { parseRegistrationForm } from './registration-form';

/**
 * Reading the `POST /qr/existing` multipart body (api-specification.md; qr-onboarding-flow §3; ADR-058).
 *
 * The details and selfie go through the sign-up parser unchanged; the three declared
 * parts are read here. The range of the month-end date is a business rule and is
 * checked in packages/core; here it only has to be a real `YYYY-MM-DD` date.
 */

export type QrExistingFormResult =
  | {
      readonly ok: true;
      readonly fields: RegistrationFields;
      readonly selfie: Uint8Array;
      readonly declaredPlanMonths: PlanDurationMonths | null;
      readonly declaredEndDate: ISTDate;
      readonly declaredAmountPaise: number | null;
      /** Optional: plenty of members will not remember the day they joined. */
      readonly joinedOn: ISTDate | null;
      /** Photographs only. The parser never reads, and the form never asks for, a number. */
      readonly govId: { readonly type: GovIdType; readonly images: readonly RawGovIdImage[] } | null;
    }
  | { readonly ok: false; readonly fields: Record<string, string> };

/** A side as it arrives from the form, before its pixels have been measured. */
export interface RawGovIdImage {
  readonly side: 'FRONT' | 'BACK';
  readonly body: Uint8Array;
}

const MAX_RUPEES = 1_000_000;
/** A photograph of a card off a phone camera; anything larger is not a card. */
const MAX_ID_BYTES = 8 * 1024 * 1024;

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === 'string' ? value.trim() : '';
};

function realDate(value: string): ISTDate | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) || !parsed.toISOString().startsWith(value) ? null : istDate(value);
}

export async function parseQrExistingForm(form: FormData): Promise<QrExistingFormResult> {
  const base = await parseRegistrationForm(form);
  const fields: Record<string, string> = base.ok ? {} : { ...base.fields };

  const planText = text(form, 'declaredPlanMonths');
  const planNumber = /^\d+$/.test(planText) ? Number(planText) : NaN;
  const declaredPlanMonths = planText === '' ? null : (PLAN_DURATIONS as readonly number[]).includes(planNumber) ? (planNumber as PlanDurationMonths) : undefined;
  if (declaredPlanMonths === undefined) fields['declaredPlanMonths'] = 'declaredPlanMonths';

  const declaredEndDate = realDate(text(form, 'declaredEndDate'));
  if (declaredEndDate === null) fields['declaredEndDate'] = 'declaredEndDate';

  const amountText = text(form, 'declaredAmount');
  const rupees = /^\d+$/.test(amountText) ? Number(amountText) : NaN;
  const declaredAmountPaise = amountText === '' ? null : rupees <= MAX_RUPEES ? rupees * 100 : undefined;
  if (declaredAmountPaise === undefined || Number.isNaN(declaredAmountPaise)) fields['declaredAmount'] = 'declaredAmount';

  // Optional, and empty is a perfectly good answer: many members joined years ago and
  // will not remember the day.
  const joinedText = text(form, 'joinedOn');
  const joinedOn = joinedText === '' ? null : realDate(joinedText);
  if (joinedText !== '' && joinedOn === null) fields['joinedOn'] = 'joinedOn';

  const govIdTypeText = text(form, 'govIdType');
  let govId: { type: GovIdType; images: RawGovIdImage[] } | null = null;
  if (govIdTypeText !== '') {
    if (!isGovIdType(govIdTypeText)) {
      fields['govIdType'] = 'govIdType';
    } else {
      const images: RawGovIdImage[] = [];
      for (const side of govIdSidesFor(govIdTypeText)) {
        const part = form.get(`govId${side === 'FRONT' ? 'Front' : 'Back'}`);
        if (!(part instanceof File) || part.size === 0 || part.size > MAX_ID_BYTES) {
          fields['govId'] = 'govId';
          break;
        }
        images.push({ side, body: new Uint8Array(await part.arrayBuffer()) });
      }
      if (fields['govId'] === undefined) govId = { type: govIdTypeText, images };
    }
  }

  if (
    !base.ok ||
    Object.keys(fields).length > 0 ||
    declaredEndDate === null ||
    declaredPlanMonths === undefined ||
    declaredAmountPaise === undefined
  ) {
    return { ok: false, fields };
  }
  return { ok: true, fields: base.fields, selfie: base.selfie, declaredPlanMonths, declaredEndDate, declaredAmountPaise, joinedOn, govId };
}
