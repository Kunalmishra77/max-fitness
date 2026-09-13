import { describe, expect, it } from 'vitest';
import { istDate } from '@mfp/shared';
import { DomainError } from '../errors';
import { assessAge, registrationConsents } from './registration.rules';

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return error instanceof DomainError ? error.code : 'not a DomainError';
  }
  return undefined;
}

const today = istDate('2026-09-11');

describe('assessAge', () => {
  it('reports age in full years and flags a minor (BR-12.1, BR-12.2)', () => {
    expect(assessAge({ dob: istDate('2008-09-12'), today, minAge: 16 })).toEqual({ age: 17, isMinor: true });
  });

  it('is no longer a minor from the 18th birthday', () => {
    expect(assessAge({ dob: istDate('2008-09-11'), today, minAge: 16 })).toEqual({ age: 18, isMinor: false });
  });

  it('refuses anyone younger than the minimum age', () => {
    expect(codeOf(() => assessAge({ dob: istDate('2011-01-01'), today, minAge: 16 }))).toBe('UNDER_MINIMUM_AGE');
  });

  it('accepts someone exactly at the minimum age', () => {
    expect(assessAge({ dob: istDate('2010-09-11'), today, minAge: 16 })).toEqual({ age: 16, isMinor: true });
  });

  it('rejects a date of birth in the future', () => {
    expect(codeOf(() => assessAge({ dob: istDate('2026-09-12'), today, minAge: 16 }))).toBe('VALIDATION_FAILED');
  });

  it('rejects an age above 90 as a likely typo', () => {
    expect(codeOf(() => assessAge({ dob: istDate('1930-01-01'), today, minAge: 16 }))).toBe('VALIDATION_FAILED');
  });
});

describe('registrationConsents', () => {
  it('records every choice, granted or not', () => {
    const result = registrationConsents({
      consents: { terms: true, privacy: true, whatsappUpdates: false, faceAttendance: true },
      isMinor: false,
    });
    expect(result.rows).toEqual([
      { type: 'TERMS', granted: true },
      { type: 'PRIVACY', granted: true },
      { type: 'WHATSAPP_UPDATES', granted: false },
      { type: 'FACE_ATTENDANCE', granted: true },
    ]);
    expect(result.whatsappOptIn).toBe(false);
    expect(result.faceConsent).toBe(true);
  });

  it('forces face attendance off for a minor until a guardian consents at the desk (BR-12.2)', () => {
    const result = registrationConsents({
      consents: { terms: true, privacy: true, whatsappUpdates: true, faceAttendance: true },
      isMinor: true,
    });
    expect(result.faceConsent).toBe(false);
    expect(result.rows).toContainEqual({ type: 'FACE_ATTENDANCE', granted: false });
    expect(result.whatsappOptIn).toBe(true);
  });
});
