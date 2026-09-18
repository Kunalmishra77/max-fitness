import { describe, expect, it } from 'vitest';
import { istDate } from '@mfp/shared';
import { qrCandidateView } from './lookup';

/**
 * After a right OTP, the phone may see who the register has on that number
 * (api-specification §/qr/lookup): a first name, an initial, the plan and the day it ends —
 * enough to say "this is me", not enough to learn a family member's full record.
 */
describe('qrCandidateView', () => {
  it('shows the first name, the last initial, the plan and the month-end date (the phone formats it)', () => {
    expect(
      qrCandidateView({
        memberId: 'm1',
        fullName: 'Sanjay  Kumar Tomar',
        planMonths: 3,
        endDate: istDate('2026-09-28'),
      }),
    ).toEqual({
      memberId: 'm1',
      firstName: 'Sanjay',
      lastInitial: 'T',
      planMonths: 3,
      monthEnd: '2026-09-28',
    });
  });

  it('copes with a single name and an unknown plan or date', () => {
    expect(qrCandidateView({ memberId: 'm2', fullName: 'Pinky', planMonths: null, endDate: null })).toEqual({
      memberId: 'm2',
      firstName: 'Pinky',
      lastInitial: null,
      planMonths: null,
      monthEnd: null,
    });
  });
});
