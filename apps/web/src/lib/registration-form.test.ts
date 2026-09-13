// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parseRegistrationForm } from './registration-form';

const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

function form(overrides: Record<string, string | Blob | null> = {}): FormData {
  const values: Record<string, string | Blob | null> = {
    fullName: 'Priya Sharma',
    mobile: '98765 43210',
    email: '',
    dob: '1998-04-12',
    gender: 'FEMALE',
    language: 'hi',
    consents: JSON.stringify({ terms: true, privacy: true, whatsappUpdates: true, faceAttendance: false }),
    noticeVersion: '1.0',
    selfie: new Blob([jpegBytes], { type: 'image/jpeg' }),
    ...overrides,
  };
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) {
    if (value !== null) data.append(key, value);
  }
  return data;
}

describe('parseRegistrationForm', () => {
  it('validates the fields with the shared schema and returns the selfie bytes', async () => {
    const result = await parseRegistrationForm(form());

    expect(result).toEqual({
      ok: true,
      fields: {
        fullName: 'Priya Sharma',
        mobile: '+919876543210',
        dob: '1998-04-12',
        gender: 'FEMALE',
        language: 'hi',
        consents: { terms: true, privacy: true, whatsappUpdates: true, faceAttendance: false },
        noticeVersion: '1.0',
      },
      selfie: jpegBytes,
    });
  });

  it('reports each invalid field by its message code', async () => {
    const result = await parseRegistrationForm(
      form({ mobile: '12345', dob: '2026-02-30', consents: JSON.stringify({ terms: false, privacy: true }) }),
    );
    expect(result).toEqual({ ok: false, fields: { mobile: 'mobile', dob: 'dob', terms: 'terms' } });
  });

  it('requires a selfie file part', async () => {
    expect(await parseRegistrationForm(form({ selfie: null }))).toMatchObject({ ok: false, fields: { selfie: 'selfie' } });
    expect(await parseRegistrationForm(form({ selfie: 'not-a-file' }))).toMatchObject({ ok: false, fields: { selfie: 'selfie' } });
  });

  it('treats consents that are not JSON as not given', async () => {
    expect(await parseRegistrationForm(form({ consents: '{oops' }))).toMatchObject({ ok: false, fields: { terms: 'terms', privacy: 'privacy' } });
  });

  it('ignores parts it does not expect, such as an amount or a status', async () => {
    const result = await parseRegistrationForm(form({ status: 'ACTIVE', amountPaise: '1' }));
    expect(result.ok).toBe(true);
  });
});
