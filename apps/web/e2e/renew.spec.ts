import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { issueToken } from '@mfp/core';
import { systemClock } from '@mfp/shared';
import { paidMember } from './paid-member';

/**
 * Journey 6 (testing-strategy.md §3): renew link → pay.
 *
 * Renew links are sent by the reminder engine (Phase 6), so this test mints one itself
 * with the server's LINK_TOKEN_SECRET, for a member it first signs up and pays for
 * through the public API. The "reminders timeline shows no further messages" half
 * arrives with the reminder engine.
 */

try {
  process.loadEnvFile(fileURLToPath(new URL('../../../.env', import.meta.url)));
} catch {
  // CI provides the environment directly.
}

test('journey 6: a renew link offers the chained start date and renews the membership', async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Writes to the database; one project is enough.');
  const secret = process.env['LINK_TOKEN_SECRET'];
  test.skip(secret === undefined || secret === '', 'LINK_TOKEN_SECRET is needed to mint a renew link.');

  const { memberId } = await paidMember(request);
  const token = issueToken({ purpose: 'renew', subject: memberId, ttlSeconds: 3_600, secret: secret ?? '', clock: systemClock });

  await page.goto(`/renew/${token}`);
  await expect(page.getByRole('heading', { name: 'Renew your membership, Ravi' })).toBeVisible();
  // Renewing while still active chains on from the current end date (BR-3.4).
  await expect(page.getByText(/^Current plan ends on .+\. Your new plan starts on .+\.$/)).toBeVisible();
  await expect(page.getByLabel('Start date')).toHaveCount(0);
  // The member's selfie is served through the signed-URL file route.
  const photo = page.getByRole('img', { name: 'Your member photo' });
  await expect(photo).toBeVisible();
  const photoUrl = await photo.getAttribute('src');
  expect(photoUrl).toContain('/api/v1/files?key=selfies%2F');
  expect((await page.request.get(photoUrl ?? '')).status()).toBe(200);

  await page.getByRole('radio', { name: /3 months/ }).check();
  await page.getByRole('button', { name: 'Continue to payment' }).click();
  await page.getByRole('button', { name: /^Pay ₹/ }).click();
  await page.getByRole('dialog', { name: 'Demo payment' }).getByRole('button', { name: 'Simulate success' }).click();

  await expect(page.getByRole('heading', { name: "You're a member, Ravi." })).toBeVisible();
  await expect(page.getByText(/^Paid ₹[\d,]+, receipt MF\/\d{4}-\d{2}\/\d{6}$/)).toBeVisible();

  // A link with the wrong purpose, or tampered with, gets the plain expired message.
  await page.goto(`/renew/${token}x`);
  await expect(page.getByText("This renewal link has expired. Message us on WhatsApp and we'll send a new one.")).toBeVisible();
});
