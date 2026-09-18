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
    }
  | { readonly ok: false; readonly fields: Record<string, string> };

const MAX_RUPEES = 1_000_000;

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

  if (!base.ok || Object.keys(fields).length > 0 || declaredEndDate === null || declaredPlanMonths === undefined || declaredAmountPaise === undefined) {
    return { ok: false, fields };
  }
  return { ok: true, fields: base.fields, selfie: base.selfie, declaredPlanMonths, declaredEndDate, declaredAmountPaise };
}
