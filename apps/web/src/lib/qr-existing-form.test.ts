import { describe, expect, it } from 'vitest';
import { parseQrExistingForm } from './qr-existing-form';

/**
 * Reading `POST /qr/existing` (api-specification.md; qr-onboarding-flow §3; ADR-058).
 *
 * The registration parts go through the same parser as sign-up; the declared parts —
 * plan, month-end date, amount — are read here, each problem named by its field.
 */

function form(overrides: Record<string, string | null> = {}) {
  const values: Record<string, string | null> = {
    fullName: 'Sanjay Tomar',
    mobile: '9876543210',
    dob: '1984-02-14',
    gender: 'MALE',
    language: 'hi',
    noticeVersion: '1.0',
    consents: JSON.stringify({ terms: true, privacy: true, whatsappUpdates: false, faceAttendance: false }),
    declaredPlanMonths: '3',
    declaredEndDate: '2026-09-30',
    declaredAmount: '4000',
    ...overrides,
  };
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) if (value !== null) data.set(key, value);
  data.set('selfie', new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' }), 'selfie.jpg');
  return data;
}

describe('parseQrExistingForm', () => {
  it('reads the details, the photo and what the member declared', async () => {
    const result = await parseQrExistingForm(form());

    expect(result).toMatchObject({
      ok: true,
      fields: { fullName: 'Sanjay Tomar', mobile: '+919876543210' },
      declaredPlanMonths: 3,
      declaredEndDate: '2026-09-30',
      declaredAmountPaise: 400_000,
    });
    if (result.ok) expect(result.selfie.byteLength).toBe(4);
  });

  it('treats an unsure plan and a blank amount as unknown', async () => {
    const result = await parseQrExistingForm(form({ declaredPlanMonths: '', declaredAmount: '' }));
    expect(result).toMatchObject({ ok: true, declaredPlanMonths: null, declaredAmountPaise: null });
    expect(await parseQrExistingForm(form({ declaredPlanMonths: null, declaredAmount: null }))).toMatchObject({ ok: true, declaredPlanMonths: null });
  });

  it('names each declared field that is wrong, alongside any detail that is wrong', async () => {
    expect(await parseQrExistingForm(form({ declaredEndDate: null }))).toEqual({ ok: false, fields: { declaredEndDate: 'declaredEndDate' } });
    expect(await parseQrExistingForm(form({ declaredEndDate: '2026-02-30' }))).toEqual({ ok: false, fields: { declaredEndDate: 'declaredEndDate' } });
    expect(await parseQrExistingForm(form({ declaredEndDate: '30-09-2026' }))).toEqual({ ok: false, fields: { declaredEndDate: 'declaredEndDate' } });
    expect(await parseQrExistingForm(form({ declaredPlanMonths: '2' }))).toEqual({ ok: false, fields: { declaredPlanMonths: 'declaredPlanMonths' } });
    expect(await parseQrExistingForm(form({ declaredAmount: '12.5' }))).toEqual({ ok: false, fields: { declaredAmount: 'declaredAmount' } });

    const both = await parseQrExistingForm(form({ mobile: '123', declaredAmount: '-5' }));
    expect(both.ok).toBe(false);
    if (!both.ok) expect(Object.keys(both.fields).sort()).toEqual(['declaredAmount', 'mobile']);
  });
});
