import { describe, expect, it } from 'vitest';
import { TEMPLATES } from './templates';

/**
 * What Meta refuses before a human ever reads it.
 *
 * These are not style rules. Each one is a refusal that cost a round trip during the
 * October 2026 submission: a template with six variables in seventy characters came back
 * "too many variables for its length", and `mf_owner_alert` — whose entire body was
 * `{{1}}` — had nothing for a reviewer to read at all.
 *
 * The checks live here rather than in a checklist because the next person to add a
 * template will not have read the checklist.
 */

/** Meta's own threshold is undocumented; this is comfortably inside where it refused. */
const MIN_TEXT_PER_VARIABLE = 25;

const plainLength = (body: string) => body.replace(/\{\{\d+\}\}/g, '').trim().length;

describe('WhatsApp templates, against what Meta will accept', () => {
  const entries = Object.values(TEMPLATES).flatMap((definition) =>
    (['en', 'hi'] as const).map((language) => ({ definition, language })),
  );

  it.each(entries)('$definition.name ($language) has enough wording for its variables', ({ definition, language }) => {
    if (definition.variables.length === 0) return;
    const perVariable = plainLength(definition.body[language]) / definition.variables.length;

    expect(perVariable).toBeGreaterThanOrEqual(MIN_TEXT_PER_VARIABLE);
  });

  it.each(entries)('$definition.name ($language) is more than its variables', ({ definition, language }) => {
    // A body that is only a placeholder is a blank cheque to send anything under an
    // approved name, and Meta says so.
    expect(plainLength(definition.body[language])).toBeGreaterThan(0);
  });

  it.each(entries)('$definition.name ($language) numbers its placeholders from 1 with no gaps', ({ definition, language }) => {
    const used = [...definition.body[language].matchAll(/\{\{(\d+)\}\}/g)].map((match) => Number(match[1]));
    const expected = definition.variables.map((_, index) => index + 1);

    // Every declared variable must appear, and nothing beyond them: a body referring to
    // {{4}} when three are declared sends an empty value to a member.
    expect([...new Set(used)].sort((a, b) => a - b)).toEqual(expected);
  });

  it('declares every template the product can send', () => {
    for (const [name, definition] of Object.entries(TEMPLATES)) {
      expect(definition.name).toBe(name);
    }
  });
});
