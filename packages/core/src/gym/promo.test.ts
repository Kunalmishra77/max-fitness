import { describe, expect, it } from 'vitest';
import { istDate } from '@mfp/shared';
import { activePromos, isWithinPromoWindow, type PromoSettingsInput } from './promo';

const TODAY = istDate('2026-09-10');

const promo = (overrides: Partial<PromoSettingsInput> = {}): PromoSettingsInput => ({
  enabled: true,
  textEn: 'Festive offer: 2 weeks extra on 6 months.',
  textHi: 'त्योहार ऑफर: 6 महीने पर 2 हफ्ते एक्स्ट्रा।',
  barEnabled: true,
  barTextEn: 'First session free.',
  barTextHi: 'पहला सेशन फ्री।',
  startDate: null,
  endDate: null,
  ...overrides,
});

describe('isWithinPromoWindow', () => {
  it('is open with no window', () => {
    expect(isWithinPromoWindow(TODAY, null, null)).toBe(true);
  });

  it('includes both boundary days', () => {
    expect(isWithinPromoWindow(TODAY, '2026-09-10', '2026-09-10')).toBe(true);
  });

  it('is closed before the start and after the end', () => {
    expect(isWithinPromoWindow(TODAY, '2026-09-11', null)).toBe(false);
    expect(isWithinPromoWindow(TODAY, null, '2026-09-09')).toBe(false);
  });

  it('ignores a malformed date instead of hiding the offer', () => {
    expect(isWithinPromoWindow(TODAY, 'next week', '31/12/2026')).toBe(true);
  });
});

describe('activePromos — LP-02 bar and LP-11 banner', () => {
  it('shows both in the visitor’s language', () => {
    expect(activePromos(promo(), TODAY, 'en')).toEqual({ bar: 'First session free.', banner: 'Festive offer: 2 weeks extra on 6 months.' });
    expect(activePromos(promo(), TODAY, 'hi')).toEqual({ bar: 'पहला सेशन फ्री।', banner: 'त्योहार ऑफर: 6 महीने पर 2 हफ्ते एक्स्ट्रा।' });
  });

  it('controls the bar and the banner independently', () => {
    expect(activePromos(promo({ barEnabled: false }), TODAY, 'en').bar).toBeNull();
    expect(activePromos(promo({ enabled: false }), TODAY, 'en').banner).toBeNull();
  });

  it('falls back to the other language when one is blank', () => {
    expect(activePromos(promo({ textHi: '  ' }), TODAY, 'hi').banner).toBe('Festive offer: 2 weeks extra on 6 months.');
    expect(activePromos(promo({ barTextEn: '' }), TODAY, 'en').bar).toBe('पहला सेशन फ्री।');
  });

  it('never renders an empty bar or banner', () => {
    expect(activePromos(promo({ textEn: '', textHi: '', barTextEn: '', barTextHi: '' }), TODAY, 'en')).toEqual({ bar: null, banner: null });
  });

  it('hides everything outside the date window', () => {
    expect(activePromos(promo({ endDate: '2026-09-01' }), TODAY, 'en')).toEqual({ bar: null, banner: null });
  });
});
