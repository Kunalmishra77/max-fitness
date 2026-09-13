import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { issueToken } from '@mfp/core';
import { systemClock } from '@mfp/shared';

/**
 * Journey 6 (testing-strategy.md §3): renew link → pay.
 *
 * Renew links are sent by the reminder engine (Phase 6), so this test mints one itself
 * with the server's LINK_TOKEN_SECRET, for a member it first signs up and pays for
 * through the public API. The "reminders timeline shows no further messages" half
 * arrives with the reminder engine.
 */

const FACE_PHOTO = fileURLToPath(new URL('./fixtures/face.jpg', import.meta.url));

try {
  process.loadEnvFile(fileURLToPath(new URL('../../../.env', import.meta.url)));
} catch {
  // CI provides the environment directly.
}

function testMobile(): string {
  return `9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
}

/** A new member, signed up and paid for through the same API the sign-up pages use. */
async function paidMember(request: APIRequestContext): Promise<string> {
  const registration = await request.post('/api/v1/registrations', {
    multipart: {
      fullName: 'Ravi Renewer',
      mobile: testMobile(),
      dob: '1990-02-10',
      gender: 'MALE',
      language: 'en',
      consents: JSON.stringify({ terms: true, privacy: true, whatsappUpdates: true, faceAttendance: false }),
      noticeVersion: '1.0',
      selfie: { name: 'selfie.jpg', mimeType: 'image/jpeg', buffer: await readFile(FACE_PHOTO) },
    },
  });
  expect(registration.status()).toBe(201);
  const { memberId, registrationToken } = ((await registration.json()) as { data: { memberId: string; registrationToken: string } }).data;
  const auth = { 'x-registration-token': registrationToken };

  const plans = ((await (await request.get('/api/v1/plans?gender=MALE')).json()) as { data: { plans: { MALE: { cards: Array<{ planId: string; durationMonths: number }> } } } }).data;
  const monthly = plans.plans.MALE.cards.find((card) => card.durationMonths === 1);
  expect(monthly).toBeDefined();

  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  const order = await request.post('/api/v1/checkout/orders', { headers: auth, data: { planId: monthly?.planId, startDate: today } });
  expect(order.status()).toBe(201);
  const { orderId } = ((await order.json()) as { data: { orderId: string } }).data;

  const simulated = await request.post('/api/v1/checkout/simulate', { headers: auth, data: { providerOrderId: orderId, outcome: 'success' } });
  const callback = ((await simulated.json()) as { data: Record<string, string> }).data;
  const verified = await request.post('/api/v1/checkout/verify', { data: callback });
  expect(((await verified.json()) as { data: { status: string } }).data.status).toBe('PAID');

  return memberId;
}

test('journey 6: a renew link offers the chained start date and renews the membership', async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Writes to the database; one project is enough.');
  const secret = process.env['LINK_TOKEN_SECRET'];
  test.skip(secret === undefined || secret === '', 'LINK_TOKEN_SECRET is needed to mint a renew link.');

  const memberId = await paidMember(request);
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
