import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SelfieCaptureProps } from '@/components/join/selfie-capture';
import { WithIntl } from '@/test/intl';
import { AddMemberFlow, type AddMemberFields, type AddMemberResult } from './add-member-flow';

/**
 * The desk's add-member wizard, photo step (crm-ux-blueprint §7).
 *
 * Staff photograph the member with the phone's back camera, see the photo, and it goes
 * with the member in the same save. The photo stays skippable — a camera that will not
 * open must never stop someone joining — and a photo the server refuses sends staff back
 * to take another, not to a dead end.
 */

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

const photo = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' });

/** Stands in for the camera sheet, and says which camera and words it was asked for. */
function FakeCamera({ open, onCaptured, onOpenChange, facing, namespace }: SelfieCaptureProps) {
  if (!open) return null;
  return (
    <button
      type="button"
      onClick={() => {
        onCaptured(photo);
        onOpenChange(false);
      }}
    >
      {`fake camera ${facing ?? 'user'} ${namespace ?? 'signup.camera'}`}
    </button>
  );
}

beforeEach(() => {
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:desk-photo'), revokeObjectURL: vi.fn() }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

type Action = (fields: AddMemberFields, photo: FormData | null) => Promise<AddMemberResult>;

function renderFlow(result: AddMemberResult = { ok: true, memberId: 'mem_1', possibleDuplicate: false }) {
  const action = vi.fn<Action>().mockResolvedValue(result);
  render(
    <WithIntl>
      <AddMemberFlow action={action} Camera={FakeCamera} />
    </WithIntl>,
  );
  return { action, user: userEvent.setup() };
}

async function answerTheRest(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Full name'), 'Asha Rani');
  await user.click(screen.getByRole('button', { name: 'Next' }));
  await user.type(screen.getByLabelText('Mobile number'), '9812345670');
  await user.click(screen.getByRole('button', { name: 'Next' }));
  await user.click(screen.getByRole('button', { name: 'Man' }));
  await user.click(screen.getByRole('button', { name: 'Next' }));
  await user.type(screen.getByLabelText('Day'), '05');
  await user.type(screen.getByLabelText('Month'), '05');
  await user.type(screen.getByLabelText('Year'), '1995');
  await user.click(screen.getByRole('button', { name: 'Next' }));
  await user.click(screen.getByText('The member has heard the terms and the privacy notice'));
  await user.click(screen.getByRole('button', { name: 'Add member' }));
}

describe('AddMemberFlow — photo', () => {
  it('takes the photo with the back camera, shows it, and sends it with the member', async () => {
    const { action, user } = renderFlow();
    expect(screen.getByRole('button', { name: 'Not now' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Take photo' }));
    await user.click(screen.getByRole('button', { name: 'fake camera environment crm.add.camera' }));

    expect(screen.getByRole('img', { name: 'Photo taken' }).getAttribute('src')).toBe('blob:desk-photo');
    expect(screen.getByRole('button', { name: 'Retake' })).toBeTruthy();
    // With a photo in hand, the step is answered rather than skipped.
    expect(screen.queryByRole('button', { name: 'Not now' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Next' }));

    await answerTheRest(user);

    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    const [fields, form] = action.mock.calls[0] ?? [];
    expect(fields).toMatchObject({ fullName: 'Asha Rani', gender: 'MALE', dob: '1995-05-05', terms: true });
    expect(form).toBeInstanceOf(FormData);
    expect((form?.get('photo') as Blob | null)?.size).toBe(photo.size);
  });

  it('adds the member without a photo when staff skip it', async () => {
    const { action, user } = renderFlow();

    await user.click(screen.getByRole('button', { name: 'Not now' }));
    await answerTheRest(user);

    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    expect(action.mock.calls[0]?.[1]).toBeNull();
  });

  it('goes back to the photo, empty, when the server cannot use it', async () => {
    const { user } = renderFlow({ ok: false, code: 'photo' });

    await user.click(screen.getByRole('button', { name: 'Take photo' }));
    await user.click(screen.getByRole('button', { name: /fake camera/ }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await answerTheRest(user);

    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'That photo could not be used. Take it again, or skip it for now.');
    expect(screen.getByRole('button', { name: 'Take photo' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Not now' })).toBeTruthy();
  });
});
