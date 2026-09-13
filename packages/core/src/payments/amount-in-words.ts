import { DomainError } from '../errors';

/**
 * A receipt amount in words, in the Indian numbering system (signup-and-payment-flow.md §7).
 *
 * "Rupees Two Lakh Forty-Five Thousand Six Hundred Seventy-Eight Only" — lakh and crore,
 * never million, because that is how an Indian receipt is read and checked.
 */

const ONES = [
  'Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen',
] as const;
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'] as const;

function belowHundred(n: number): string {
  if (n < 20) return ONES[n] ?? '';
  const tens = TENS[Math.floor(n / 10)] ?? '';
  const unit = n % 10;
  return unit === 0 ? tens : `${tens}-${ONES[unit] ?? ''}`;
}

function belowThousand(n: number): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  const parts = [hundreds > 0 ? `${ONES[hundreds] ?? ''} Hundred` : '', rest > 0 ? belowHundred(rest) : ''];
  return parts.filter(Boolean).join(' ');
}

function wholeNumber(n: number): string {
  if (n === 0) return 'Zero';
  const crore = Math.floor(n / 1_00_00_000);
  const lakh = Math.floor((n % 1_00_00_000) / 1_00_000);
  const thousand = Math.floor((n % 1_00_000) / 1_000);
  const rest = n % 1_000;
  return [
    // Above 99 crore the crore count itself is read in the same system ("One Hundred Crore").
    crore > 0 ? `${wholeNumber(crore)} Crore` : '',
    lakh > 0 ? `${belowHundred(lakh)} Lakh` : '',
    thousand > 0 ? `${belowHundred(thousand)} Thousand` : '',
    rest > 0 ? belowThousand(rest) : '',
  ]
    .filter(Boolean)
    .join(' ');
}

export function amountInWordsINR(paise: number): string {
  if (!Number.isSafeInteger(paise) || paise < 0) {
    throw new DomainError('VALIDATION_FAILED', 'Amount must be a whole, non-negative number of paise');
  }
  const rupees = Math.floor(paise / 100);
  const remainder = paise % 100;
  const paisePart = remainder > 0 ? ` and ${belowHundred(remainder)} Paise` : '';
  return `Rupees ${wholeNumber(rupees)}${paisePart} Only`;
}
