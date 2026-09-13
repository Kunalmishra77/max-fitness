import { describe, expect, it } from 'vitest';
import { RegistrationFieldsSchema } from './registration';

const valid = {
  fullName: '  Priya Sharma ',
  mobile: '098765 43210',
  email: ' Priya@Example.COM ',
  dob: '1998-04-12',
  gender: 'FEMALE',
  language: 'hi',
  consents: { terms: true, privacy: true, whatsappUpdates: true, faceAttendance: false },
  noticeVersion: '1.0',
};

/** Validation codes for an input, or `[]` when it parses. */
function codes(input: unknown): string[] {
  const result = RegistrationFieldsSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => issue.message);
}

describe('RegistrationFieldsSchema', () => {
  it('normalises a valid registration', () => {
    const parsed = RegistrationFieldsSchema.parse(valid);
    expect(parsed.fullName).toBe('Priya Sharma');
    expect(parsed.mobile).toBe('+919876543210');
    expect(parsed.email).toBe('priya@example.com');
    expect(parsed.dob).toBe('1998-04-12');
  });

  it('accepts a name written in Devanagari', () => {
    expect(codes({ ...valid, fullName: 'प्रिया शर्मा' })).toEqual([]);
  });

  it('rejects a name with digits or a single letter', () => {
    expect(codes({ ...valid, fullName: 'Priya 2' })).toEqual(['fullName']);
    expect(codes({ ...valid, fullName: 'P' })).toEqual(['fullName']);
  });

  it('treats email as optional, whether omitted or left blank', () => {
    const { email: _email, ...withoutEmail } = valid;
    expect(RegistrationFieldsSchema.parse(withoutEmail).email).toBeUndefined();
    expect(RegistrationFieldsSchema.parse({ ...valid, email: '  ' }).email).toBeUndefined();
  });

  it('rejects an invalid email', () => {
    expect(codes({ ...valid, email: 'priya@' })).toEqual(['email']);
  });

  it('rejects an invalid mobile number', () => {
    expect(codes({ ...valid, mobile: '12345' })).toEqual(['mobile']);
  });

  it('rejects a date that does not exist', () => {
    expect(codes({ ...valid, dob: '2001-02-30' })).toEqual(['dob']);
  });

  it('rejects an unknown gender', () => {
    expect(codes({ ...valid, gender: 'X' })).toEqual(['gender']);
  });

  it('requires agreement to the terms and the privacy policy', () => {
    expect(codes({ ...valid, consents: { ...valid.consents, terms: false } })).toEqual(['terms']);
    expect(codes({ ...valid, consents: { ...valid.consents, privacy: false } })).toEqual(['privacy']);
  });

  it('defaults face attendance to off', () => {
    const { faceAttendance: _face, ...consents } = valid.consents;
    expect(RegistrationFieldsSchema.parse({ ...valid, consents }).consents.faceAttendance).toBe(false);
  });

  it('rejects fields it does not know', () => {
    expect(RegistrationFieldsSchema.safeParse({ ...valid, status: 'ACTIVE' }).success).toBe(false);
  });
});
