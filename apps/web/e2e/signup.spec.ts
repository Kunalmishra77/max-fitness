import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

/**
 * Online sign-up journeys (testing-strategy.md §3), in DEMO_MODE with the simulated gateway.
 *
 * - Journey 3: fake camera → plan → simulated payment success → confirmation.
 * - Journey 4: camera denied → phone-camera file fallback → registration continues.
 * - Journey 5: payment failure → try again → pay at reception → reservation.
 *
 * The CRM halves of these journeys (member ACTIVE in the member list, the desk recording
 * a reception payment) arrive with the CRM in Phase 4.
 *
 * The camera is Chrome's fake device playing a drawn face (scripts/make-face-fixture.mjs),
 * never a photo of a person. Each journey registers a new member in the development
 * database and counts against the registration rate limit (10 per hour per IP), so the
 * journeys that only repeat the form run in one project.
 */

const FACE_VIDEO = fileURLToPath(new URL('./fixtures/face.y4m', import.meta.url));
const FACE_PHOTO = fileURLToPath(new URL('./fixtures/face.jpg', import.meta.url));

test.use({
  permissions: ['camera'],
  launchOptions: {
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-video-capture=${FACE_VIDEO}`],
  },
});

function testMobile(): string {
  return `9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
}

async function fillDetails(page: Page, selfie: 'camera' | 'file') {
  await page.getByLabel('Full name').fill('Esha Tester');
  await page.getByLabel('Mobile number').fill(testMobile());
  const dob = page.getByRole('group', { name: 'Date of birth' });
  await dob.getByLabel('Day').selectOption('15');
  await dob.getByLabel('Month').selectOption('6');
  await dob.getByLabel('Year').selectOption('1995');
  await page.getByText('Male', { exact: true }).click();

  await page.getByRole('button', { name: /Take selfie/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Take a selfie' });
  if (selfie === 'camera') {
    await sheet.getByRole('button', { name: 'Open camera' }).click();
    // The detector's WASM loads on first use; then the drawn face must hold in the oval.
    await expect(sheet.getByText('Face found')).toBeVisible({ timeout: 45_000 });
    await sheet.getByRole('button', { name: 'Take photo' }).click();
  } else {
    await expect(sheet.getByRole('button', { name: 'Use phone camera' })).toBeVisible();
    await sheet.locator('input[type=file]').setInputFiles(FACE_PHOTO);
  }
  await sheet.getByRole('button', { name: 'Use this photo' }).click();
  await expect(page.getByRole('img', { name: 'Your member photo' })).toBeVisible();

  await page.getByRole('checkbox', { name: /I agree to the/ }).check();
  await page.getByRole('checkbox', { name: /updates, receipts and reminders/ }).check();
  await page.getByRole('button', { name: 'Continue to plans' }).click();
}

test.describe('online sign-up', () => {
  test('journey 3: camera selfie, plan, simulated payment, confirmation', async ({ page }) => {
    await page.goto('/join?plan=M3_MALE');
    await expect(page.getByText('Step 1 of 3: Your details')).toBeVisible();

    await fillDetails(page, 'camera');

    await expect(page).toHaveURL(/\/join\/plan\?plan=M3_MALE$/);
    await expect(page.getByRole('radio', { name: /3 months/ })).toBeChecked();
    await expect(page.getByText(/^Ends on /)).toBeVisible();
    await page.getByRole('button', { name: 'Continue to payment' }).click();

    await expect(page).toHaveURL(/\/join\/pay$/);
    await page.getByRole('button', { name: /^Pay ₹/ }).click();
    const demo = page.getByRole('dialog', { name: 'Demo payment' });
    await demo.getByRole('button', { name: 'Simulate success' }).click();

    await expect(page).toHaveURL(/\/join\/done$/);
    await expect(page.getByRole('heading', { name: "You're a member, Esha." })).toBeVisible();
    await expect(page.getByText(/^Member code MF-\d{4}$/)).toBeVisible();
    await expect(page.getByText(/^Paid ₹[\d,]+, receipt MF\/\d{4}-\d{2}\/\d{6}$/)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Download receipt' })).toHaveAttribute('href', /\/r\/[\w-]+\.[\w-]+$/);
    await expect(page.getByText("We've sent this to your WhatsApp.")).toBeVisible();

    // A refresh keeps the confirmation: it is read back from the server, not from memory.
    await page.reload();
    await expect(page.getByRole('heading', { name: "You're a member, Esha." })).toBeVisible();

    // The receipt link opens the member's receipt, amount in words included.
    await page.getByRole('link', { name: 'Download receipt' }).click();
    await expect(page.getByRole('heading', { name: 'Payment receipt' })).toBeVisible();
    await expect(page.getByText(/^Amount in words: Rupees .+ Only$/)).toBeVisible();
    await expect(page.getByText('Demo payment (no money taken)')).toBeVisible();
  });

  test('journey 4: camera blocked, phone-camera photo instead', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'Writes to the database; one project is enough.');
    await page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = () => Promise.reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' }));
    });

    await page.goto('/join');
    await page.getByRole('button', { name: /Take selfie/ }).click();
    const sheet = page.getByRole('dialog', { name: 'Take a selfie' });
    await sheet.getByRole('button', { name: 'Open camera' }).click();
    await expect(sheet.getByText(/Camera access is blocked/)).toBeVisible();
    await sheet.getByRole('button', { name: 'Close' }).click();

    await fillDetails(page, 'file');
    await expect(page).toHaveURL(/\/join\/plan$/);
  });

  test('journey 5: payment fails, then the plan is reserved to pay at reception', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'Writes to the database; one project is enough.');

    await page.goto('/join?plan=M1_MALE');
    await fillDetails(page, 'file');
    await page.getByRole('button', { name: 'Continue to payment' }).click();

    await page.getByRole('button', { name: /^Pay ₹/ }).click();
    await page.getByRole('dialog', { name: 'Demo payment' }).getByRole('button', { name: 'Simulate failure' }).click();
    await expect(page.getByText("Payment didn't go through")).toBeVisible();

    await page.getByRole('button', { name: 'Try again' }).click();
    await page.getByRole('dialog', { name: 'Demo payment' }).getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: 'Pay at reception' }).click();

    await expect(page).toHaveURL(/\/join\/done$/);
    await expect(page.getByRole('heading', { name: 'Your plan is reserved, Esha.' })).toBeVisible();
    await expect(page.getByText(/^Pay ₹[\d,]+ at reception by .+ to start\.$/)).toBeVisible();
  });
});
