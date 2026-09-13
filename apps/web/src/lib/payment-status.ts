import type { PaymentSummary } from '@mfp/db';
import type { ISTDate } from '@mfp/shared';
import { receiptUrl, type TokenDeps } from './signup-access';

/**
 * What the confirmation page learns about a payment (`/checkout/verify`, `/checkout/status`).
 *
 * Only a paid payment carries details, and its receipt link is minted fresh on each
 * call, so an unpaid order id reveals nothing but its state.
 */
export type PaymentStatusView =
  | {
      readonly status: 'PAID';
      readonly amountPaise: number;
      readonly memberCode: string | null;
      readonly receiptNo: string | null;
      readonly membership: { readonly startDate: ISTDate | null; readonly endDate: ISTDate } | null;
      readonly receiptUrl: string;
    }
  | { readonly status: 'PENDING' | 'FAILED' | 'NEEDS_REVIEW' };

export function paymentStatusView(summary: PaymentSummary, deps: TokenDeps & { readonly appUrl: string }): PaymentStatusView {
  if (summary.status !== 'PAID') return { status: summary.status };
  return {
    status: 'PAID',
    amountPaise: summary.amountPaise,
    memberCode: summary.memberCode,
    receiptNo: summary.receiptNo,
    membership: summary.membership === null ? null : { startDate: summary.membership.startDate, endDate: summary.membership.endDate },
    receiptUrl: receiptUrl(summary.paymentId, deps),
  };
}
