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

const ok: QrJoinResult = { ok: true, kind: 'RESERVED' as const, firstName: 'Sanjay', amountPaise: 400_000, reservedUntil: '2026-10-03T04:30:00.000Z' };

const PT_PLANS = [
  { planId: 'plan_pt1_male', durationMonths: 1, pricePaise: 500_000, gender: 'MALE' as const },
  { planId: 'plan_pt3_male', durationMonths: 3, pricePaise: 1_350_000, gender: 'MALE' as const },
  { planId: 'plan_pt12_male', durationMonths: 12, pricePaise: 3_600_000, gender: 'MALE' as const },
];

function form(over: { result?: QrJoinResult; ptPlans?: typeof PT_PLANS; trialOptions?: ReadonlyArray<{ days: number; totalPaise: number }> } = {}) {
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
        ptPlans={over.ptPlans ?? []}
        trialOptions={over.trialOptions ?? []}
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

async function walk(
  stop: 'plan' | 'pt' | 'payMethod' | 'slot' | 'govId' | 'consent' = 'consent',
  { hasPt = false, pay = 'Cash at the counter' }: { hasPt?: boolean; pay?: string } = {},
) {
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
  if (stop === 'pt') return;

  // The personal-training screen exists only when the gym sells it (ADR-087).
  if (hasPt) {
    await next();
  }
  if (stop === 'payMethod') return;

  await userEvent.click(screen.getByRole('radio', { name: new RegExp(pay, 'i') }));
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

  /**
   * ADR-076 kept money off this form entirely: opening a checkout in front of somebody
   * already standing at the desk was theatre. The owner asked for the question back
   * (2026-10-07), so the form asks — and cash, which is what the gym runs on, still never
   * sees a checkout.
   */
  it('keeps a member who pays cash away from any checkout', async () => {
    form();
    await walk();

    expect(screen.queryByRole('button', { name: /Pay ₹|Pay now|online/i })).toBeNull();
    expect(screen.getByText(/Pay at the desk/i)).toBeTruthy();
  });

  it('asks how the member pays, and assumes neither answer for them', async () => {
    form();
    await walk('payMethod');

    const cash = screen.getByRole('radio', { name: /Cash at the counter/i });
    const online = screen.getByRole('radio', { name: /^Online/i });
    expect((cash as HTMLInputElement).checked).toBe(false);
    expect((online as HTMLInputElement).checked).toBe(false);
  });

  it('registers and holds the plan when the member sends it', async () => {
    const { join, user } = form();
    await walk();

    await user.click(screen.getByRole('checkbox', { name: /Terms/i }));
    await user.click(screen.getByRole('button', { name: /Send to reception/i }));

    await waitFor(() => expect(join).toHaveBeenCalledOnce());
    const sent = join.mock.calls[0]?.[0] as { form: FormData; planId: string; startDate: string };
    expect(sent.planId).toBe('plan_m3_male');
    // A sign-up must name its start date. Sending null is for a renewal, and doing it
    // here made the order come back 400 while the registration stood (ADR-083).
    expect(sent.startDate).toBe('2026-10-01');
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

  describe('the paid trial', () => {
    const TRIAL = [
      { days: 1, totalPaise: 10_000 },
      { days: 3, totalPaise: 30_000 },
    ];

    it('is offered on the plan screen and sent instead of a plan', async () => {
      // ADR-088: somebody who walked in off the street may want three days, not a month.
      const { join, user } = form({ trialOptions: TRIAL });
      await walk('plan');

      await user.click(screen.getByRole('radio', { name: /3 day trial/i }));
      await next();
      await user.click(screen.getByRole('radio', { name: /Cash at the counter/i }));
      await next();
      await user.click(screen.getByRole('radio', { name: /^Morning$/i }));
      await next();
      await user.selectOptions(screen.getByLabelText(/Upload a Govt ID/i), 'PAN');
      await user.upload(screen.getByLabelText(/Front of the card/i), new File(['c'], 'front.jpg', { type: 'image/jpeg' }));
      await next();
      await next();
      await user.click(screen.getByRole('checkbox', { name: /Terms/i }));
      await user.click(screen.getByRole('button', { name: /Send to reception/i }));

      await waitFor(() => expect(join).toHaveBeenCalledOnce());
      const sent = join.mock.calls[0]?.[0] as { planId: string | null; trialDays: number | null };
      expect(sent).toMatchObject({ planId: null, trialDays: 3 });
    });

    it('is not offered when the gym has it switched off', async () => {
      form();
      await walk('plan');
      expect(screen.queryByText(/try us first/i)).toBeNull();
    });
  });

  describe('personal training', () => {
    it('does not ask at all when the gym sells none', async () => {
      form();
      await walk('pt');
      // Straight on to the fees question, with no empty screen in between.
      expect(screen.queryByText(/personal training/i)).toBeNull();
      expect(screen.getByText(/How will you pay/i)).toBeTruthy();
    });

    it('asks after the plan, offering only terms that fit inside it', async () => {
      form({ ptPlans: PT_PLANS });
      await walk('pt');

      expect(screen.getByText(/Do you need personal training/i)).toBeTruthy();
      await userEvent.click(screen.getByRole('radio', { name: /^Yes$/i }));
      // Twelve months of a trainer on a three-month membership is a mis-sale.
      expect(screen.getByRole('radio', { name: /1 Month/i })).toBeTruthy();
      expect(screen.getByRole('radio', { name: /3 Months/i })).toBeTruthy();
      expect(screen.queryByRole('radio', { name: /12 Months/i })).toBeNull();
    });

    it('sends the chosen trainer with the plan, and the total to hand over', async () => {
      const { join, user } = form({ ptPlans: PT_PLANS });
      await walk('pt');

      await user.click(screen.getByRole('radio', { name: /^Yes$/i }));
      await user.click(screen.getByRole('radio', { name: /3 Months/i }));
      await next();
      await user.click(screen.getByRole('radio', { name: /Cash at the counter/i }));
      await next();
      await user.click(screen.getByRole('radio', { name: /^Morning$/i }));
      await next();
      await user.selectOptions(screen.getByLabelText(/Upload a Govt ID/i), 'PAN');
      await user.upload(screen.getByLabelText(/Front of the card/i), new File(['c'], 'front.jpg', { type: 'image/jpeg' }));
      await next();
      await next();

      // ₹4,000 membership + ₹13,500 trainer, before anything is handed over.
      expect(screen.getByText(/₹17,500/)).toBeTruthy();

      await user.click(screen.getByRole('checkbox', { name: /Terms/i }));
      await user.click(screen.getByRole('button', { name: /Send to reception/i }));

      await waitFor(() => expect(join).toHaveBeenCalledOnce());
      expect((join.mock.calls[0]?.[0] as { ptPlanId: string | null }).ptPlanId).toBe('plan_pt3_male');
    });

    it('sends no trainer when the answer is no', async () => {
      const { join, user } = form({ ptPlans: PT_PLANS });
      await walk('consent', { hasPt: true });

      await user.click(screen.getByRole('checkbox', { name: /Terms/i }));
      await user.click(screen.getByRole('button', { name: /Send to reception/i }));

      await waitFor(() => expect(join).toHaveBeenCalledOnce());
      expect((join.mock.calls[0]?.[0] as { ptPlanId: string | null }).ptPlanId).toBeNull();
    });

    it('asks for a term when the member said yes and chose none', async () => {
      const { user } = form({ ptPlans: PT_PLANS });
      await walk('pt');

      await user.click(screen.getByRole('radio', { name: /^Yes$/i }));
      await next();

      const alerts = screen.getAllByRole('alert');
      expect(alerts.some((alert) => alert.textContent?.includes('personal training'))).toBe(true);
      // Still on the same screen, not pushed forward.
      expect(screen.getByText(/Do you need personal training/i)).toBeTruthy();
    });
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
