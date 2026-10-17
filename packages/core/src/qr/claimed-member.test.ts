import { describe, expect, it } from 'vitest';
import { claimedMemberId } from './claimed-member';

/**
 * The record an existing-member submission is *about* — the one its face is allowed to
 * match. Everything else the face matches is a second record for one person (ADR-124).
 */
describe('claimedMemberId', () => {
  const ramesh = { id: 'm-ramesh', fullName: 'Ramesh Verma' };
  const madhu = { id: 'm-madhu', fullName: 'Madhu Padhi' };

  it('is the member on that number with that name', () => {
    expect(claimedMemberId({ fullName: 'Ramesh Verma' }, [ramesh, madhu])).toBe('m-ramesh');
  });

  it('ignores case and runs of spaces, as the register match does', () => {
    expect(claimedMemberId({ fullName: '  ramesh   VERMA ' }, [ramesh])).toBe('m-ramesh');
  });

  /**
   * The owner's own test: their name on a number the register has never seen. Nothing on
   * that number is theirs, so nothing is excused, and the face check has the whole
   * register to match them against.
   */
  it('is nobody when the number is new, even under a name the gym knows', () => {
    expect(claimedMemberId({ fullName: 'Ramesh Verma' }, [])).toBeUndefined();
  });

  /** The first hole: a new name on a number the gym already holds. */
  it('is nobody when the number is known under a different name', () => {
    expect(claimedMemberId({ fullName: 'Suresh Verma' }, [ramesh])).toBeUndefined();
  });

  it('is nobody on the new-member journey, which claims no record at all', () => {
    expect(claimedMemberId(undefined, [ramesh])).toBeUndefined();
  });

  /** Two members may share a name (the owner said so); the older record speaks first. */
  it('takes the oldest of two records sharing the name', () => {
    const older = { id: 'm-old', fullName: 'Ramesh Verma' };
    const newer = { id: 'm-new', fullName: 'Ramesh Verma' };
    expect(claimedMemberId({ fullName: 'Ramesh Verma' }, [older, newer])).toBe('m-old');
  });
});
