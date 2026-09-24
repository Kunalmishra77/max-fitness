import { describe, expect, it } from 'vitest';
import { GOV_ID_TYPES, govIdSidesFor, isGovIdType, validateGovId, type GovIdImage } from './gov-id';

/**
 * The photographs of a member's government ID (client decision, ADR-074).
 *
 * The gym keeps the *pictures* and never the number — an Aadhaar number in a gym's
 * database is a liability nobody needs, and the desk only ever has to see that the
 * card matches the person. So the rules here are about how many sides a card has, not
 * about what is printed on it.
 */

const image = (side: 'FRONT' | 'BACK'): GovIdImage => ({ side, body: new Uint8Array([1, 2, 3]), width: 800, height: 500 });

describe('govIdSidesFor', () => {
  it('asks for both sides of an Aadhaar, because the address is on the back', () => {
    expect(govIdSidesFor('AADHAAR')).toEqual(['FRONT', 'BACK']);
  });

  it('asks for one side of a PAN card, which has nothing on the back', () => {
    expect(govIdSidesFor('PAN')).toEqual(['FRONT']);
  });

  it('asks for both sides of a driving licence and a voter card', () => {
    expect(govIdSidesFor('DL')).toEqual(['FRONT', 'BACK']);
    expect(govIdSidesFor('VOTER')).toEqual(['FRONT', 'BACK']);
  });

  it('covers every type it offers, so a new one cannot be added and forgotten', () => {
    for (const type of GOV_ID_TYPES) expect(govIdSidesFor(type).length).toBeGreaterThan(0);
  });
});

describe('isGovIdType', () => {
  it('accepts the types the gym offers and nothing else', () => {
    expect(isGovIdType('AADHAAR')).toBe(true);
    expect(isGovIdType('PASSPORT')).toBe(false);
    expect(isGovIdType('')).toBe(false);
    expect(isGovIdType(null)).toBe(false);
  });
});

describe('validateGovId', () => {
  it('accepts an Aadhaar with both sides', () => {
    expect(validateGovId('AADHAAR', [image('FRONT'), image('BACK')])).toEqual({ ok: true });
  });

  it('refuses an Aadhaar missing its back', () => {
    expect(validateGovId('AADHAAR', [image('FRONT')])).toEqual({ ok: false, reason: 'MISSING_SIDE' });
  });

  it('refuses a PAN card sent with a back that does not exist', () => {
    expect(validateGovId('PAN', [image('FRONT'), image('BACK')])).toEqual({ ok: false, reason: 'UNEXPECTED_SIDE' });
  });

  it('refuses the same side sent twice instead of both sides', () => {
    expect(validateGovId('AADHAAR', [image('FRONT'), image('FRONT')])).toEqual({ ok: false, reason: 'MISSING_SIDE' });
  });

  it('refuses no photographs at all', () => {
    expect(validateGovId('PAN', [])).toEqual({ ok: false, reason: 'MISSING_SIDE' });
  });

  it('refuses a picture too small to read a card from', () => {
    const tiny = { ...image('FRONT'), width: 120, height: 80 };

    expect(validateGovId('PAN', [tiny])).toEqual({ ok: false, reason: 'TOO_SMALL' });
  });

  it('refuses an empty file, which is what a failed camera sends', () => {
    const empty = { ...image('FRONT'), body: new Uint8Array() };

    expect(validateGovId('PAN', [empty])).toEqual({ ok: false, reason: 'EMPTY' });
  });

  it('does not care what order the sides arrive in', () => {
    expect(validateGovId('AADHAAR', [image('BACK'), image('FRONT')])).toEqual({ ok: true });
  });
});
