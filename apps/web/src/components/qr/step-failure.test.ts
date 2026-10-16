import { describe, expect, it } from 'vitest';
import en from '../../../messages/en.json';
import hi from '../../../messages/hi.json';
import { stepFailure } from './step-failure';

/**
 * MEM-003 / MEM-004.
 *
 * The bug was not a wrong message, it was a **missing** one: the forms asked for
 * `stepCheck.NAME_MISMATCH` and keys like it, which were never written, so next-intl had
 * nothing to render and the member read the key path off the screen.
 *
 * So the assertion that matters is not "this reason maps to that key" — it is "every
 * reason the endpoint can return maps to a key that exists, in both languages". That is
 * checked against the real message files, so adding a reason without its wording fails
 * here rather than at a reception desk.
 */

/**
 * Every `reason` `/api/v1/qr/check` can answer with.
 *
 * - the photograph gate and the image processor (`selfie-reasons.ts`, `selfie-image.ts`)
 * - the card reader (`GovIdTextProblem`)
 * - the two about the member themselves
 */
const EVERY_REASON = [
  'NO_FACE', 'NOT_A_FACE', 'NOT_AN_IMAGE', 'TOO_FAR', 'TOO_DARK', 'TOO_BRIGHT', 'BLURRED', 'ANOTHER_FACE',
  'unsupported_type', 'unreadable', 'too_large', 'too_small',
  'UNREADABLE', 'NOT_AN_ID', 'WRONG_TYPE', 'NAME_MISMATCH', 'DOB_MISMATCH',
  'MOBILE_IN_USE', 'DOB_IN_USE',
] as const;

/** Walk a dotted key through a namespace. */
function lookup(tree: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((node, part) => (node === undefined || node === null ? undefined : (node as Record<string, unknown>)[part]), tree);
}

describe('stepFailure — every reason has wording', () => {
  const namespaces = [
    ['en', en.qrExisting as unknown as Record<string, unknown>],
    ['hi', hi.qrExisting as unknown as Record<string, unknown>],
  ] as const;

  for (const [language, namespace] of namespaces) {
    it.each(EVERY_REASON)(`${language}: %s resolves to a message that exists`, (reason) => {
      const { key } = stepFailure(reason);
      const message = lookup(namespace, key);

      expect(typeof message, `${language} qrExisting.${key} is missing`).toBe('string');
      expect(String(message).trim()).not.toBe('');
    });
  }
});

describe('stepFailure — where the message goes', () => {
  it('puts a refused photograph beside the photograph', () => {
    // So the member can retake it on the step still holding it, rather than reading a
    // banner above a form they have already left.
    expect(stepFailure('TOO_DARK')).toEqual({ field: 'selfie', key: 'errors.selfieTooDark' });
    expect(stepFailure('NO_FACE').field).toBe('selfie');
    expect(stepFailure('too_large').field).toBe('selfie');
  });

  it('puts a refused card beside the card', () => {
    expect(stepFailure('NAME_MISMATCH')).toEqual({ field: 'govId', key: 'govIdReasons.NAME_MISMATCH' });
    expect(stepFailure('WRONG_TYPE').field).toBe('govId');
  });

  it('keeps a refusal about the member at page level', () => {
    // Not fixed by retaking anything, so there is no field to sit beside.
    expect(stepFailure('MOBILE_IN_USE')).toEqual({ field: null, key: 'stepCheck.MOBILE_IN_USE' });
  });

  it('tells the card reader apart from the image processor on a shared word', () => {
    // `UNREADABLE` is the card; `unreadable` is a file that is not a photograph.
    expect(stepFailure('UNREADABLE').field).toBe('govId');
    expect(stepFailure('unreadable').field).toBe('selfie');
  });

  it('falls back to a page-level key for a reason it has never heard of', () => {
    // A new server reason must not crash the form; it shows the generic path instead.
    expect(stepFailure('SOMETHING_NEW')).toEqual({ field: null, key: 'stepCheck.SOMETHING_NEW' });
  });
});
