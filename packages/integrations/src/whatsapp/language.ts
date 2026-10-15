import type { Language } from '@mfp/shared';

/**
 * The language a template is actually sent in (owner, 2026-10-15).
 *
 * A member's record says Hindi or English and the domain asks for theirs, but Meta holds
 * a separate approved copy per language and refuses one it has not seen. A gym whose
 * default language is Hindi, running English-only templates, would therefore send its
 * members nothing at all — and nothing would look wrong, because the failure is a 4xx
 * from Meta rather than anything a member or the desk can see.
 *
 * So the set of approved languages is configuration, not an assumption in the code. The
 * day the Hindi templates are approved it is one environment variable, and every Hindi
 * member starts reading their own language again with no deploy of new logic.
 */
export function approvedLanguage(requested: Language, approved: readonly Language[]): Language {
  if (approved.length === 0) return requested;
  // The first is the fallback: it is the language the gym leads with, which is not
  // necessarily English.
  return approved.includes(requested) ? requested : (approved[0] as Language);
}
