import { createElement as h } from 'react';
import { Document, Page, StyleSheet, Text, View, renderToBuffer } from '@react-pdf/renderer';
import { amountInWordsINR, type ReceiptDocument } from '@mfp/core';
import { formatINR, formatISTDate, formatISTDateTime, type ISTDate } from '@mfp/shared';

/**
 * The A5 receipt PDF (signup-and-payment-flow.md §7).
 *
 * English only, in the PDF's built-in Helvetica: it has no ₹ glyph and no Devanagari,
 * so amounts read "Rs. 4,000.00" — the form an Indian receipt commonly uses anyway.
 * The member's own-language view is the `/r/{token}` page.
 */

const METHODS: Record<ReceiptDocument['method'], string> = {
  RAZORPAY: 'Online (Razorpay)',
  CASH: 'Cash',
  UPI_DIRECT: 'UPI',
  CARD_POS: 'Card',
  BANK_TRANSFER: 'Bank transfer',
  SIMULATED: 'Demo payment (no money taken)',
};

const rupees = (paise: number) => `Rs. ${formatINR(paise, { withSymbol: false, showPaise: true })}`;

function displayPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '').slice(-10);
  return digits.length === 10 ? `+91 ${digits.slice(0, 5)} ${digits.slice(5)}` : phone;
}

export interface ReceiptLines {
  readonly header: readonly string[];
  readonly details: ReadonlyArray<readonly [string, string]>;
  readonly amounts: ReadonlyArray<readonly [string, string]>;
  readonly total: readonly [string, string];
  readonly inWords: string;
  readonly footer: string;
}

/** Everything printed on the receipt, as plain strings, in order. */
export function receiptLines(receipt: ReceiptDocument): ReceiptLines {
  const { gym, member, membership } = receipt;
  const details: Array<readonly [string, string]> = [
    ['Receipt no.', receipt.receiptNo],
    ['Date', formatISTDateTime(receipt.paidAt, 'en')],
    ['Member', member.fullName],
  ];
  if (member.memberCode !== null) details.push(['Member code', member.memberCode]);
  if (membership?.durationMonths != null && membership.startDate !== null) {
    const plan = membership.durationMonths === 1 ? 'Monthly' : `${membership.durationMonths} months`;
    details.push([
      'Plan',
      `${plan} membership, ${formatISTDate(membership.startDate as ISTDate, 'en')} to ${formatISTDate(membership.endDate as ISTDate, 'en')}`,
    ]);
  }
  details.push(['Paid by', METHODS[receipt.method]]);

  const amounts: Array<readonly [string, string]> = [];
  if (membership !== null) {
    amounts.push(['Membership fee', rupees(membership.pricePaise)]);
    if (membership.admissionPaise > 0) amounts.push(['Admission fee', rupees(membership.admissionPaise)]);
  }

  return {
    header: [gym.name, `${gym.addressLine}, ${gym.city}, ${gym.state} ${gym.pincode}`, `Phone ${displayPhone(gym.phone)}`],
    details,
    amounts,
    total: ['Total paid', rupees(receipt.amountPaise)],
    inWords: amountInWordsINR(receipt.amountPaise),
    footer: 'This is a computer-generated receipt and needs no signature.',
  };
}

const NAVY = '#1B2A41';
const GREY = '#5F6B7A';

const styles = StyleSheet.create({
  page: { padding: 32, fontFamily: 'Helvetica', fontSize: 10, color: '#111827' },
  gym: { fontSize: 15, fontFamily: 'Helvetica-Bold', color: NAVY },
  muted: { color: GREY, marginTop: 2 },
  title: { fontSize: 13, fontFamily: 'Helvetica-Bold', color: NAVY, marginTop: 14, marginBottom: 10 },
  rule: { borderBottomWidth: 1, borderBottomColor: '#D1D5DB', marginVertical: 10 },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 },
  label: { color: GREY, width: '32%' },
  value: { fontFamily: 'Helvetica-Bold', width: '68%', textAlign: 'right' },
  total: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6, fontSize: 12, fontFamily: 'Helvetica-Bold', color: NAVY },
  footer: { marginTop: 18, color: GREY, fontSize: 8 },
});

export async function renderReceiptPdf(receipt: ReceiptDocument): Promise<Uint8Array> {
  const lines = receiptLines(receipt);
  const row = ([label, value]: readonly [string, string], key: string) =>
    h(View, { style: styles.row, key }, h(Text, { style: styles.label }, label), h(Text, { style: styles.value }, value));

  const document = h(
    Document,
    { title: `Receipt ${receipt.receiptNo}`, author: receipt.gym.name, creator: 'Max Fitness Platform' },
    h(
      Page,
      { size: 'A5', style: styles.page },
      h(Text, { style: styles.gym }, lines.header[0]),
      ...lines.header.slice(1).map((line, i) => h(Text, { style: styles.muted, key: `h${i}` }, line)),
      h(Text, { style: styles.title }, 'Payment receipt'),
      ...lines.details.map((line, i) => row(line, `d${i}`)),
      h(View, { style: styles.rule }),
      ...lines.amounts.map((line, i) => row(line, `a${i}`)),
      h(View, { style: styles.total }, h(Text, null, lines.total[0]), h(Text, null, lines.total[1])),
      h(Text, { style: styles.muted }, `Amount in words: ${lines.inWords}`),
      h(Text, { style: styles.footer }, lines.footer),
    ),
  );

  const buffer = await renderToBuffer(document);
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}
