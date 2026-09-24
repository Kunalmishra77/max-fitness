import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { waitForHydration } from './hydration';

/**
 * Journey 7 (testing-strategy §3; qr-onboarding-flow §3; ADR-058, ADR-074, ADR-075):
 * an existing member scans the reception QR, fills one page — including both sides of
 * an Aadhaar — shows the code, and reception looks at the card and approves.
 *
 * Each run uses a fresh name and number, so it never collides with a member already
 * there. The selfie and the ID photographs go through the phone-camera file inputs.
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

test('an existing member sends one page of details by QR and reception approves them', async ({ page }) => {
  const name = `Qr ${letters(1).toUpperCase()}${letters(6)}`;
  const mobile = `8${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;

  await page.goto('/qr');
  await page.getByRole('link', { name: /I am already a member/ }).click();
  await waitForHydration(page);
  // One page, not nine questions (ADR-075).
  await expect(page.getByText(/Question \d of \d/)).toHaveCount(0);

  await page.getByLabel('Full name').fill(name);
  await page.getByLabel('Mobile number').fill(mobile);
  await page.getByLabel('Date of birth').fill('1990-02-14');
  // The radio itself is screen-reader only; the label is what a finger lands on.
  await page.getByText('Male', { exact: true }).click();
  await page.getByLabel('Joining date').fill('2019-04-15');

  await page.getByRole('button', { name: 'Take your photo' }).click();
  const sheet = page.getByRole('dialog', { name: 'Take a selfie' });
  await sheet.locator('input[type=file]').setInputFiles(FACE_PHOTO);
  await sheet.getByRole('button', { name: 'Use this photo' }).click();

  await page.getByText('3 months', { exact: true }).click();
  await page.getByLabel('Fees paid until').fill(inThreeWeeks());

  // The ID is photographs only — there is no field anywhere for the number (ADR-074).
  await page.getByLabel('Which ID are you showing?').selectOption('AADHAAR');
  await expect(page.getByLabel(/Aadhaar number|ID number/)).toHaveCount(0);
  await page.getByLabel('Photo of the front').setInputFiles(FACE_PHOTO);
  await page.getByLabel('Photo of the back').setInputFiles(FACE_PHOTO);

  await page.getByRole('checkbox', { name: /I agree to the Terms/ }).check();
  await page.getByRole('button', { name: 'Send to reception' }).click();

  await expect(page).toHaveURL(/\/qr\/done\/Q-\d{4}$/, { timeout: 30_000 });
  const code = page.url().split('/').pop() ?? '';
  await expect(page.getByText(code)).toBeVisible();

  // The desk: reception finds the code, looks at the ID, and approves the date given.
  await page.goto('/crm/login');
  await waitForHydration(page);
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
  // Both sides of the card reached the person who has to check it (ADR-077).
  await expect(card.getByRole('img', { name: 'आधार — आगे' })).toBeVisible();
  await expect(card.getByRole('img', { name: 'आधार — पीछे' })).toBeVisible();
  await expect(card.getByText('जॉइन किया')).toBeVisible();

  await card.getByRole('button', { name: '✓ सही है' }).click();
  await expect(card.getByRole('status')).toHaveText('मंज़ूर — मेंबरशिप चालू।');

  await page.reload();
  await expect(page.getByRole('article', { name })).toHaveCount(0);

  // And the photographs are still reachable afterwards, on the member's own page.
  await page.goto('/crm/members');
  await page.getByRole('link', { name: new RegExp(name) }).first().click();
  await expect(page.getByRole('heading', { name: 'फ़ाइल पर ID' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'आधार — आगे' })).toBeVisible();
});

test('someone new joins from the QR and pays at the desk, with no checkout offered', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Writes to the database; one project is enough.');
  const mobile = `8${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;

  await page.goto('/qr');
  await page.getByRole('link', { name: /I am new here/ }).click();
  await expect(page).toHaveURL(/\/qr\/new$/);
  await waitForHydration(page);

  // The gym before the form: somebody who just scanned a poster knows nothing (ADR-075).
  await expect(page.getByText('For men')).toBeVisible();
  await expect(page.getByText(/pay at reception/i).first()).toBeVisible();

  await page.getByLabel('Full name').fill('Qr Newcomer');
  await page.getByLabel('Mobile number').fill(mobile);
  const dob = page.getByRole('group', { name: 'Date of birth' });
  await dob.getByLabel('Day').selectOption('15');
  await dob.getByLabel('Month').selectOption('6');
  await dob.getByLabel('Year').selectOption('1995');
  await page.getByText('Male', { exact: true }).click();
  await page.getByRole('button', { name: /Take selfie/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Take a selfie' });
  await sheet.locator('input[type=file]').setInputFiles(FACE_PHOTO);
  await sheet.getByRole('button', { name: 'Use this photo' }).click();
  await page.getByRole('checkbox', { name: /I agree to the/ }).check();
  await page.getByRole('button', { name: 'Continue to plans' }).click();

  await expect(page).toHaveURL(/\/join\/plan$/);
  await page.getByRole('radio').first().check();
  await page.getByRole('button', { name: 'Continue to payment' }).click();

  // The gym has no live gateway, so the QR path offers the desk and nothing else (ADR-076).
  await expect(page).toHaveURL(/\/join\/pay$/);
  await expect(page.getByRole('button', { name: /^Pay ₹/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Pay at reception' }).click();

  await expect(page).toHaveURL(/\/join\/done$/);
  await expect(page.getByRole('heading', { name: 'Your plan is reserved, Qr.' })).toBeVisible();
});
