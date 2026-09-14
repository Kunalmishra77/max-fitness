import { describe, expect, it } from 'vitest';
import { StaffCreateSchema, StaffPinSchema } from './staff';

/**
 * Adding a staff member (crm-ux-blueprint §14; security-plan §3.1).
 *
 * The same schema checks the form in the browser and the server action, and each
 * message is a field code the screen looks up, so both languages stay in the catalogues.
 */

const valid = { name: '  रीना शर्मा ', mobile: '98765 43210', role: 'RECEPTION', pin: '4826' };

/** Validation codes for an input, or `[]` when it parses. */
function codes(input: unknown): string[] {
  const result = StaffCreateSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => issue.message);
}

describe('StaffCreateSchema', () => {
  it('normalises a valid staff member', () => {
    expect(StaffCreateSchema.parse(valid)).toEqual({ name: 'रीना शर्मा', mobile: '+919876543210', role: 'RECEPTION', pin: '4826' });
  });

  it('allows reception and trainers only: an owner is not made from a form', () => {
    expect(codes({ ...valid, role: 'TRAINER' })).toEqual([]);
    expect(codes({ ...valid, role: 'OWNER' })).toEqual(['role']);
    expect(codes({ ...valid, role: 'SUPER_ADMIN' })).toEqual(['role']);
  });

  it('refuses a name with digits, a mobile that is not Indian, and a PIN that is not four to six digits', () => {
    expect(codes({ ...valid, name: 'Reena 2' })).toEqual(['name']);
    expect(codes({ ...valid, mobile: '12345' })).toEqual(['mobile']);
    expect(codes({ ...valid, pin: '12' })).toEqual(['pin']);
    expect(codes({ ...valid, pin: '1234567' })).toEqual(['pin']);
    expect(codes({ ...valid, pin: '12a4' })).toEqual(['pin']);
  });
});

describe('StaffPinSchema', () => {
  it('accepts four to six digits and nothing else', () => {
    expect(StaffPinSchema.safeParse('7391').success).toBe(true);
    expect(StaffPinSchema.safeParse('739104').success).toBe(true);
    expect(StaffPinSchema.safeParse('73a1').success).toBe(false);
    expect(StaffPinSchema.safeParse(' 7391').success).toBe(false);
  });
});
