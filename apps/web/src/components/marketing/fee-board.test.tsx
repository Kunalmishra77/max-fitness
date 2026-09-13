import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { WithIntl } from '@/test/intl';
import { FeeBoard, type FeeRow } from './fee-board';

const men: FeeRow[] = [
  { code: 'MALE_1M', months: 1, price: '₹1,200', perMonth: '₹1,200', saving: null, bestValue: false },
  { code: 'MALE_12M', months: 12, price: '₹10,000', perMonth: '₹830', saving: '₹4,400', bestValue: true },
];

const women: FeeRow[] = [
  { code: 'FEMALE_1M', months: 1, price: '₹1,000', perMonth: '₹1,000', saving: null, bestValue: false },
  { code: 'FEMALE_12M', months: 12, price: '₹8,000', perMonth: '₹670', saving: '₹4,000', bestValue: true },
];

function renderBoard() {
  render(
    <WithIntl>
      <FeeBoard men={men} women={women} />
    </WithIntl>,
  );
  return { table: screen.getByRole('table'), user: userEvent.setup() };
}

describe('FeeBoard', () => {
  it("shows men's prices first", () => {
    const { table } = renderBoard();
    expect(screen.getByRole('radio', { name: 'Men' }).getAttribute('aria-checked')).toBe('true');
    // A monthly plan's price and per-month figure are the same amount, so it appears twice.
    expect(within(table).getAllByText('₹1,200')).toHaveLength(2);
    expect(within(table).queryByText('₹1,000')).toBeNull();
  });

  it("switches to women's prices and back", async () => {
    const { table, user } = renderBoard();

    await user.click(screen.getByRole('radio', { name: 'Women' }));
    expect(screen.getByRole('radio', { name: 'Women' }).getAttribute('aria-checked')).toBe('true');
    expect(within(table).getAllByText('₹1,000')).toHaveLength(2);
    expect(within(table).queryByText('₹1,200')).toBeNull();

    await user.click(screen.getByRole('radio', { name: 'Men' }));
    expect(within(table).getAllByText('₹1,200')).toHaveLength(2);
  });

  it('keeps a set selected when the active option is pressed again', async () => {
    const { table, user } = renderBoard();
    await user.click(screen.getByRole('radio', { name: 'Women' }));
    await user.click(screen.getByRole('radio', { name: 'Women' }));
    expect(screen.getByRole('radio', { name: 'Women' }).getAttribute('aria-checked')).toBe('true');
    expect(within(table).getByText('₹8,000')).toBeTruthy();
  });

  it('marks exactly one best-value plan', () => {
    const { table } = renderBoard();
    expect(within(table).getAllByText('Best value')).toHaveLength(1);
  });

  it('links each Choose button to sign-up with the plan code', async () => {
    const { table, user } = renderBoard();
    const choose = within(table).getByRole('link', { name: 'Choose 12 months for ₹10,000' });
    expect(choose.getAttribute('href')).toBe('/join?plan=MALE_12M');

    await user.click(screen.getByRole('radio', { name: 'Women' }));
    expect(within(table).getByRole('link', { name: 'Choose Monthly for ₹1,000' }).getAttribute('href')).toBe(
      '/join?plan=FEMALE_1M',
    );
  });
});
