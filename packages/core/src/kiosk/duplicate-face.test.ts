import { describe, expect, it } from 'vitest';
import type { FaceTemplateRow } from './matcher';
import { findDuplicateFace } from './duplicate-face';

/**
 * Catching the same person signing up twice (owner, 2026-10-15).
 *
 * The owner registered under one name on one number and a different name on another,
 * with their own face both times, and the gym took both. Nothing matched: the names
 * differ, the numbers differ, and the only thing that did not change was the face.
 *
 * This is deliberately harder to satisfy than the check-in matcher. Greeting the wrong
 * member at the door costs one tap; telling somebody who really is new that they have
 * already joined, at a desk with a queue behind them, costs the gym the member.
 */

let nextId = 0;
const template = (memberId: string, vector: readonly number[]): FaceTemplateRow => ({ id: `tmpl_${(nextId += 1)}`, memberId, vector });

/** Unit vectors, so cosine similarity is easy to reason about. */
const RAVI = [1, 0, 0];
const ALMOST_RAVI = [0.98, 0.2, 0];
const SOMEBODY_ELSE = [0, 1, 0];

describe('findDuplicateFace', () => {
  const settings = { duplicateThreshold: 0.75 };

  it('names the member whose face this already is', () => {
    const gallery = [template('mem_ravi', RAVI), template('mem_other', SOMEBODY_ELSE)];

    expect(findDuplicateFace(ALMOST_RAVI, gallery, settings)).toMatchObject({ memberId: 'mem_ravi' });
  });

  it('says nothing about a face the gym has never seen', () => {
    expect(findDuplicateFace(SOMEBODY_ELSE, [template('mem_ravi', RAVI)], settings)).toBeNull();
  });

  /**
   * The member re-registering is the normal case at the reception QR — they are supposed
   * to be already enrolled. Only somebody else's record is a duplicate.
   */
  it('ignores the member this submission is already about', () => {
    const gallery = [template('mem_ravi', RAVI)];

    expect(findDuplicateFace(ALMOST_RAVI, gallery, { ...settings, exceptMemberId: 'mem_ravi' })).toBeNull();
  });

  it('holds its nerve below the threshold rather than accusing somebody', () => {
    // 0.6 is where two different members can land; the check-in matcher would accept it.
    const marginal = [0.6, 0.8, 0];

    expect(findDuplicateFace(marginal, [template('mem_ravi', RAVI)], settings)).toBeNull();
  });

  it('has nothing to say when nobody is enrolled', () => {
    expect(findDuplicateFace(RAVI, [], settings)).toBeNull();
  });

  it('picks the closest face when several are above the line', () => {
    const gallery = [template('mem_near', [0.9, 0.4, 0]), template('mem_nearer', RAVI)];

    expect(findDuplicateFace(RAVI, gallery, settings)).toMatchObject({ memberId: 'mem_nearer' });
  });
});
