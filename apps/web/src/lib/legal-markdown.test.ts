import { describe, expect, it } from 'vitest';
import { isSafeHref, parseInline, parseLegalMarkdown } from './legal-markdown';

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
