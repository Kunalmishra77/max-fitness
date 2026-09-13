import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { WithIntl } from '@/test/intl';
import { DoneStep, type DoneStepProps } from './done-step';

const paid: DoneStepProps = {
  kind: 'paid',
  firstName: 'Priya',
  planLabel: '3 months',
  startDate: '2026-09-11',
  endDate: '2026-12-10',
  amountPaise: 400_000,
  memberCode: 'MF-0012',
  receiptNo: 'MF/2026-27/000007',
  receiptUrl: 'https://gym.example/r/tok',
  isMinor: false,
  whatsappUpdates: true,
  directionsHref: 'https://maps.example/dir',
};

const renderDone = (props: DoneStepProps) =>
  render(
    <WithIntl>
      <DoneStep {...props} />
    </WithIntl>,
  );

describe('DoneStep', () => {
  it('welcomes a paid member with their code, dates, receipt and next steps', () => {
    renderDone(paid);

    expect(screen.getByRole('heading', { name: "You're a member, Priya." })).toBeTruthy();
    expect(screen.getByText('Member code MF-0012')).toBeTruthy();
    expect(screen.getByText('3 months, 11 Sep 2026 to 10 Dec 2026')).toBeTruthy();
    expect(screen.getByText('Paid ₹4,000, receipt MF/2026-27/000007')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Download receipt' }).getAttribute('href')).toBe('https://gym.example/r/tok');
    expect(screen.getByRole('link', { name: 'Get directions' }).getAttribute('href')).toBe('https://maps.example/dir');
    expect(screen.getByText(/bring water, a small towel/)).toBeTruthy();
    expect(screen.getByText("We've sent this to your WhatsApp.")).toBeTruthy();
  });

  it('does not claim a WhatsApp message the member did not ask for', () => {
    renderDone({ ...paid, whatsappUpdates: false });
    expect(screen.queryByText("We've sent this to your WhatsApp.")).toBeNull();
  });

  it('reminds a minor to bring a parent or guardian', () => {
    renderDone({ ...paid, isMinor: true });
    expect(screen.getByText(/Bring a parent or guardian/)).toBeTruthy();
  });

  it('confirms a reservation with the amount and the deadline to pay at reception', () => {
    renderDone({
      kind: 'reserved',
      firstName: 'Priya',
      planLabel: '3 months',
      startDate: '2026-09-11',
      endDate: '2026-12-10',
      amountPaise: 400_000,
      reservedUntil: '2026-09-13T04:30:00.000Z',
      isMinor: false,
      whatsappUpdates: true,
      directionsHref: 'https://maps.example/dir',
    });

    expect(screen.getByRole('heading', { name: 'Your plan is reserved, Priya.' })).toBeTruthy();
    expect(screen.getByText('Pay ₹4,000 at reception by 13 Sep 2026, 10:00 am to start.')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Download receipt' })).toBeNull();
  });
});
