import { render, screen } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { WithIntl } from '@/test/intl';
import { LeadForm } from './lead-form';

vi.mock('@/lib/analytics', () => ({ track: vi.fn() }));

const LEADS = '*/api/v1/leads';
const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function renderForm() {
  render(
    <WithIntl>
      <LeadForm />
    </WithIntl>,
  );
  return userEvent.setup();
}

async function fillValid(user: UserEvent) {
  await user.type(screen.getByLabelText('Your name'), 'Priya Sharma');
  await user.type(screen.getByLabelText('Mobile number'), '9876543210');
  await user.selectOptions(screen.getByLabelText('Your goal'), 'GET_FIT');
}

const submit = () => screen.getByRole('button', { name: 'Request a call back' });

describe('LeadForm', () => {
  it('shows schema errors and does not call the API', async () => {
    let called = false;
    server.use(
      http.post(LEADS, () => {
        called = true;
        return HttpResponse.json({}, { status: 201 });
      }),
    );
    const user = renderForm();

    await user.click(submit());

    expect(await screen.findByText('Enter your name.')).toBeTruthy();
    expect(screen.getByText('Enter a 10-digit mobile number starting with 6, 7, 8 or 9.')).toBeTruthy();
    expect(screen.getByText('Choose your goal.')).toBeTruthy();
    expect(screen.getByLabelText('Your name').getAttribute('aria-invalid')).toBe('true');
    expect(called).toBe(false);
  });

  it('submits the lead and shows the success message', async () => {
    let body: Record<string, unknown> | null = null;
    server.use(
      http.post(LEADS, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ data: { leadId: 'lead_1' }, meta: { requestId: 'req_1' } }, { status: 201 });
      }),
    );
    const user = renderForm();

    await fillValid(user);
    await user.click(submit());

    expect(await screen.findByText(/Request sent/)).toBeTruthy();
    expect(body).toMatchObject({
      name: 'Priya Sharma',
      mobile: '9876543210',
      goal: 'GET_FIT',
      source: 'WEBSITE_HERO',
      consentContact: true,
    });
    // The honeypot was left empty, so it is not sent at all.
    expect(body).not.toHaveProperty('company');
  });

  it('explains a rate limit', async () => {
    server.use(http.post(LEADS, () => HttpResponse.json({ error: { code: 'RATE_LIMITED' } }, { status: 429 })));
    const user = renderForm();

    await fillValid(user);
    await user.click(submit());

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText(/Too many requests from this device/)).toBeTruthy();
  });

  it('shows field errors returned by the server', async () => {
    server.use(
      http.post(LEADS, () =>
        HttpResponse.json(
          { error: { code: 'VALIDATION_FAILED', details: { fields: { mobile: 'mobile' } } } },
          { status: 400 },
        ),
      ),
    );
    const user = renderForm();

    await fillValid(user);
    await user.click(submit());

    expect(await screen.findByText('Enter a 10-digit mobile number starting with 6, 7, 8 or 9.')).toBeTruthy();
  });

  it('tells the visitor when the network fails', async () => {
    server.use(http.post(LEADS, () => HttpResponse.error()));
    const user = renderForm();

    await fillValid(user);
    await user.click(submit());

    expect(await screen.findByText(/You seem to be offline/)).toBeTruthy();
  });
});
