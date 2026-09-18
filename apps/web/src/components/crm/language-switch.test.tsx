import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { WithIntl } from '@/test/intl';
import { LanguageSwitch } from './language-switch';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

/** Hindi or English for Max Register, one tap, remembered for the person (ADR-062). */
describe('LanguageSwitch', () => {
  it('shows which language is on and switches to the other', async () => {
    const change = vi.fn<(language: string) => Promise<void>>().mockResolvedValue();
    render(
      <WithIntl>
        <LanguageSwitch current="hi" change={change} />
      </WithIntl>,
    );

    expect(screen.getByRole('button', { name: 'हिंदी' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'English' }).getAttribute('aria-pressed')).toBe('false');

    await userEvent.setup().click(screen.getByRole('button', { name: 'English' }));

    await waitFor(() => expect(change).toHaveBeenCalledWith('en'));
    expect(refresh).toHaveBeenCalled();
  });

  it('does nothing when the current language is tapped again', async () => {
    const change = vi.fn<(language: string) => Promise<void>>().mockResolvedValue();
    render(
      <WithIntl>
        <LanguageSwitch current="en" change={change} />
      </WithIntl>,
    );
    await userEvent.setup().click(screen.getByRole('button', { name: 'English' }));
    expect(change).not.toHaveBeenCalled();
  });
});
