import { render, screen, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { istDate } from '@mfp/shared';
import { WithIntl } from '@/test/intl';
import { DetailsStep } from './details-step';

vi.mock('@/lib/analytics', () => ({ track: vi.fn() }));

// The camera sheet has its own tests; here it only needs to hand back a photo.
vi.mock('./selfie-capture', () => ({
  SelfieCapture: ({ open, onCaptured, onOpenChange }: { open: boolean; onCaptured: (b: Blob) => void; onOpenChange: (o: boolean) => void }) =>
    open ? (
      <button
        type="button"
        onClick={() => {
          onCaptured(new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' }));
          onOpenChange(false);
        }}
      >
        Fake capture
      </button>
    ) : null,
}));

const REGISTRATIONS = '*/api/v1/registrations';
const server = setupServer();

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  URL.createObjectURL = vi.fn(() => 'blob:selfie');
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function renderStep() {
  const onRegistered = vi.fn();
  render(
    <WithIntl>
      <DetailsStep today={istDate('2026-09-11')} minAge={16} noticeVersion="1.0" termsHref="/legal/terms" privacyHref="/legal/privacy" onRegistered={onRegistered} />
    </WithIntl>,
  );
  return { onRegistered, user: userEvent.setup() };
}

async function fillValid(user: UserEvent, dob: [string, string, string] = ['12', '4', '1998']) {
  await user.type(screen.getByLabelText('Full name'), 'Priya Sharma');
  await user.type(screen.getByLabelText('Mobile number'), '9876543210');
  const dobGroup = screen.getByRole('group', { name: 'Date of birth' });
  await user.selectOptions(within(dobGroup).getByLabelText('Day'), dob[0]);
  await user.selectOptions(within(dobGroup).getByLabelText('Month'), dob[1]);
  await user.selectOptions(within(dobGroup).getByLabelText('Year'), dob[2]);
  await user.click(screen.getByRole('radio', { name: 'Female' }));
  await user.click(screen.getByRole('button', { name: /Take selfie/ }));
  await user.click(screen.getByRole('button', { name: 'Fake capture' }));
  await user.click(screen.getByRole('checkbox', { name: /I agree to the/ }));
}

const submit = () => screen.getByRole('button', { name: 'Continue to plans' });

describe('DetailsStep', () => {
  it('shows what is missing and sends nothing', async () => {
    let called = false;
    server.use(http.post(REGISTRATIONS, () => ((called = true), HttpResponse.json({}, { status: 201 }))));
    const { user } = renderStep();

    await user.click(submit());

    expect(await screen.findByText('Enter your full name, using letters only.')).toBeTruthy();
    expect(screen.getByText('Enter a 10-digit Indian mobile number.')).toBeTruthy();
    expect(screen.getByText('Choose your date of birth.')).toBeTruthy();
    expect(screen.getByText('Choose male or female.')).toBeTruthy();
    expect(screen.getByText('Add a selfie to continue.')).toBeTruthy();
    expect(screen.getByText('Please agree to the Terms and Privacy policy to continue.')).toBeTruthy();
    expect(called).toBe(false);
  });

  it('leaves face attendance off by default and unavailable to a minor, with the guardian note', async () => {
    const { user } = renderStep();
    const face = screen.getByRole<HTMLInputElement>('checkbox', { name: /automatic attendance/ });
    expect(face.checked).toBe(false);

    await user.click(face);
    expect(face.checked).toBe(true);

    const dobGroup = screen.getByRole('group', { name: 'Date of birth' });
    await user.selectOptions(within(dobGroup).getByLabelText('Day'), '1');
    await user.selectOptions(within(dobGroup).getByLabelText('Month'), '1');
    await user.selectOptions(within(dobGroup).getByLabelText('Year'), '2009');

    expect(face.checked).toBe(false);
    expect(face.disabled).toBe(true);
    expect(screen.getByText(/You're under 18/)).toBeTruthy();
  });

  it('refuses someone below the minimum age before sending', async () => {
    let called = false;
    server.use(http.post(REGISTRATIONS, () => ((called = true), HttpResponse.json({}, { status: 201 }))));
    const { user } = renderStep();

    await fillValid(user, ['1', '1', '2012']);
    await user.click(submit());

    expect(await screen.findByText(/at least 16 to join/)).toBeTruthy();
    expect(called).toBe(false);
  });

  it('sends the details, consents and selfie, then continues with the registration token', async () => {
    let received: FormData | null = null;
    server.use(
      http.post(REGISTRATIONS, async ({ request }) => {
        received = await request.formData();
        return HttpResponse.json(
          { data: { memberId: 'mem_1', registrationToken: 'tok_1', isMinor: false, possibleDuplicate: false } },
          { status: 201 },
        );
      }),
    );
    const { user, onRegistered } = renderStep();

    await fillValid(user);
    await user.click(screen.getByRole('checkbox', { name: /updates, receipts and reminders/ }));
    await user.click(submit());

    await vi.waitFor(() => expect(onRegistered).toHaveBeenCalled());
    const form = received as unknown as FormData;
    expect(Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === 'string'))).toEqual({
      fullName: 'Priya Sharma',
      mobile: '9876543210',
      // Email is optional and left empty, so no part is sent at all.
      dob: '1998-04-12',
      gender: 'FEMALE',
      language: 'en',
      consents: JSON.stringify({ terms: true, privacy: true, whatsappUpdates: true, faceAttendance: false }),
      noticeVersion: '1.0',
    });
    expect(form.get('selfie')).toBeInstanceOf(Blob);
    expect(onRegistered).toHaveBeenCalledWith({
      registrationToken: 'tok_1',
      firstName: 'Priya',
      gender: 'FEMALE',
      isMinor: false,
      whatsappUpdates: true,
    });
  });

  it('shows field errors and a refused photo from the server', async () => {
    server.use(
      http.post(REGISTRATIONS, () =>
        HttpResponse.json({ error: { code: 'SELFIE_REJECTED', message: 'x', details: { reason: 'too_small' } } }, { status: 422 }),
      ),
    );
    const { user } = renderStep();
    await fillValid(user);
    await user.click(submit());
    expect(await screen.findByText('That photo is too small. Move closer and take it again.')).toBeTruthy();

    server.use(
      http.post(REGISTRATIONS, () =>
        HttpResponse.json({ error: { code: 'VALIDATION_FAILED', message: 'x', details: { fields: { mobile: 'mobile' } } } }, { status: 400 }),
      ),
    );
    await user.click(submit());
    expect(await screen.findByText('Enter a 10-digit Indian mobile number.')).toBeTruthy();
  });

  it('says so when the connection fails or requests are limited', async () => {
    server.use(http.post(REGISTRATIONS, () => HttpResponse.json({ error: { code: 'RATE_LIMITED' } }, { status: 429 })));
    const { user } = renderStep();
    await fillValid(user);
    await user.click(submit());
    expect(await screen.findByText(/Too many attempts/)).toBeTruthy();

    server.use(http.post(REGISTRATIONS, () => HttpResponse.error()));
    await user.click(submit());
    expect(await screen.findByText(/You seem to be offline/)).toBeTruthy();
  });
});
