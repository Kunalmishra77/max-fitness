import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { istDate } from '@mfp/shared';
import { WithIntl } from '@/test/intl';
import { PayStep, type RazorpayOptions } from './pay-step';

vi.mock('@/lib/analytics', () => ({ track: vi.fn() }));

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const MEMBERSHIP = { startDate: '2026-09-11', endDate: '2026-12-10' };
const onlineOrder = (provider: 'simulated' | 'razorpay') => ({
  data: {
    kind: 'ONLINE',
    paymentId: 'pay_1',
    provider,
    orderId: 'order_sim_abc',
    keyId: 'rzp_test_key',
    amountPaise: 400_000,
    currency: 'INR',
    prefill: { name: 'Priya Sharma', contact: '+919876543210', email: null },
    membership: MEMBERSHIP,
  },
});
const CALLBACK = { razorpay_order_id: 'order_sim_abc', razorpay_payment_id: 'pay_sim_1', razorpay_signature: 'sig' };
const PAID = {
  data: { status: 'PAID', memberCode: 'MF-0012', receiptNo: 'MF/2026-27/000007', membership: MEMBERSHIP, receiptUrl: 'http://localhost/r/tok' },
};

function renderStep(props: Partial<Parameters<typeof PayStep>[0]> = {}) {
  const onPaid = vi.fn();
  const onReserved = vi.fn();
  render(
    <WithIntl>
      <PayStep
        auth={{ kind: 'registration', token: 'reg_tok' }}
        planId="plan_m3"
        startDate={istDate('2026-09-11')}
        summary={{ firstName: 'Priya', planLabel: '3 months', startDate: istDate('2026-09-11'), endDate: istDate('2026-12-10'), planPricePaise: 400_000, admissionPaise: 0 }}
        phoneDisplay="+91 98714 06350"
        pollIntervalMs={10}
        onPaid={onPaid}
        onReserved={onReserved}
        {...props}
      />
    </WithIntl>,
  );
  return { onPaid, onReserved, user: userEvent.setup() };
}

describe('PayStep', () => {
  it('shows the summary and the amount to pay', () => {
    renderStep();
    expect(screen.getByText('Priya, 3 months, 11 Sep 2026 to 10 Dec 2026')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Pay ₹4,000' })).toBeTruthy();
    expect(screen.getByText("We'll hold your plan for 48 hours.")).toBeTruthy();
  });

  it('pays through the demo dialog and the real verify step, then reports the receipt', async () => {
    const seen: Array<{ path: string; token: string | null; body: unknown }> = [];
    const record = async (request: Request) =>
      seen.push({ path: new URL(request.url).pathname, token: request.headers.get('x-registration-token'), body: await request.clone().json() });
    server.use(
      http.post('*/api/v1/checkout/orders', async ({ request }) => (await record(request), HttpResponse.json(onlineOrder('simulated'), { status: 201 }))),
      http.post('*/api/v1/checkout/simulate', async ({ request }) => (await record(request), HttpResponse.json({ data: CALLBACK }))),
      http.post('*/api/v1/checkout/verify', async ({ request }) => (await record(request), HttpResponse.json(PAID))),
    );
    const { user, onPaid } = renderStep();

    await user.click(screen.getByRole('button', { name: 'Pay ₹4,000' }));
    expect(await screen.findByText(/This is a demo/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Simulate success' }));

    await vi.waitFor(() => expect(onPaid).toHaveBeenCalled());
    expect(onPaid).toHaveBeenCalledWith({
      paymentId: 'pay_1',
      amountPaise: 400_000,
      memberCode: 'MF-0012',
      receiptNo: 'MF/2026-27/000007',
      receiptUrl: 'http://localhost/r/tok',
      membership: MEMBERSHIP,
    });
    expect(seen).toEqual([
      { path: '/api/v1/checkout/orders', token: 'reg_tok', body: { planId: 'plan_m3', startDate: '2026-09-11', payAtReception: false } },
      { path: '/api/v1/checkout/simulate', token: 'reg_tok', body: { providerOrderId: 'order_sim_abc', outcome: 'success' } },
      // Verify carries no token: the signature is the proof.
      { path: '/api/v1/checkout/verify', token: null, body: CALLBACK },
    ]);
  });

  it('shows the failure with a way to try again or pay at reception', async () => {
    server.use(
      http.post('*/api/v1/checkout/orders', () => HttpResponse.json(onlineOrder('simulated'), { status: 201 })),
      http.post('*/api/v1/checkout/simulate', () => HttpResponse.json({ data: CALLBACK })),
      http.post('*/api/v1/checkout/verify', () => HttpResponse.json({ data: { status: 'FAILED' } })),
    );
    const { user } = renderStep();

    await user.click(screen.getByRole('button', { name: 'Pay ₹4,000' }));
    await user.click(await screen.findByRole('button', { name: 'Simulate failure' }));

    expect(await screen.findByText("Payment didn't go through")).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Pay at reception' })).toBeTruthy();
  });

  it('offers paying at reception as an equal choice to someone at the desk', () => {
    renderStep({ receptionFirst: true });
    const online = screen.getByRole('button', { name: 'Pay ₹4,000' });
    const reception = screen.getByRole('button', { name: 'Pay at reception' });
    expect(reception.className).toBe(online.className);
    expect(screen.queryByText('or')).toBeNull();
  });

  it('reserves the plan when paying at reception', async () => {
    let body: unknown;
    server.use(
      http.post('*/api/v1/checkout/orders', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(
          { data: { kind: 'PAY_AT_RECEPTION', paymentId: null, amountPaise: 400_000, currency: 'INR', reservedUntil: '2026-09-13T04:30:00.000Z', membership: MEMBERSHIP } },
          { status: 201 },
        );
      }),
    );
    const { user, onReserved } = renderStep();

    await user.click(screen.getByRole('button', { name: 'Pay at reception' }));

    await vi.waitFor(() => expect(onReserved).toHaveBeenCalledWith({ amountPaise: 400_000, reservedUntil: '2026-09-13T04:30:00.000Z', membership: MEMBERSHIP }));
    expect(body).toEqual({ planId: 'plan_m3', startDate: '2026-09-11', payAtReception: true });
  });

  it('keeps checking when the payment is not yet captured, then completes', async () => {
    let polls = 0;
    server.use(
      http.post('*/api/v1/checkout/orders', () => HttpResponse.json(onlineOrder('simulated'), { status: 201 })),
      http.post('*/api/v1/checkout/simulate', () => HttpResponse.json({ data: CALLBACK })),
      http.post('*/api/v1/checkout/verify', () => HttpResponse.json({ data: { status: 'PENDING' } })),
      http.get('*/api/v1/checkout/status', ({ request }) => {
        polls += 1;
        expect(new URL(request.url).searchParams.get('paymentId')).toBe('pay_1');
        expect(request.headers.get('x-registration-token')).toBe('reg_tok');
        return HttpResponse.json(polls < 3 ? { data: { status: 'PENDING' } } : PAID);
      }),
    );
    const { user, onPaid } = renderStep();

    await user.click(screen.getByRole('button', { name: 'Pay ₹4,000' }));
    await user.click(await screen.findByRole('button', { name: 'Simulate success' }));

    await vi.waitFor(() => expect(onPaid).toHaveBeenCalled(), { timeout: 2_000 });
    expect(polls).toBe(3);
  });

  it('opens Razorpay Checkout with the order and verifies its success callback', async () => {
    let options: RazorpayOptions | undefined;
    const loadRazorpay = vi.fn(() =>
      Promise.resolve(
        class {
          constructor(o: RazorpayOptions) {
            options = o;
          }
          on() {}
          open() {
            options?.handler(CALLBACK);
          }
        },
      ),
    );
    server.use(
      http.post('*/api/v1/checkout/orders', () => HttpResponse.json(onlineOrder('razorpay'), { status: 201 })),
      http.post('*/api/v1/checkout/verify', () => HttpResponse.json(PAID)),
    );
    const { user, onPaid } = renderStep({ loadRazorpay });

    await user.click(screen.getByRole('button', { name: 'Pay ₹4,000' }));

    await vi.waitFor(() => expect(onPaid).toHaveBeenCalled());
    expect(options).toMatchObject({
      key: 'rzp_test_key',
      amount: 400_000,
      currency: 'INR',
      order_id: 'order_sim_abc',
      name: 'Max Fitness Gym',
      prefill: { name: 'Priya Sharma', contact: '+919876543210' },
      theme: { color: '#D62828' },
    });
  });

  it('asks to start again when the sign-up session has expired', async () => {
    server.use(http.post('*/api/v1/checkout/orders', () => HttpResponse.json({ error: { code: 'TOKEN_EXPIRED' } }, { status: 401 })));
    const { user } = renderStep();
    await user.click(screen.getByRole('button', { name: 'Pay ₹4,000' }));
    expect(await screen.findByText('Your sign-up session has expired. Please start again.')).toBeTruthy();
  });

  it('tells the member when a payment is held for review instead of failing it', async () => {
    server.use(
      http.post('*/api/v1/checkout/orders', () => HttpResponse.json(onlineOrder('simulated'), { status: 201 })),
      http.post('*/api/v1/checkout/simulate', () => HttpResponse.json({ data: CALLBACK })),
      http.post('*/api/v1/checkout/verify', () => HttpResponse.json({ data: { status: 'NEEDS_REVIEW' } })),
    );
    const { user } = renderStep();
    await user.click(screen.getByRole('button', { name: 'Pay ₹4,000' }));
    await user.click(await screen.findByRole('button', { name: 'Simulate success' }));
    expect(await screen.findByText("We've received your payment")).toBeTruthy();
    expect(screen.getByText(/\+91 98714 06350/)).toBeTruthy();
  });
});
