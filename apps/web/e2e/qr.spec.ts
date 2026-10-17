import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { waitForHydration } from './hydration';

/**
 * Journey 7 (testing-strategy §3; qr-onboarding-flow §3; ADR-058, ADR-074, ADR-080):
 * an existing member scans the reception QR, answers nine short steps — including both
 * sides of an Aadhaar — shows the code, and reception looks at the card and approves.
 *
 * Each run uses a fresh name and number, so it never collides with a member already
 * there. The selfie and the ID photographs go through the phone-camera file inputs.
 *
 * **This was written for the one-page form of ADR-075 and had stopped testing anything.**
 * ADR-080 put the questions back on separate steps — the gym watched members struggle
 * with the whole form on a phone at reception — and the guard here, which asserted the
 * absence of "Question n of m", never noticed, because the stepper reads "1 / 9". The
 * test filled the first two fields and then waited three minutes for a date-of-birth
 * field that was a step away. Two fields had also been added since (how the member pays,
 * and when they train) and three labels had changed under it.
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

  /**
   * One question at a time, nine of them, with a counter (ADR-080).
   *
   * `to` is the step we expect to land on, and waiting for the counter rather than for a
   * field is what makes this deterministic: a step is checked against the server before
   * it will advance, so the next field does not exist until that returns.
   *
   * A step can also come back with a *soft* warning — a date of birth somebody else in
   * the register already has is common enough that the member is asked to confirm rather
   * than refused. It has its own button, and because the mobile number is random on every
   * run it appears on some runs and not others, which is what made this test flaky until
   * it was handled here.
   */
  const next = async (to: number) => {
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    const counter = page.getByText(`${to} / 9`);
    const carryOn = page.getByRole('button', { name: /It is my date of birth/ });
    // Whichever of the two arrives — asking first and testing after is the race that made
    // this flaky, because the warning only exists once the server has answered.
    await expect(counter.or(carryOn).first()).toBeVisible();
    if (await carryOn.isVisible()) await carryOn.click();
    await expect(counter).toBeVisible();
  };
  await expect(page.getByText('1 / 9')).toBeVisible();

  // 1/9 — who they are.
  await page.getByLabel('Full name').fill(name);
  await page.getByLabel('Mobile number').fill(mobile);
  await next(2);

  // 2/9 — the radio itself is screen-reader only; the label is what a finger lands on.
  await page.getByLabel('Date of birth').fill('1990-02-14');
  await page.getByText('Male', { exact: true }).click();
  await next(3);

  // 3/9 — the selfie, through the phone's camera roll rather than a live camera.
  await page.getByRole('button', { name: /Take your photo/ }).click();
  const sheet = page.getByRole('dialog');
  await sheet.locator('input[type=file]').setInputFiles(FACE_PHOTO);
  await sheet.getByRole('button', { name: /Use this photo/ }).click();
  await next(4);

  // 4/9 — the plan and what they have paid until.
  await page.getByText('3 Months', { exact: true }).click();
  await page.getByLabel('Fees paid until').fill(inThreeWeeks());
  await next(5);

  // 5/9 — how they pay. Cash keeps the desk's existing habit; nothing is charged here.
  await page.getByText('Cash at the counter', { exact: true }).click();
  await next(6);

  // 6/9 — when they train.
  await page.getByText('Morning', { exact: true }).click();
  await next(7);

  // 7/9 — the ID is photographs only; there is no field anywhere for the number (ADR-074).
  await page.getByLabel('Upload a Govt ID').selectOption('AADHAAR');
  await expect(page.getByLabel(/Aadhaar number|ID number/)).toHaveCount(0);
  await page.getByLabel('Front of the card').setInputFiles(FACE_PHOTO);
  await page.getByLabel('Back of the card').setInputFiles(FACE_PHOTO);
  await next(8);

  // 8/9 — the optional step, where the joining date lives.
  await page.getByLabel('Joining date').fill('2019-04-15');
  await next(9);

  // 9/9 — consent, then send.
  await expect(page.getByText('9 / 9')).toBeVisible();
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

  // The tick was dropped from this label; "✗ गलत है" beside it still carries its cross.
  await card.getByRole('button', { name: 'सही है', exact: true }).click();
  await expect(card.getByRole('status')).toHaveText('मंज़ूर — मेंबरशिप चालू।');

  await page.reload();
  await expect(page.getByRole('article', { name })).toHaveCount(0);

  /**
   * And the photographs are still reachable afterwards, on the member's own page.
   *
   * Reached by searching, not by opening the register and looking: the list is
   * alphabetical and cut to a page, so a new member whose name starts with Q is simply
   * not on it once the gym has a couple of hundred people — which is how this assertion
   * failed against realistic data while passing against an empty database.
   */
  await page.goto(`/crm/members?q=${encodeURIComponent(name)}`);
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

  /**
   * Ten steps, not one page, and it finishes here rather than handing off to `/join`.
   *
   * This was written when `/qr/new` collected a few details and then sent the visitor into
   * the website's own plan and payment pages. It now asks the whole thing itself — plan,
   * personal training, how they will pay, when they train, the ID — and ends on its own
   * confirmation. The test sat waiting three minutes for a date-of-birth field that was a
   * step away.
   *
   * Waiting on the **counter** rather than on the next field is what makes it
   * deterministic: each step is checked against the server before it will advance.
   */
  const next = async (to: number) => {
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    /**
     * The counter for the step we are **going to**, matched on its leading number only:
     * how many steps there are in total depends on what has been answered, and pinning
     * that would fail this test for the wrong reason.
     *
     * It has to be the target step's counter and not any counter. A generic
     * `/^\d+ \/ \d+$/` is on screen at every step, so racing it against the soft warning
     * resolved the instant the click returned, before the server had answered — and the
     * assertion that followed then waited out its timeout on a step that never moved.
     */
    const landed = page.getByText(new RegExp(`^${to} / `));
    const carryOn = page.getByRole('button', { name: /It is my date of birth/ });
    await expect(landed.or(carryOn).first()).toBeVisible();
    if (await carryOn.isVisible()) await carryOn.click();
    await expect(landed).toBeVisible();
  };

  await page.getByLabel('Full name').fill('Qr Newcomer');
  await page.getByLabel('Mobile number').fill(mobile);
  await next(2);

  await page.getByLabel('Date of birth').fill('1995-06-15');
  await page.getByText('Male', { exact: true }).click();
  await next(3);

  await page.getByRole('button', { name: /Take your photo/ }).click();
  const sheet = page.getByRole('dialog');
  await sheet.locator('input[type=file]').setInputFiles(FACE_PHOTO);
  await sheet.getByRole('button', { name: /Use this photo/ }).click();
  await next(4);

  /**
   * These choices are radios the eye never sees: the input is screen-reader only and the
   * styled card beside it is what a finger lands on. So they are checked by role —
   * `getByLabel` cannot reach them and the label's own `<span>` intercepts the click —
   * with `force`, which is the honest way to tick an input that is deliberately hidden.
   * Their names carry the price, so "3 Months" alone matches nothing.
   */
  await page.getByRole('radio', { name: /^3 Months/ }).check({ force: true });
  await next(5);

  await page.getByRole('radio', { name: 'No', exact: true }).check({ force: true });
  await next(6);

  // Cash at the desk. The online option here is a standing instruction to collect the fee
  // each month, not a card form, and the desk is what this journey is about.
  await page.getByRole('radio', { name: /Cash at the counter/ }).check({ force: true });
  await next(7);

  await page.getByRole('radio', { name: /Morning/ }).check({ force: true });
  await next(8);

  await page.getByLabel('Upload a Govt ID').selectOption('AADHAAR');
  await page.getByLabel('Front of the card').setInputFiles(FACE_PHOTO);
  await page.getByLabel('Back of the card').setInputFiles(FACE_PHOTO);
  await next(9);

  await next(10);

  // No gateway is offered anywhere in this journey: the plan is held and paid at the desk
  // (ADR-076, ADR-093).
  await expect(page.getByRole('button', { name: /^Pay ₹/ })).toHaveCount(0);
  await page.getByRole('checkbox', { name: /I agree to the/ }).check();
  await page.getByRole('button', { name: /Send to reception|Join/ }).click();

  await expect(page.getByRole('heading', { name: /Done, Qr/ })).toBeVisible({ timeout: 30_000 });
});
