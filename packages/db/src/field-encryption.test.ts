import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decryptVector, encryptVector, keyFromEnv } from './field-encryption';

/**
 * Face templates at rest (privacy plan §4; attendance spec §11).
 *
 * A face template is the most personal thing this system stores. It cannot be changed like
 * a password, and a member cannot be issued a new face — so a database copy that leaks must
 * not hand anybody a working gallery.
 *
 * AES-256-GCM, because the vector must come back **exactly** as it went in: a single
 * flipped bit in a 128-float embedding moves the member in vector space, and the failure
 * would be a member who silently stops being recognised. GCM's tag makes that loud.
 */

const key = keyFromEnv(randomBytes(32).toString('base64'));
const vector = Array.from({ length: 128 }, (_, i) => Math.sin(i) / 11.3137);

describe('encryptVector / decryptVector', () => {
  it('gives back the same numbers it was given', () => {
    const back = decryptVector(encryptVector(vector, key), key);

    expect(back).toHaveLength(128);
    // Float32 on the way through, so the comparison is to that precision and not to
    // JavaScript's double. Storing float64 would double the size of every template for
    // precision the engine never had.
    for (const [i, value] of vector.entries()) expect(back[i]).toBeCloseTo(value, 6);
  });

  it('encrypts the same vector differently every time', () => {
    // A fresh nonce per template. Reusing one under the same key is the mistake that breaks
    // GCM completely, and identical ciphertext would also reveal which members share a face.
    const a = encryptVector(vector, key);
    const b = encryptVector(vector, key);

    expect(Buffer.compare(a, b)).not.toBe(0);
  });

  it('refuses a vector that has been tampered with rather than returning wrong numbers', () => {
    const sealed = encryptVector(vector, key);
    sealed[40] = sealed[40]! ^ 0xff;

    expect(() => decryptVector(sealed, key)).toThrow(/could not be decrypted/i);
  });

  it('refuses the wrong key', () => {
    const sealed = encryptVector(vector, keyFromEnv(randomBytes(32).toString('base64')));

    expect(() => decryptVector(sealed, key)).toThrow(/could not be decrypted/i);
  });

  it('refuses a truncated record instead of reading past the end of it', () => {
    expect(() => decryptVector(encryptVector(vector, key).subarray(0, 8), key)).toThrow(/too short/i);
  });

  it('carries a version byte, so the scheme can be changed without losing what is stored', () => {
    expect(encryptVector(vector, key)[0]).toBe(1);
  });

  it('refuses to read a version it does not know', () => {
    const sealed = encryptVector(vector, key);
    sealed[0] = 9;

    expect(() => decryptVector(sealed, key)).toThrow(/version/i);
  });
});

describe('keyFromEnv', () => {
  it('accepts a 32-byte base64 key', () => {
    expect(keyFromEnv(randomBytes(32).toString('base64'))).toHaveLength(32);
  });

  it('accepts a 64-character hex key, because that is what most people paste', () => {
    expect(keyFromEnv(randomBytes(32).toString('hex'))).toHaveLength(32);
  });

  it('refuses a key that is not 32 bytes, rather than padding it into something weaker', () => {
    expect(() => keyFromEnv('too-short')).toThrow(/32 bytes/i);
    expect(() => keyFromEnv('')).toThrow(/32 bytes/i);
  });
});
