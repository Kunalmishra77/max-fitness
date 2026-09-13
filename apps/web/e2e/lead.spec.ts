import { expect, test } from '@playwright/test';

/**
 * Journey 2 (testing-strategy.md §3): lead form submit → success.
 *
 * The "CRM shows lead + call task" half needs the CRM, which arrives in Phase 4; the
 * lead, its owner alert and outbox event are covered by packages/core unit tests and
 * the db integration tests until then.
 *
 * A real submission writes a lead to the development database and counts against the
 * per-IP rate limit (10 per hour), so it runs in one project only.
 */

function testMobile(): string {
  // 9 followed by nine random digits: a valid Indian mobile, and unlikely to collide.
  return `9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
}

test.describe('lead form', () => {
  test('shows validation errors in place', async ({ page }) => {
    await page.goto('/');
    const form = page.getByRole('form', { name: 'Get a call back' });
    await form.getByRole('button', { name: 'Request a call back' }).click();
    await expect(form.getByText('Enter your name.')).toBeVisible();
    await expect(form.getByLabel('Your name')).toHaveAttribute('aria-invalid', 'true');
  });

  test('submits a lead and confirms it', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'Writes to the database; one project is enough.');

    await page.goto('/');
    const form = page.getByRole('form', { name: 'Get a call back' });
    await form.getByLabel('Your name').fill('E2E Test Lead');
    await form.getByLabel('Mobile number').fill(testMobile());
    await form.getByLabel('Your goal').selectOption('GET_FIT');

    // Faster than a person can type is treated as a bot (MIN_FORM_FILL_MS); wait like a person.
    await page.waitForTimeout(2_700);
    await form.getByRole('button', { name: 'Request a call back' }).click();

    // The first request to the route compiles it under `next dev`; allow for that.
    await expect(page.getByRole('status').filter({ hasText: 'Request sent' })).toBeVisible({ timeout: 45_000 });
  });
});
