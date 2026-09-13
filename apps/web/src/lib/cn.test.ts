// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { cn } from './cn';

describe('cn', () => {
  it('keeps a token font size and a text colour together', () => {
    expect(cn('text-display-l', 'text-brand-plate-navy')).toBe('text-display-l text-brand-plate-navy');
    expect(cn('text-brand-white', 'text-body-l')).toBe('text-brand-white text-body-l');
  });

  it('still lets a later value in the same scale win', () => {
    expect(cn('text-body', 'text-small')).toBe('text-small');
    expect(cn('text-brand-chalk', 'text-brand-white')).toBe('text-brand-white');
    expect(cn('rounded-button', 'rounded-panel')).toBe('rounded-panel');
    expect(cn('leading-body', 'leading-display')).toBe('leading-display');
  });

  it('keeps a token line height alongside a font size', () => {
    expect(cn('text-display-xl', 'leading-display')).toBe('text-display-xl leading-display');
  });
});
