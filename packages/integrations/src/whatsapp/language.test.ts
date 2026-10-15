import { describe, expect, it } from 'vitest';
import { approvedLanguage } from './language';

/**
 * Which language a template is actually sent in (owner, 2026-10-15).
 *
 * A member's record says Hindi or English, and the domain asks for theirs. Meta holds a
 * separate copy of each template per language, and refuses a send in a language it has
 * not approved — so a Hindi member, in a gym whose default language is Hindi, silently
 * gets nothing until the Hindi template exists.
 *
 * The owner decided to run English-only for now. This is where that decision lives, so
 * the day Hindi is approved it is one setting rather than a code change.
 */

describe('approvedLanguage', () => {
  it('sends in the member’s own language when that language is approved', () => {
    expect(approvedLanguage('hi', ['en', 'hi'])).toBe('hi');
    expect(approvedLanguage('en', ['en', 'hi'])).toBe('en');
  });

  it('falls back rather than asking Meta for a template that does not exist', () => {
    expect(approvedLanguage('hi', ['en'])).toBe('en');
  });

  /** The first listed language is the fallback: it is the one the gym leads with. */
  it('falls back to the first approved language, not to English by assumption', () => {
    expect(approvedLanguage('en', ['hi'])).toBe('hi');
  });

  /**
   * Misconfiguration must not turn every message into a guess. An empty list means
   * nobody said anything, so the member's own language is the honest choice — and the
   * send will fail loudly at Meta rather than quietly in the wrong language.
   */
  it('keeps the member’s language when nothing is configured', () => {
    expect(approvedLanguage('hi', [])).toBe('hi');
  });
});
