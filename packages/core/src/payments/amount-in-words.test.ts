import { describe, expect, it } from 'vitest';
import { amountInWordsINR } from './amount-in-words';

describe('amountInWordsINR', () => {
  it.each([
    [100, 'Rupees One Only'],
    [1_500_00, 'Rupees One Thousand Five Hundred Only'],
    [4_000_00, 'Rupees Four Thousand Only'],
    [13_500_00, 'Rupees Thirteen Thousand Five Hundred Only'],
    [1_00_000_00, 'Rupees One Lakh Only'],
    [2_45_678_00, 'Rupees Two Lakh Forty-Five Thousand Six Hundred Seventy-Eight Only'],
    [1_00_00_000_00, 'Rupees One Crore Only'],
    [12_34_56_789_00, 'Rupees Twelve Crore Thirty-Four Lakh Fifty-Six Thousand Seven Hundred Eighty-Nine Only'],
    [0, 'Rupees Zero Only'],
  ])('%i paise → %s', (paise, words) => {
    expect(amountInWordsINR(paise)).toBe(words);
  });

  it('adds paise when there are any', () => {
    expect(amountInWordsINR(1_234_56)).toBe('Rupees One Thousand Two Hundred Thirty-Four and Fifty-Six Paise Only');
    expect(amountInWordsINR(5)).toBe('Rupees Zero and Five Paise Only');
  });

  it('refuses anything that is not a whole, non-negative number of paise', () => {
    expect(() => amountInWordsINR(-1)).toThrow();
    expect(() => amountInWordsINR(10.5)).toThrow();
  });
});
