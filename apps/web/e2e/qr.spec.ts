import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

/**
 * Journey 7 (testing-strategy §3; qr-onboarding-flow §3; ADR-058): an existing member
 * scans the reception QR, sends their details with the month-end date, shows the code,
 * and reception approves it from the verify queue.
 *
 * Each run uses a fresh name and number, so it never collides with a member already
 * there. The selfie goes through the phone-camera file input with a drawn face.
 */

const FACE_PHOTO = fileURLToPath(new URL('./fixtures/face.jpg', import.meta.url));
const RECEPTION = { mobile: '9000000002', pin: '1357' };

function letters(length: number): string {
  return Array.from({ length }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join('');
}

/** A date a few weeks out, in IST, as the date input wants it. */
function inThreeWeeks(): string {
  const ist = new Date(Date.now() + 5.5 * 3_600_000 + 21 * 86_400_000);
  return ist.toISOString().slice(0, 10);
}

test('an existing member sends their details by QR and reception approves them', async ({ page }) => {
  const name = `Qr ${letters(1).toUpperCase()}${letters(6)}`;
  const mobile = `8${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;

  await page.goto('/qr');
  await page.getByRole('link', { name: /I am already a member/ }).click();
  await expect(page.getByText('Question 1 of 9')).toBeVisible();

  const next = () => page.getByRole('button', { name: 'Next' }).click();
  await page.getByLabel('Mobile number').fill(mobile);
  await next();
  await page.getByLabel('Full name').fill(name);
  await next();
  await page.getByRole('button', { name: 'Man' }).click();
  await next();
  await page.getByLabel('Day').fill('14');
  await page.getByLabel('Month').fill('02');
  await page.getByLabel('Year').fill('1990');
  await next();

  await page.getByRole('button', { name: 'Take selfie' }).click();
  const sheet = page.getByRole('dialog', { name: 'Take a selfie' });
  await sheet.locator('input[type=file]').setInputFiles(FACE_PHOTO);
  await sheet.getByRole('button', { name: 'Use this photo' }).click();
  await next();

  await page.getByRole('button', { name: '3 months' }).click();
  await next();
  await page.getByLabel('Fees paid until').fill(inThreeWeeks());
  await next();
  await page.getByLabel('Amount in rupees (optional)').fill('4000');
  await next();
  await page.getByText('I agree to the Terms of membership and Privacy policy.').click();
  await page.getByRole('button', { name: 'Send to reception' }).click();

  await expect(page).toHaveURL(/\/qr\/done\/Q-\d{4}$/, { timeout: 30_000 });
  const code = page.url().split('/').pop() ?? '';
  await expect(page.getByText(code)).toBeVisible();

  // The desk: reception finds the code in the queue and approves the date the member gave.
  await page.goto('/crm/login');
  await page.getByLabel('मोबाइल नंबर').fill(RECEPTION.mobile);
  await page.getByLabel('PIN').fill(RECEPTION.pin);
  await page.getByRole('button', { name: 'लॉगिन करें' }).click();
  await expect(page).toHaveURL(/\/crm$/);

  await page.goto('/crm/verify');
  const card = page.getByRole('article', { name });
  await expect(card).toBeVisible();
  await expect(card.getByText(code)).toBeVisible();
  // Only the last digits of the number are shown to the desk.
  await expect(card.getByText(mobile)).toHaveCount(0);

  await card.getByRole('button', { name: '✓ सही है' }).click();
  await expect(card.getByRole('status')).toHaveText('मंज़ूर — मेंबरशिप चालू।');

  await page.reload();
  await expect(page.getByRole('article', { name })).toHaveCount(0);
});
