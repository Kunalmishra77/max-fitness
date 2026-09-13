import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * Sign-up as a modal over the landing page (wireframes "Sign-up modal"; ADR-036).
 *
 * The same URLs render as full pages when opened directly, which journeys 3–5 cover;
 * here the point is that tapping "Sign up" never leaves the page behind, and that the
 * three steps stay in the sheet until the confirmation.
 */

const FACE_PHOTO = fileURLToPath(new URL('./fixtures/face.jpg', import.meta.url));

function testMobile(): string {
  return `9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
}

const openSignUp = async (page: Page) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Sign up' }).first().click();
  await expect(page).toHaveURL(/\/join$/);
  return page.getByRole('dialog');
};

test.describe('sign-up modal', () => {
  test('opens over the landing page, and the same URL opened directly is a full page', async ({ page }) => {
    const dialog = await openSignUp(page);

    await expect(dialog.getByText('Step 1 of 3: Your details')).toBeVisible();
    // The landing page is still there behind the sheet.
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();

    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page).toHaveURL(/\/$/);

    await page.goto('/join');
    await expect(page.getByText('Step 1 of 3: Your details')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('carries the chosen plan and runs the steps in the sheet up to the confirmation', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'Writes to the database; one project is enough.');

    await page.goto('/');
    await page.getByRole('link', { name: /^Choose 3 months/ }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Step 1 of 3: Your details')).toBeVisible();

    await dialog.getByLabel('Full name').fill('Manish Modal');
    await dialog.getByLabel('Mobile number').fill(testMobile());
    const dob = dialog.getByRole('group', { name: 'Date of birth' });
    await dob.getByLabel('Day').selectOption('8');
    await dob.getByLabel('Month').selectOption('3');
    await dob.getByLabel('Year').selectOption('1994');
    await dialog.getByText('Male', { exact: true }).click();
    await dialog.getByRole('button', { name: /Take selfie/ }).click();
    const sheet = page.getByRole('dialog', { name: 'Take a selfie' });
    await sheet.locator('input[type=file]').setInputFiles(FACE_PHOTO);
    await sheet.getByRole('button', { name: 'Use this photo' }).click();
    await dialog.getByRole('checkbox', { name: /I agree to the/ }).check();
    await dialog.getByRole('button', { name: 'Continue to plans' }).click();

    // Step 2, still in the sheet, with the plan chosen on the landing page.
    await expect(page).toHaveURL(/\/join\/plan\?plan=M3_MALE$/);
    await expect(dialog.getByText('Step 2 of 3: Choose your plan')).toBeVisible();
    await expect(dialog.getByRole('radio', { name: /3 months/ })).toBeChecked();
    await dialog.getByRole('button', { name: 'Continue to payment' }).click();

    await expect(dialog.getByText('Step 3 of 3: Payment')).toBeVisible();
    await dialog.getByRole('button', { name: /^Pay ₹/ }).click();
    await page.getByRole('dialog', { name: 'Demo payment' }).getByRole('button', { name: 'Simulate success' }).click();

    // The confirmation stays in the sheet, over the landing page.
    await expect(page).toHaveURL(/\/join\/done$/);
    await expect(dialog.getByRole('heading', { name: "You're a member, Manish." })).toBeVisible();
    await expect(dialog.getByRole('link', { name: 'Download receipt' })).toBeVisible();

    // Opened directly, the same confirmation is a full page.
    await page.reload();
    await expect(page.getByRole('heading', { name: "You're a member, Manish." })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('has no detectable accessibility violations while open', async ({ page }) => {
    await openSignUp(page);
    await page.addStyleTag({ content: '.deferred-render { content-visibility: visible !important; }' });

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .exclude('video')
      .analyze();

    expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
  });
});
