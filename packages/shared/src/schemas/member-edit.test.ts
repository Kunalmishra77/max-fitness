import { describe, expect, it } from 'vitest';
import { MemberEditSchema } from './member-edit';

/**
 * The desk's correction form (crm-ux-blueprint §5).
 *
 * Same schema in the browser and in the server action (CLAUDE.md §2.3). It is the
 * registration rules minus the consents — those were given once and are not re-taken when
 * a spelling is fixed — and plus the training slot, which is a thing members change.
 */

const good = {
  fullName: 'सुरेश यादव',
  mobile: '9876543210',
  email: '',
  dob: '1995-05-05',
  gender: 'MALE',
  language: 'hi',
  trainingSlot: 'MORNING',
};

describe('MemberEditSchema', () => {
  it('normalises the number to E.164 and an empty email to null', () => {
    const parsed = MemberEditSchema.parse(good);
    expect(parsed.mobile).toBe('+919876543210');
    expect(parsed.email).toBeNull();
  });

  it('accepts a member whose date of birth and slot were never recorded', () => {
    // The register import and older rows have neither (ADR-086).
    const parsed = MemberEditSchema.parse({ ...good, dob: '', trainingSlot: '' });
    expect(parsed.dob).toBeNull();
    expect(parsed.trainingSlot).toBeNull();
  });

  it('refuses a short name, a bad number, a bad email and a date that is not a date', () => {
    const codes = (patch: Record<string, unknown>) => {
      const result = MemberEditSchema.safeParse({ ...good, ...patch });
      return result.success ? [] : result.error.issues.map((issue) => issue.message);
    };
    expect(codes({ fullName: 'अ' })).toContain('fullName');
    expect(codes({ mobile: '12345' })).toContain('mobile');
    expect(codes({ email: 'not-an-email' })).toContain('email');
    expect(codes({ dob: '2026-02-30' })).toContain('dob');
    expect(codes({ gender: 'SOMETHING' })).toContain('gender');
    expect(codes({ trainingSlot: 'NIGHT' })).toContain('trainingSlot');
  });

  it('lowercases and trims an email that was typed with capitals and a space', () => {
    expect(MemberEditSchema.parse({ ...good, email: ' Suresh@Example.COM ' }).email).toBe('suresh@example.com');
  });
});
