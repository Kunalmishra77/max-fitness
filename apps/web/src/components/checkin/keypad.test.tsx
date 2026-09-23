import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { WithIntl } from '@/test/intl';
import { CheckInKeypad } from './keypad';

/**
 * The reception tablet's keypad (BR-9.4).
 *
 * This screen is used standing up, by somebody in a hurry, often with a queue behind
 * them — and by people who will never read an instruction. So it has to be forgiving:
 * big keys, one obvious next step, and it must never leave somebody staring at a
 * button that appears to have done nothing.
 */

const found = (over: Array<{ memberId: string; fullName: string; photoUrl: string | null }> = [{ memberId: 'mem_1', fullName: 'Sanjay Tomar', photoUrl: null }]) =>
  vi.fn().mockResolvedValue({ ok: true, candidates: over });

const marked = (greeting: unknown = { kind: 'WELCOME', tone: 'green' }, decision = 'RECORD') =>
  vi.fn().mockResolvedValue({ ok: true, decision, greeting, memberName: 'Sanjay Tomar' });

function keypad(over: { lookup?: ReturnType<typeof found>; mark?: ReturnType<typeof marked> } = {}) {
  const lookup = over.lookup ?? found();
  const mark = over.mark ?? marked();
  render(
    <WithIntl>
      <CheckInKeypad lookup={lookup} mark={mark} />
    </WithIntl>,
  );
  return { lookup, mark };
}

const type = async (digits: string) => {
  for (const digit of digits) await userEvent.click(screen.getByRole('button', { name: digit }));
};

describe('CheckInKeypad', () => {
  it('will not look anything up until a whole number has been typed', async () => {
    const { lookup } = keypad();

    const find = () => screen.getByRole<HTMLButtonElement>('button', { name: 'Find me' });

    await type('98765');
    expect(find().disabled).toBe(true);

    await type('43210');
    expect(find().disabled).toBe(false);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('marks a single member in with one more tap', async () => {
    const { lookup, mark } = keypad();

    await type('9876543210');
    await userEvent.click(screen.getByRole('button', { name: 'Find me' }));

    await waitFor(() => expect(lookup).toHaveBeenCalledWith('+919876543210'));
    await userEvent.click(await screen.findByRole('button', { name: /Sanjay Tomar/ }));

    await waitFor(() => expect(mark).toHaveBeenCalled());
    expect(mark.mock.calls[0]?.[0]).toBe('mem_1');
    expect(await screen.findByText('Welcome, Sanjay Tomar')).toBeTruthy();
  });

  it('offers every member on a family number rather than guessing', async () => {
    const { mark } = keypad({
      lookup: found([
        { memberId: 'mem_1', fullName: 'Sanjay Tomar', photoUrl: null },
        { memberId: 'mem_2', fullName: 'Kavita Tomar', photoUrl: null },
      ]),
    });

    await type('9876543210');
    await userEvent.click(screen.getByRole('button', { name: 'Find me' }));

    const list = await screen.findByRole('list');
    expect(within(list).getAllByRole('button')).toHaveLength(2);
    expect(mark).not.toHaveBeenCalled();
  });

  it('sends a member whose fees have run out to the desk, without naming a figure', async () => {
    keypad({ mark: marked({ kind: 'SEE_RECEPTION', tone: 'red' }) });

    await type('9876543210');
    await userEvent.click(screen.getByRole('button', { name: 'Find me' }));
    await userEvent.click(await screen.findByRole('button', { name: /Sanjay Tomar/ }));

    const message = await screen.findByRole('status');
    expect(message.textContent).toContain('Please see reception');
    expect(message.textContent).not.toMatch(/₹|\d{3,}/);
  });

  it('says so plainly when the number belongs to nobody', async () => {
    keypad({ lookup: found([]) });

    await type('9000000000');
    await userEvent.click(screen.getByRole('button', { name: 'Find me' }));

    expect(await screen.findByText('We could not find that number. Please see reception.')).toBeTruthy();
  });

  it('tells a member who is already marked in, instead of appearing to do nothing', async () => {
    keypad({ mark: marked(null, 'WITHIN_COOLDOWN') });

    await type('9876543210');
    await userEvent.click(screen.getByRole('button', { name: 'Find me' }));
    await userEvent.click(await screen.findByRole('button', { name: /Sanjay Tomar/ }));

    expect(await screen.findByText('You are already marked in today')).toBeTruthy();
  });

  it('lets a mistyped digit be taken back', async () => {
    keypad();

    await type('98765');
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));

    expect(screen.getByLabelText('Mobile number').textContent).toBe('9876');
  });
});
