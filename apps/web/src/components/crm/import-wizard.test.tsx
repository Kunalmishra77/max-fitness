import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ImportCommitResult, ImportPreviewResult } from '@/lib/import-types';
import { WithIntl } from '@/test/intl';
import { ImportWizard } from './import-wizard';

/**
 * Importing the paper register at the desk (crm-module-spec §7; ADR-056).
 *
 * The owner chooses the CSV and sees, before anything is saved, how many members it
 * adds, who is already here, and each line that needs fixing. Adding them takes the
 * PIN, and the owner says in the same place whether these members agreed to WhatsApp.
 */

const CSV = 'full_name,mobile,gender,month_end_date\nSanjay Tomar,9876543210,M,30-09-2026\n';

const clean: ImportPreviewResult = {
  ok: true,
  summary: { rows: 3, ready: 2, skipped: 1, withErrors: 0 },
  problems: [{ line: 2, name: 'Sanjay Tomar', errors: [], warnings: ['already_member'] }],
  hiddenProblems: 0,
};

function renderWizard(preview: ImportPreviewResult = clean, commit: ImportCommitResult = { ok: true, created: 2, skipped: 1 }) {
  const previewAction = vi.fn<(csv: string) => Promise<ImportPreviewResult>>().mockResolvedValue(preview);
  const commitAction = vi.fn<(csv: string, deskConsent: boolean, pin: string) => Promise<ImportCommitResult>>().mockResolvedValue(commit);
  render(
    <WithIntl>
      <ImportWizard preview={previewAction} commit={commitAction} />
    </WithIntl>,
  );
  return { previewAction, commitAction, user: userEvent.setup() };
}

const file = (text: string, name = 'register.csv') => new File([text], name, { type: 'text/csv' });

describe('ImportWizard', () => {
  it('checks the file first and lists each line that needs a look, without saving anything', async () => {
    const { previewAction, commitAction, user } = renderWizard({
      ok: true,
      summary: { rows: 4, ready: 2, skipped: 1, withErrors: 1 },
      problems: [
        { line: 5, name: null, errors: ['mobile', 'month_end_date'], warnings: [] },
        { line: 2, name: 'Sanjay Tomar', errors: [], warnings: ['already_member'] },
      ],
      hiddenProblems: 0,
    });

    await user.upload(screen.getByLabelText('Choose the CSV file'), file(CSV));

    await waitFor(() => expect(previewAction).toHaveBeenCalledWith(CSV));
    expect(await screen.findByText('2 ready to add')).toBeTruthy();
    // The result has a name of its own; only the file input answers to the file label.
    expect(screen.getByRole('region', { name: 'File check' })).toBeTruthy();
    expect(screen.getAllByLabelText('Choose the CSV file')).toHaveLength(1);
    expect(screen.getByText('1 already members')).toBeTruthy();
    expect(screen.getByText('1 line has mistakes')).toBeTruthy();
    expect(screen.getByText('Line 5')).toBeTruthy();
    expect(screen.getByText('Mobile, Fee end date')).toBeTruthy();
    expect(screen.getByText('Already a member — will be skipped')).toBeTruthy();
    // With a mistake in the file there is nothing to confirm, only a file to fix.
    expect(screen.getByText('Fix these lines in the file and choose it again.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Add \d+ member/ })).toBeNull();
    expect(commitAction).not.toHaveBeenCalled();
  });

  it('adds the members with the PIN, saying whether they agreed to WhatsApp at the desk', async () => {
    const { commitAction, user } = renderWizard();

    await user.upload(screen.getByLabelText('Choose the CSV file'), file(CSV));
    const add = await screen.findByRole('button', { name: 'Add 2 members' });
    expect((add as HTMLButtonElement).disabled).toBe(true);

    await user.click(screen.getByLabelText('These members agreed at the desk to WhatsApp reminders'));
    await user.type(screen.getByLabelText('Enter your PIN'), '2468');
    await user.click(add);

    await waitFor(() => expect(commitAction).toHaveBeenCalledWith(CSV, true, '2468'));
    expect(await screen.findByText('2 members added')).toBeTruthy();
    expect(screen.getByText('1 was already a member and was left alone')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'See the member list' }).getAttribute('href')).toBe('/crm/members');
  });

  it('does not send a file over 1 MB', async () => {
    const { previewAction, user } = renderWizard();

    await user.upload(screen.getByLabelText('Choose the CSV file'), file('x'.repeat(1024 * 1024 + 1)));

    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'The file is larger than 1 MB.');
    expect(previewAction).not.toHaveBeenCalled();
  });

  it('names the columns a file is missing', async () => {
    const { user } = renderWizard({ ok: false, code: 'missing_columns', missing: ['mobile', 'month_end_date'] });

    await user.upload(screen.getByLabelText('Choose the CSV file'), file('name\nSanjay\n'));

    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'These columns are missing: mobile, month_end_date');
  });

  it('says so when the PIN is wrong, and clears it', async () => {
    const { user } = renderWizard(clean, { ok: false, code: 'INVALID_PIN' });

    await user.upload(screen.getByLabelText('Choose the CSV file'), file(CSV));
    await user.type(await screen.findByLabelText('Enter your PIN'), '9999');
    await user.click(screen.getByRole('button', { name: 'Add 2 members' }));

    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'That PIN is wrong.');
    expect((screen.getByLabelText('Enter your PIN') as HTMLInputElement).value).toBe('');
  });
});
