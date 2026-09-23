import { describe, expect, it } from 'vitest';
import { frameIsUsable, type FaceQuality } from './face-engine';

/**
 * The cheap checks that run before a frame is worth embedding (attendance spec §6).
 *
 * The liveness rule is the one with a trap in it: an engine that has no liveness check
 * returns null, and treating null as "failed" would refuse every member at the desk.
 */

const settings = { livenessThreshold: 0.5 };
const good: FaceQuality = { ok: true, reason: null };

describe('frameIsUsable', () => {
  it('lets a good, live face through', () => {
    expect(frameIsUsable(good, 0.9, settings)).toEqual({ usable: true, reason: null });
  });

  it('carries the quality reason through, so the screen can say what to fix', () => {
    expect(frameIsUsable({ ok: false, reason: 'TOO_DARK' }, 0.9, settings)).toEqual({ usable: false, reason: 'TOO_DARK' });
  });

  it('refuses what looks like a photograph of a member', () => {
    expect(frameIsUsable(good, 0.2, settings)).toEqual({ usable: false, reason: 'NOT_LIVE' });
  });

  it('lets a face through when the engine has no liveness check at all', () => {
    // Null is "cannot tell", not "failed". Treating it as failed would refuse
    // everybody on an engine without anti-spoofing.
    expect(frameIsUsable(good, null, settings)).toEqual({ usable: true, reason: null });
  });

  it('treats the threshold itself as live', () => {
    expect(frameIsUsable(good, 0.5, settings)).toMatchObject({ usable: true });
  });

  it('checks quality before liveness, so the member is told the useful thing', () => {
    // A face that is both too far away and unconvincing should be told to come closer,
    // not accused of holding up a photograph.
    expect(frameIsUsable({ ok: false, reason: 'TOO_SMALL' }, 0.1, settings)).toEqual({ usable: false, reason: 'TOO_SMALL' });
  });
});
