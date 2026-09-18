import type { ISTDate } from '@mfp/shared';

/**
 * What the phone may see after a right OTP (api-specification §/qr/lookup; ADR-060).
 *
 * A first name and an initial, the plan and its end date: enough to say "this is me",
 * not a family member's full name, date of birth or payments. Without a proven number
 * the lookup is never called (ADR-058).
 */

export interface QrLookupRecord {
  readonly memberId: string;
  readonly fullName: string;
  readonly planMonths: number | null;
  readonly endDate: ISTDate | null;
}

export interface QrCandidate {
  readonly memberId: string;
  readonly firstName: string;
  readonly lastInitial: string | null;
  readonly planMonths: number | null;
  readonly monthEnd: ISTDate | null;
}

export function qrCandidateView(record: QrLookupRecord): QrCandidate {
  const parts = record.fullName.trim().split(/\s+/);
  const first = parts[0] ?? '';
  const last = parts.length > 1 ? parts.at(-1) : undefined;
  return {
    memberId: record.memberId,
    firstName: first,
    lastInitial: last === undefined ? null : last.charAt(0).toUpperCase(),
    planMonths: record.planMonths,
    monthEnd: record.endDate,
  };
}
