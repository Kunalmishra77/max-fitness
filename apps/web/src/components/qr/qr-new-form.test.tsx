import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { WithIntl } from '@/test/intl';
import { QrNewForm, type QrJoin, type QrJoinResult } from './qr-new-form';

/**
 * "I am new here", at the reception desk (client request, ADR-083).
 *
 * The same shape as the existing-member form — one question per screen, the uploads that
 * take a photo or a file — but the questions a stranger should be asked, and no gateway:
 * the gym has no live Razorpay, so the money is handed over at the counter.
 */

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const PLANS = [
  { planId: 'plan_m1_male', durationMonths: 1, pricePaise: 150_000, gender: 'MALE' as const },
  { planId: 'plan_m3_male', durationMonths: 3, pricePaise: 400_000, gender: 'MALE' as const },
  { planId: 'plan_m1_female', durationMonths: 1, pricePaise: 120_000, gender: 'FEMALE' as const },
];

const ok: QrJoinResult = { ok: true, firstName: 'Sanjay', amountPaise: 400_000, reservedUntil: '2026-10-03T04:30:00.000Z' };

function form(over: { result?: QrJoinResult } = {}) {
  const join = vi.fn<QrJoin>().mockResolvedValue(over.result ?? ok);
  render(
    <WithIntl>
      <QrNewForm
        today="2026-10-01"
        minAge={16}
        noticeVersion="1.0"
        termsHref="/legal/terms"
        privacyHref="/legal/privacy"
        plans={PLANS}
        admissionFeePaise={0}
        join={join}
        Camera={({ open, onCaptured }) =>
          open ? (
            <button type="button" onClick={() => onCaptured(new Blob(['x'], { type: 'image/jpeg' }))}>
              Take the photo
            </button>
          ) : null
        }
        shrinkId={(file) => Promise.resolve(new Blob([`small:${file.name}`], { type: 'image/jpeg' }))}
      />
    </WithIntl>,
  );
  return { join, user: userEvent.setup() };
}

const next = () => userEvent.click(screen.getByRole('button', { name: /Next/i }));
const setDate = (label: RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

async function walk(stop: 'plan' | 'slot' | 'govId' | 'consent' = 'consent') {
  await userEvent.type(screen.getByLabelText(/Full name/i), 'Sanjay Tomar');
  await userEvent.type(screen.getByLabelText(/Mobile number/i), '9876543210');
  await next();

  setDate(/Date of birth/i, '1992-05-14');
  await userEvent.click(screen.getByRole('radio', { name: /^Male$/i }));
  await next();

  await userEvent.click(screen.getByRole('button', { name: /Take your photo/i }));
  await userEvent.click(screen.getByRole('button', { name: /Take the photo/i }));
  await next();
  if (stop === 'plan') return;

  await userEvent.click(screen.getByRole('radio', { name: /3 Months/i }));
  await next();
  if (stop === 'slot') return;

  await userEvent.click(screen.getByRole('radio', { name: /^Morning$/i }));
  await next();
  if (stop === 'govId') return;

  await userEvent.selectOptions(screen.getByLabelText(/Upload a Govt ID/i), 'PAN');
  await userEvent.upload(screen.getByLabelText(/Front of the card/i), new File(['c'], 'front.jpg', { type: 'image/jpeg' }));
  await next();

  // The optional screen.
  await next();
}

describe('QrNewForm', () => {
  it('asks one thing at a time', () => {
    form();

    expect(screen.getByLabelText(/Full name/i)).toBeTruthy();
    expect(screen.queryByLabelText(/Upload a Govt ID/i)).toBeNull();
    expect(screen.getByText(/1 \/ \d/)).toBeTruthy();
  });

  it('shows only the plans for the gender the member gave, with their prices', async () => {
    form();
    await walk('plan');

    expect(screen.getByRole('radio', { name: /1 Month/i })).toBeTruthy();
    expect(screen.getByRole('radio', { name: /3 Months/i })).toBeTruthy();
    // The women's plan is not a choice for somebody who said Male.
    expect(screen.getByText(/₹1,500/)).toBeTruthy();
    expect(screen.queryByText(/₹1,200/)).toBeNull();
  });

  it('never offers to take money online, only at the desk', async () => {
    form();
    await walk();

    expect(screen.queryByRole('button', { name: /Pay ₹|Pay now|online/i })).toBeNull();
    expect(screen.getByText(/Pay at the desk/i)).toBeTruthy();
  });

  it('registers and holds the plan when the member sends it', async () => {
    const { join, user } = form();
    await walk();

    await user.click(screen.getByRole('checkbox', { name: /Terms/i }));
    await user.click(screen.getByRole('button', { name: /Send to reception/i }));

    await waitFor(() => expect(join).toHaveBeenCalledOnce());
    const sent = join.mock.calls[0]?.[0] as { form: FormData; planId: string };
    expect(sent.planId).toBe('plan_m3_male');
    expect(sent.form.get('fullName')).toBe('Sanjay Tomar');
    expect(sent.form.get('source')).toBe('QR_NEW');
    expect(sent.form.get('trainingSlot')).toBe('MORNING');
    expect(await (sent.form.get('govIdFront') as Blob).text()).toBe('small:front.jpg');
  });

  it('tells the member what to hand over at the counter once it is done', async () => {
    const { user } = form();
    await walk();

    await user.click(screen.getByRole('checkbox', { name: /Terms/i }));
    await user.click(screen.getByRole('button', { name: /Send to reception/i }));

    expect(await screen.findByText(/₹4,000/)).toBeTruthy();
  });

  it('says what went wrong with a reference rather than a dead end', async () => {
    const { user } = form({ result: { ok: false, code: 'INTERNAL', requestId: 'req_zz9' } });
    await walk();

    await user.click(screen.getByRole('checkbox', { name: /Terms/i }));
    await user.click(screen.getByRole('button', { name: /Send to reception/i }));

    const alerts = await screen.findAllByRole('alert');
    expect(alerts.some((alert) => alert.textContent?.includes('req_zz9'))).toBe(true);
  });
});
