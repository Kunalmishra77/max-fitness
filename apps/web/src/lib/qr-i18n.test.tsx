import { NextIntlClientProvider } from 'next-intl';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import en from '../../messages/en.json';
import hi from '../../messages/hi.json';
import { QrExistingForm } from '@/components/qr/qr-existing-form';
import { qrClientMessages } from './qr-i18n';

/**
 * The QR pages choose which catalogues reach the browser, so a form on one of them can
 * only be read if its catalogue was chosen. It was not: production showed a member
 * "qrExisting.fields.fullName" where the question should have been.
 *
 * The other form tests wrap themselves in the whole catalogue, which no page does — so
 * they cannot see this. These render through the same picking the page performs.
 */

function renderForm(catalogue: Record<string, unknown>) {
  return render(
    <NextIntlClientProvider locale="en" messages={qrClientMessages(catalogue)} timeZone="Asia/Kolkata" onError={() => {}}>
      <QrExistingForm
        today="2026-09-24"
        minAge={16}
        noticeVersion="1.0"
        termsHref="/legal/terms"
        privacyHref="/legal/privacy"
        submit={() => Promise.resolve({ ok: true, referenceCode: 'Q-1' })}
        onSubmitted={() => {}}
        Camera={() => null}
      />
    </NextIntlClientProvider>,
  );
}

describe('the catalogues a QR page sends to the browser', () => {
  it('lets an English member read every question, rather than its key', () => {
    renderForm(en);

    // The form asks one question at a time now, so this checks the screen it opens on —
    // enough to catch the catalogue going missing, which is what this test is for.
    expect(screen.getByText('Full name')).toBeTruthy();
    expect(screen.getByText('Mobile number')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Next' })).toBeTruthy();
  });

  it('leaves no key showing in either language', () => {
    for (const catalogue of [en, hi]) {
      const { unmount } = renderForm(catalogue);
      expect(document.body.textContent).not.toMatch(/qrExisting\./);
      unmount();
    }
  });
});
