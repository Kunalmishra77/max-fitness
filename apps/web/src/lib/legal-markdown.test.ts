import { describe, expect, it } from 'vitest';
import { hasPlaceholders, isSafeHref, parseInline, parseLegalMarkdown } from './legal-markdown';

/**
 * Whether a policy is still ours rather than the gym's (ADR-085).
 *
 * The draft notice used to appear whenever DEMO_MODE was on, which tied it to payments
 * having no gateway — nothing to do with whether the policy is written. Now it follows
 * the document: while a square-bracket placeholder is in there, the page says so, and the
 * day the owner's words land it stops saying it, with nobody having to remember.
 */
describe('hasPlaceholders', () => {
  it('finds the brackets we leave for the owner', () => {
    expect(hasPlaceholders('We refund as follows. [Owner refund policy]. Ask reception.')).toBe(true);
    expect(hasPlaceholders('Contact [Grievance officer name] within 48 hours.')).toBe(true);
  });

  it('does not call a finished policy a draft', () => {
    expect(hasPlaceholders('Fees are not refundable after seven days. Call 098714 06350.')).toBe(false);
  });

  it('catches a lower-case one too, which is how "[minimum age]" stayed live', () => {
    expect(hasPlaceholders('The minimum age to join is [minimum age] years.')).toBe(true);
    expect(hasPlaceholders('Refunded [method: owner to confirm].')).toBe(true);
  });

  it('is not fooled by a markdown link', () => {
    expect(hasPlaceholders('Read the [privacy policy](/legal/privacy) for more.')).toBe(false);
    expect(hasPlaceholders('See the [terms](/legal/terms) and the [refund policy](/legal/refund).')).toBe(false);
  });
});

describe('parseLegalMarkdown', () => {
  it('reads the title, the updated date, headings, paragraphs and lists', () => {
    const doc = parseLegalMarkdown(
      [
        '<!-- updated: 2026-09-11 -->',
        '# Privacy policy',
        '',
        'First line',
        'continues here.',
        '',
        '## Your rights',
        '- See your data',
        '- Correct it',
        'A paragraph straight after a list.',
        '### Detail',
      ].join('\r\n'),
    );

    expect(doc.title).toBe('Privacy policy');
    expect(doc.updated).toBe('2026-09-11');
    expect(doc.blocks).toEqual([
      { type: 'p', text: 'First line continues here.' },
      { type: 'h2', text: 'Your rights' },
      { type: 'ul', items: ['See your data', 'Correct it'] },
      { type: 'p', text: 'A paragraph straight after a list.' },
      { type: 'h3', text: 'Detail' },
    ]);
  });

  it('keeps markup as literal text', () => {
    const doc = parseLegalMarkdown('<script>alert(1)</script>');
    expect(doc.blocks).toEqual([{ type: 'p', text: '<script>alert(1)</script>' }]);
  });

  it('has no date when the marker is missing', () => {
    expect(parseLegalMarkdown('# Terms').updated).toBeNull();
  });
});

describe('parseInline', () => {
  it('finds bold text and safe links', () => {
    expect(parseInline('See **this** and [refunds](/legal/refund).')).toEqual([
      { type: 'text', text: 'See ' },
      { type: 'strong', text: 'this' },
      { type: 'text', text: ' and ' },
      { type: 'link', text: 'refunds', href: '/legal/refund' },
      { type: 'text', text: '.' },
    ]);
  });

  it('leaves unsafe links as plain text', () => {
    const tokens = parseInline('[click](javascript:alert(1)) and [x](//evil.example)');
    expect(tokens.some((token) => token.type === 'link')).toBe(false);
  });
});

describe('isSafeHref', () => {
  it.each([
    ['https://example.com', true],
    ['mailto:owner@example.com', true],
    ['tel:+919871406350', true],
    ['/legal/privacy', true],
    ['//evil.example', false],
    ['http://insecure.example', false],
    ['javascript:alert(1)', false],
  ])('%s → %s', (href, expected) => {
    expect(isSafeHref(href)).toBe(expected);
  });
});
