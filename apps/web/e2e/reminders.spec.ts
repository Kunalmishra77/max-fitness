import { createHmac } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { issueToken } from '@mfp/core';
import { systemClock } from '@mfp/shared';
import { waitForHydration } from './hydration';
import { paidMember } from './paid-member';

/**
 * Journey 8 (testing-strategy.md §3): a member taps Unsubscribe and drops out of the
 * reminder plan.
 *
 * The journey as first written used the simulator's "Advance time" to jump to E+1 and
 * watch three messages arrive. That control is deliberately not built (ADR-067): it
 * mutates the demo data and needs the worker running. What it was really checking —
 * that a tap on Unsubscribe stops the messages — is checked here without a fake clock,
 * by reading the 30-day plan before and after the tap. The tap itself is the real
 * thing: a signed Meta webhook carrying the token the engine would have put behind the
 * button.
 */

try {
  process.loadEnvFile(fileURLToPath(new URL('../../../.env', import.meta.url)));
} catch {
  // CI provides the environment directly.
}

/** A first name no seeded member has, so counting rows by name is unambiguous. */
const FIRST_NAME = 'Zubin';

const OWNER = { mobile: '9000000001', pin: '2468' };

async function login(page: Page): Promise<void> {
  await page.goto('/crm/login');
  await waitForHydration(page);
  await page.getByLabel('मोबाइल नंबर').fill(OWNER.mobile);
  await page.getByLabel('PIN').fill(OWNER.pin);
  await page.getByRole('button', { name: 'लॉगिन करें' }).click();
  await expect(page).toHaveURL(/\/crm$/);
}

/** How many messages the 30-day plan has for this member. */
async function plannedFor(page: Page, firstName: string): Promise<number> {
  await page.goto('/crm/messages/simulator');
  await expect(page.getByRole('heading', { name: /Message plan|मैसेज का हिसाब/ })).toBeVisible();
  return page.getByRole('button', { expanded: false }).filter({ hasText: firstName }).count();
}

/** The webhook Meta would send when the member taps the button, signed the way Meta signs it. */
async function tapUnsubscribe(baseURL: string, payload: string, appSecret: string): Promise<number> {
  const body = JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'e2e',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '919000000000', phone_number_id: 'e2e' },
              messages: [
                {
                  from: '919000000000',
                  id: `wamid.e2e.${Date.now()}`,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  type: 'button',
                  button: { payload, text: 'Unsubscribe' },
                },
              ],
            },
          },
        ],
      },
    ],
  });

  const signature = `sha256=${createHmac('sha256', appSecret).update(body).digest('hex')}`;
  const response = await fetch(`${baseURL}/api/v1/webhooks/whatsapp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature },
    body,
  });
  return response.status;
}

test('journey 8a: a new member appears in the plan with the words they will read', async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Writes to the database; one project is enough.');

  await paidMember(request, `${FIRST_NAME} Planned`);
  await login(page);

  await page.goto('/crm/messages/simulator');
  await expect(page.getByRole('heading', { name: /Message plan|मैसेज का हिसाब/ })).toBeVisible();

  // They paid today, so their first reminder falls inside the thirty days the plan
  // covers — and it is a real message, not a template name.
  const rows = page.getByRole('button', { expanded: false }).filter({ hasText: FIRST_NAME });
  await expect(rows.first()).toBeVisible();

  // The bubble carries the real message, rendered from the template the send uses.
  await rows.first().click();
  await expect(page.getByText(/Max Fitness Gym/).first()).toBeVisible();
});

test('journey 8b: tapping Unsubscribe takes the member out of the reminder plan', async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Writes to the database; one project is enough.');
  const linkSecret = process.env['LINK_TOKEN_SECRET'] ?? '';
  const appSecret = process.env['WHATSAPP_APP_SECRET'] ?? '';
  // The tap is a signed Meta webhook, so it cannot be faked without the app secret.
  // Until the gym's WhatsApp number exists there is no secret to sign with, and this
  // half of the journey waits (see docs/09-operations/whatsapp-live-send-checklist.md).
  test.skip(linkSecret === '' || appSecret === '', 'Needs LINK_TOKEN_SECRET and WHATSAPP_APP_SECRET to mint and sign the tap.');

  const { memberId } = await paidMember(request, `${FIRST_NAME} Unsubscriber`);
  await login(page);

  const before = await plannedFor(page, FIRST_NAME);
  expect(before).toBeGreaterThan(0);

  // They tap Unsubscribe on a message. The member id comes from the signed token,
  // never from the payload's own word for it (BR-6.1).
  const payload = `UNSUB.${issueToken({ purpose: 'unsub', subject: memberId, ttlSeconds: 3_600, secret: linkSecret, clock: systemClock })}`;
  const baseURL = testInfo.project.use.baseURL ?? '';
  expect(await tapUnsubscribe(baseURL, payload, appSecret)).toBe(200);

  // The CRM knows: they have left, with the reason that says why (BR-6.2).
  await page.goto(`/crm/members/${memberId}`);
  await expect(page.getByText(FIRST_NAME, { exact: false }).first()).toBeVisible();

  // And the plan has nothing more for them, for the whole thirty days.
  expect(await plannedFor(page, FIRST_NAME)).toBe(0);

  // A tampered payload does nothing at all: the signature is over the body, but the
  // member id is inside a token of our own, so a guessed one is worth nothing.
  expect(await tapUnsubscribe(baseURL, 'UNSUB.not-a-real-token', appSecret)).toBe(200);
  expect(await tapUnsubscribe(baseURL, payload, 'wrong-secret')).toBe(401);
});
