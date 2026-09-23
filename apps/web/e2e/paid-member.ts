import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, type APIRequestContext } from '@playwright/test';

/**
 * A real, paid-up member, created through the same public API the sign-up pages use.
 *
 * Shared by the journeys that need somebody to act on rather than something to click:
 * the renew link (journey 6) and the reminder plan (journey 8). Going through the API
 * rather than the UI keeps those tests about what they are testing, and the member is
 * as real as one who signed up in a browser.
 */

const FACE_PHOTO = fileURLToPath(new URL('./fixtures/face.jpg', import.meta.url));

export function testMobile(): string {
  return `9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
}

export function todayIST(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
}

export async function paidMember(request: APIRequestContext, fullName = 'Ravi Renewer'): Promise<{ memberId: string; mobile: string }> {
  const mobile = testMobile();
  const registration = await request.post('/api/v1/registrations', {
    multipart: {
      fullName,
      mobile,
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

  const order = await request.post('/api/v1/checkout/orders', { headers: auth, data: { planId: monthly?.planId, startDate: todayIST() } });
  expect(order.status()).toBe(201);
  const { orderId } = ((await order.json()) as { data: { orderId: string } }).data;

  const simulated = await request.post('/api/v1/checkout/simulate', { headers: auth, data: { providerOrderId: orderId, outcome: 'success' } });
  const callback = ((await simulated.json()) as { data: Record<string, string> }).data;
  const verified = await request.post('/api/v1/checkout/verify', { data: callback });
  expect(((await verified.json()) as { data: { status: string } }).data.status).toBe('PAID');

  return { memberId, mobile };
}
