import { describe, expect, it } from 'vitest';
import { cosineSimilarity, decideFromFrames, matchFace, type FaceTemplateRow, type MatchSettings } from './matcher';

/**
 * Who the camera is looking at (attendance spec §6).
 *
 * Two mistakes matter and they are not symmetrical. Greeting the wrong member marks
 * the wrong attendance and embarrasses everyone; failing to recognise somebody costs
 * them a tap on the keypad. So the rules here are deliberately timid: a match has to
 * be good *and* clearly better than the runner-up, and it has to happen on several
 * frames in a row before anything is written down.
 */

const SETTINGS: MatchSettings = { acceptThreshold: 0.72, confirmBand: 0.08, matchMargin: 0.06, framesToAgree: 3 };

/** A unit vector pointing mostly along `axis`, nudged by `noise` towards the next axis. */
function vector(axis: number, noise = 0): number[] {
  const v = new Array<number>(8).fill(0);
  v[axis] = 1;
  v[(axis + 1) % 8] = noise;
  const length = Math.hypot(...v);
  return v.map((x) => x / length);
}

const template = (id: string, memberId: string, vec: number[]): FaceTemplateRow => ({ id, memberId, vector: vec });

describe('cosineSimilarity', () => {
  it('is 1 for the same direction and 0 for a right angle', () => {
    expect(cosineSimilarity(vector(0), vector(0))).toBeCloseTo(1, 6);
    expect(cosineSimilarity(vector(0), vector(3))).toBeCloseTo(0, 6);
  });

  it('refuses to compare vectors of different lengths', () => {
    expect(cosineSimilarity([1, 0], [1, 0, 0])).toBeNull();
  });

  it('is null for a zero vector rather than pretending it matched', () => {
    expect(cosineSimilarity([0, 0, 0], vector(0).slice(0, 3))).toBeNull();
  });
});

describe('matchFace', () => {
  const gallery = [template('t1', 'mem_a', vector(0)), template('t2', 'mem_b', vector(3)), template('t3', 'mem_c', vector(5))];

  it('greets a clear match', () => {
    const result = matchFace(vector(0), gallery, SETTINGS);

    expect(result).toMatchObject({ decision: 'ACCEPT', memberId: 'mem_a' });
    expect(result.score).toBeCloseTo(1, 4);
  });

  it('asks rather than greets when the match is only nearly good enough', () => {
    // 0.70 sits below the 0.72 threshold but inside the 0.08 confirm band.
    const near = [template('t1', 'mem_a', vector(0))];
    const probe = [0.7, Math.sqrt(1 - 0.49), 0, 0, 0, 0, 0, 0];

    expect(matchFace(probe, near, SETTINGS)).toMatchObject({ decision: 'CONFIRM', memberId: 'mem_a' });
  });

  it('gives up rather than guessing when nothing is close', () => {
    expect(matchFace(vector(7), [template('t1', 'mem_a', vector(0))], SETTINGS)).toMatchObject({ decision: 'UNKNOWN', memberId: null });
  });

  it('refuses to choose between two people who look alike', () => {
    // Two members whose templates are nearly the same direction: both score high, and
    // the gap between them is under the margin. Marking either would be a guess.
    const twins = [template('t1', 'mem_a', vector(0)), template('t2', 'mem_b', vector(0, 0.02))];

    const result = matchFace(vector(0), twins, SETTINGS);

    expect(result.decision).toBe('CONFIRM');
    expect(result.runnerUpScore).toBeGreaterThan(0);
  });

  it('takes a member’s best template, not their average', () => {
    // Someone with an old bad template and a good recent one is recognised by the good one.
    const both = [template('t1', 'mem_a', vector(4)), template('t2', 'mem_a', vector(0))];

    expect(matchFace(vector(0), both, SETTINGS)).toMatchObject({ decision: 'ACCEPT', memberId: 'mem_a' });
  });

  it('says UNKNOWN for an empty gallery instead of throwing', () => {
    expect(matchFace(vector(0), [], SETTINGS)).toMatchObject({ decision: 'UNKNOWN', memberId: null, score: 0 });
  });

  it('ignores a template of the wrong size rather than crashing on it', () => {
    // A template from an older model version has different dimensions.
    const mixed = [template('old', 'mem_x', [1, 0, 0]), template('t1', 'mem_a', vector(0))];

    expect(matchFace(vector(0), mixed, SETTINGS)).toMatchObject({ decision: 'ACCEPT', memberId: 'mem_a' });
  });
});

describe('decideFromFrames', () => {
  const accept = (memberId: string) => ({ decision: 'ACCEPT' as const, memberId, score: 0.9, runnerUpScore: 0.1 });
  const unknown = { decision: 'UNKNOWN' as const, memberId: null, score: 0.2, runnerUpScore: 0 };

  it('waits for the frames to agree before deciding anything', () => {
    expect(decideFromFrames([accept('mem_a'), accept('mem_a')], SETTINGS)).toBeNull();
    expect(decideFromFrames([accept('mem_a'), accept('mem_a'), accept('mem_a')], SETTINGS)).toMatchObject({ decision: 'ACCEPT', memberId: 'mem_a' });
  });

  it('is not fooled by someone walking past behind the member', () => {
    // Three frames of mem_a and two of mem_b: mem_a still wins, mem_b never reaches three.
    const frames = [accept('mem_a'), accept('mem_b'), accept('mem_a'), accept('mem_b'), accept('mem_a')];

    expect(decideFromFrames(frames, SETTINGS)).toMatchObject({ decision: 'ACCEPT', memberId: 'mem_a' });
  });

  it('decides nothing while the camera keeps seeing a stranger', () => {
    expect(decideFromFrames([unknown, unknown, unknown, unknown], SETTINGS)).toBeNull();
  });

  it('counts only the frames that agreed on one person', () => {
    expect(decideFromFrames([accept('mem_a'), accept('mem_b'), accept('mem_c')], SETTINGS)).toBeNull();
  });

  it('carries the confirm decision through when that is what the frames agreed on', () => {
    const confirm = { decision: 'CONFIRM' as const, memberId: 'mem_a', score: 0.7, runnerUpScore: 0.1 };

    expect(decideFromFrames([confirm, confirm, confirm], SETTINGS)).toMatchObject({ decision: 'CONFIRM', memberId: 'mem_a' });
  });

  it('will not turn three uncertain looks into a confident greeting', () => {
    const confirm = { decision: 'CONFIRM' as const, memberId: 'mem_a', score: 0.7, runnerUpScore: 0.1 };
    const frames = [confirm, accept('mem_a'), confirm];

    // Two of the three were only "probably"; the member confirms rather than being greeted.
    expect(decideFromFrames(frames, SETTINGS)).toMatchObject({ decision: 'CONFIRM' });
  });
});
