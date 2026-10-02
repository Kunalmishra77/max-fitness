// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { LANGUAGES, MEMBER_GENDERS, REMINDER_RULE_CODES, TRAINING_SLOTS } from '@mfp/shared';
import en from '../../messages/en.json';
import hi from '../../messages/hi.json';

/**
 * Every code the application can put on a screen has words for it, in both languages.
 *
 * This exists because of a class of bug that nothing else here catches. A screen looks up
 * `crm.settings.ruleNames.<code>`; a new code is added to the domain; the catalogue is not;
 * and the owner is shown `TRIAL_MID` where a sentence should be. Nothing fails — not the
 * types, which never see the key, and not the tests, which do not render that row with that
 * code. It is found by someone looking at the screen, or not at all. Three of these were
 * live on the settings page before this test was written.
 *
 * It also holds the two catalogues to the same shape. A key present in English and missing
 * in Hindi is the same bug for the half of this gym who read Hindi, and the CRM's default
 * language is Hindi.
 */

type Tree = Record<string, unknown>;

/** Every leaf path in a message catalogue, e.g. `crm.settings.ruleNames.PRE_7`. */
function paths(node: unknown, prefix = ''): string[] {
  if (typeof node !== 'object' || node === null) return [prefix];
  return Object.entries(node as Tree).flatMap(([key, value]) => paths(value, prefix === '' ? key : `${prefix}.${key}`));
}

const at = (tree: Tree, path: string): unknown => path.split('.').reduce<unknown>((node, key) => (node as Tree | undefined)?.[key], tree);

describe('message catalogues', () => {
  it('has the same keys in Hindi as in English', () => {
    const english = new Set(paths(en));
    const hindi = new Set(paths(hi));

    expect([...english].filter((key) => !hindi.has(key))).toEqual([]);
    expect([...hindi].filter((key) => !english.has(key))).toEqual([]);
  });

  it('names every reminder rule the engine can run', () => {
    // Including the trial's three, which were added to the domain in ADR-088 and reached
    // the owner's settings screen as raw codes.
    for (const locale of [en, hi] as Tree[]) {
      for (const code of REMINDER_RULE_CODES) {
        expect(at(locale, `crm.settings.ruleNames.${code}`), `ruleNames.${code}`).toBeTypeOf('string');
      }
    }
  });

  it('names every gender, training slot and language a member can have', () => {
    for (const locale of [en, hi] as Tree[]) {
      for (const gender of MEMBER_GENDERS) expect(at(locale, `crm.gender.${gender}`), `gender.${gender}`).toBeTypeOf('string');
      for (const slot of TRAINING_SLOTS) expect(at(locale, `crm.verify.slot.${slot}`), `slot.${slot}`).toBeTypeOf('string');
      for (const language of LANGUAGES) expect(at(locale, `crm.edit.languages.${language}`), `languages.${language}`).toBeTypeOf('string');
    }
  });

  /**
   * Blank on purpose, with the reason. A blank message renders as a gap rather than as an
   * error, so each one has to be a decision somebody made rather than a key somebody
   * abandoned — and listing them here is what makes the difference visible.
   */
  const DELIBERATELY_BLANK: Readonly<Record<'en' | 'hi', readonly string[]>> = {
    // "The Hindi translation is being reviewed; the English is below" is shown on the Hindi
    // page only, so the English side of that key is never rendered.
    en: ['legal.hiPending'],
    hi: [],
  };

  it('leaves no message empty except the ones that are blank on purpose', () => {
    for (const [name, locale] of [['en', en], ['hi', hi]] as const) {
      const blank = paths(locale).filter((path) => {
        const value = at(locale as Tree, path);
        return typeof value === 'string' && value.trim() === '';
      });
      expect(blank, `${name} has blank messages`).toEqual([...DELIBERATELY_BLANK[name]]);
    }
  });
});
