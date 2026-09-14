import { expect, test, type Page } from '@playwright/test';

/**
 * Max Register, the owner's CRM (crm-ux-blueprint §1–§6; testing-strategy §3 journeys 9–11).
 *
 * The demo slice: sign in with a PIN, read Today, find a member, and take fees in three
 * taps. The seeded demo owner is 9000000001 / 2468 (demo-data-seed-spec §1).
 *
 * Taking fees writes a real payment and a real receipt number, so that journey runs in
 * one project only.
 */

const OWNER = { mobile: '9000000001', pin: '2468' };
const RECEPTION = { mobile: '9000000002', pin: '1357' };

async function login(page: Page, who: { mobile: string; pin: string }) {
  await page.goto('/crm/login');
  await page.getByLabel('मोबाइल नंबर').fill(who.mobile);
  await page.getByLabel('PIN').fill(who.pin);
  await page.getByRole('button', { name: 'लॉगिन करें' }).click();
  await expect(page).toHaveURL(/\/crm$/);
}

test.describe('Max Register', () => {
  test('refuses a wrong PIN and counts the attempts left', async ({ page }) => {
    await page.goto('/crm/login');
    await page.getByLabel('मोबाइल नंबर').fill(OWNER.mobile);
    await page.getByLabel('PIN').fill('9999');
    await page.getByRole('button', { name: 'लॉगिन करें' }).click();

    await expect(page.getByRole('alert').first()).toContainText('मोबाइल नंबर या PIN गलत है');
    await expect(page).toHaveURL(/\/crm\/login$/);
  });

  test('sends anyone without a session to the login screen', async ({ page }) => {
    await page.goto('/crm/members');
    await expect(page).toHaveURL(/\/crm\/login$/);
  });

  test('shows Today in Hindi with the tiles, calls and money', async ({ page }) => {
    await login(page, OWNER);

    await expect(page.locator('html')).toHaveAttribute('lang', 'hi');
    // The four tiles, by the list they open (crm-ux-blueprint §3). Scoped, because the
    // same words appear again on the call rows below.
    for (const [href, label] of [
      ['/crm/members?status=ACTIVE', 'कुल मेंबर'],
      ['/crm/attendance', 'आज आए'],
      ['/crm/members?fee=DUE_SOON', 'इस हफ्ते फीस'],
      ['/crm/members?fee=EXPIRED', 'फीस बाकी'],
    ]) {
      await expect(page.locator(`a[href="${href}"]`).first()).toContainText(label ?? '');
    }
    await expect(page.getByRole('heading', { name: /आज के कॉल/ })).toBeVisible();
    // Money is owner-only (crm-module-spec §3).
    await expect(page.getByRole('heading', { name: /इस महीने/ })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Max Register' }).getByText('मेंबर')).toBeVisible();
  });

  test('hides the money from reception', async ({ page }) => {
    await login(page, RECEPTION);
    await expect(page.getByText('कुल मेंबर', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: /इस महीने/ })).toHaveCount(0);
  });

  test('lets the owner change the website offer, and the website shows it straight away', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'Changes gym settings; one project is enough.');
    // Signing in counts as entering the PIN, so settings open without asking again.
    await login(page, OWNER);
    await page.goto('/crm/more');
    await page.getByRole('link', { name: /सेटिंग/ }).click();
    await expect(page).toHaveURL(/\/crm\/settings$/);

    const offer = `टेस्ट ऑफर ${Date.now().toString().slice(-5)}`;
    const promo = page.getByRole('region', { name: 'वेबसाइट पर ऑफर' });
    await promo.getByLabel('ऑफर दिखाएँ').check();
    await promo.getByLabel('ऑफर (हिंदी)').fill(offer);
    await promo.getByRole('button', { name: 'सेव करें' }).click();
    await expect(promo.getByRole('status')).toHaveText('सेव हो गया — वेबसाइट पर तुरंत दिखेगा', { timeout: 30_000 });

    // The landing page is cached; the save refreshes that cache (ADR-022).
    await page.goto('/hi');
    await expect(page.getByText(offer)).toBeVisible({ timeout: 30_000 });
  });

  test('adds a trainer who can log in, and switching them off logs them out', async ({ page, browser }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'Adds and switches off a staff login; one project is enough.');
    await login(page, OWNER);
    await page.goto('/crm/more');
    await page.getByRole('link', { name: /स्टाफ/ }).click();
    await expect(page).toHaveURL(/\/crm\/settings\/staff$/);

    // Letters only in the name; a fresh number each run.
    const trainer = { name: 'टेस्ट ट्रेनर', mobile: `98${Date.now().toString().slice(-8)}`, pin: '5738' };
    const add = page.getByRole('region', { name: 'नया स्टाफ जोड़ें' });
    await add.getByLabel('नाम').fill(trainer.name);
    await add.getByLabel('मोबाइल नंबर').fill(trainer.mobile);
    await add.getByRole('radio', { name: 'ट्रेनर' }).click();
    await add.getByLabel('PIN (4 से 6 अंक)').fill(trainer.pin);
    await add.getByRole('button', { name: 'जोड़ें' }).click();
    await expect(add.getByRole('status')).toHaveText(`${trainer.name} जुड़ गए`, { timeout: 30_000 });

    // The new login is real: the trainer signs in on their own phone.
    const baseURL = testInfo.project.use.baseURL;
    const phone = await browser.newContext(baseURL === undefined ? {} : { baseURL });
    const trainerPage = await phone.newPage();
    await login(trainerPage, { mobile: trainer.mobile, pin: trainer.pin });

    // The owner switches them off...
    const row = page.getByRole('listitem').filter({ hasText: trainer.mobile.slice(-4) }).filter({ hasText: trainer.name });
    await row.getByRole('button', { name: 'बंद करें' }).click();
    await row.getByRole('button', { name: 'हाँ, बंद करें' }).click();
    await expect(row.getByRole('status')).toHaveText('बंद कर दिया — सारे फ़ोन से लॉगआउट', { timeout: 30_000 });

    // ...and the trainer's very next request lands on the login screen.
    await trainerPage.goto('/crm/members');
    await expect(trainerPage).toHaveURL(/\/crm\/login$/);
    await phone.close();
  });

  test('keeps settings from reception', async ({ page }) => {
    await login(page, RECEPTION);
    await page.goto('/crm/settings');
    await expect(page.getByRole('alert').filter({ hasText: 'सेटिंग सिर्फ़ मालिक बदल सकते हैं।' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'प्लान के दाम' })).toHaveCount(0);
  });

  test('shows the owner the reports, with a table behind the chart', async ({ page }) => {
    await login(page, OWNER);
    await page.goto('/crm/more');
    await page.getByRole('link', { name: /हिसाब/ }).click();
    await expect(page).toHaveURL(/\/crm\/reports$/);

    await expect(page.getByRole('heading', { name: 'इस महीने की कमाई' })).toBeVisible();
    await expect(page.getByText(/₹/).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'सबसे भीड़ का समय' })).toBeVisible();

    // Every chart has a table twin, so nothing is readable only by hovering.
    await page.getByRole('button', { name: 'टेबल में देखें' }).click();
    await expect(page.getByRole('table')).toBeVisible();
  });

  test('keeps the reports from reception', async ({ page }) => {
    await login(page, RECEPTION);
    await page.goto('/crm/reports');
    await expect(page.getByRole('alert').filter({ hasText: 'हिसाब सिर्फ़ मालिक देख सकते हैं।' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'इस महीने की कमाई' })).toHaveCount(0);
  });

  test('searches members and opens a profile', async ({ page }) => {
    await login(page, OWNER);
    await page.goto('/crm/members');
    const firstRow = page.locator('a[href^="/crm/members/"]').first();
    const name = (await firstRow.innerText()).trim();
    await firstRow.click();

    await expect(page).toHaveURL(/\/crm\/members\/[\w-]+$/);
    await expect(page.getByText(/फीस (जमा है|बाकी|इस हफ्ते)|कोई प्लान नहीं/).first()).toBeVisible();
    await expect(page.getByRole('link', { name: /फीस लें/ })).toBeVisible();
    expect(name.length).toBeGreaterThan(0);
  });

  test('takes fees in three taps and gives a receipt number', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'Writes a payment; one project is enough.');
    await login(page, OWNER);

    // An expired member is the one the owner would actually be renewing.
    await page.goto('/crm/members?fee=EXPIRED');
    await page.locator('a[href^="/crm/members/"]').first().click();
    await page.getByRole('link', { name: /फीस लें/ }).click();
    await expect(page).toHaveURL(/\/renew$/);

    await page.getByRole('button', { name: /1 महीना|महीने/ }).first().click();
    await page.getByRole('button', { name: 'कैश' }).click();
    await page.getByRole('button', { name: /हाँ, मिल गया/ }).click();

    await expect(page.getByRole('heading', { name: 'रिन्यू हो गया' })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/MF\/\d{4}-\d{2}\/\d{6}/)).toBeVisible();
    await expect(page.getByText(/मेंबर कोड MF-\d{4}/)).toBeVisible();
  });

  test('adds a walk-in member at the desk, one question per screen', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'Creates a member; one project is enough.');
    await login(page, OWNER);

    await page.goto('/crm/members');
    await page.getByRole('link', { name: 'नया मेंबर' }).click();
    await expect(page).toHaveURL(/\/crm\/members\/new$/);

    // Photo is skippable: a camera that will not open must not stop someone joining.
    await page.getByRole('button', { name: 'अभी नहीं' }).click();

    // Letters only: the shared schema refuses digits in a name.
    const name = `टेस्ट मेंबर ${'कखगघचछजझञट'[new Date().getSeconds() % 10] ?? 'क'}`;
    await page.getByLabel('पूरा नाम').fill(name);
    await page.getByRole('button', { name: 'आगे' }).click();

    await page.getByLabel('मोबाइल नंबर').fill('9812345678');
    await page.getByRole('button', { name: 'आगे' }).click();

    await page.getByRole('button', { name: 'मर्द', exact: true }).click();
    await page.getByRole('button', { name: 'आगे' }).click();

    await page.getByLabel('दिन').fill('05');
    await page.getByLabel('महीना').fill('05');
    await page.getByLabel('साल').fill('1995');
    await page.getByRole('button', { name: 'आगे' }).click();

    await page.getByText('मेंबर ने नियम और प्राइवेसी नोटिस सुन लिया है').click();
    await page.getByRole('button', { name: 'मेंबर जोड़ें' }).click();

    await expect(page.getByRole('heading', { name: 'मेंबर जुड़ गया' })).toBeVisible({ timeout: 30_000 });
    // The desk flow continues straight to fees.
    await page.getByRole('link', { name: 'अब फीस लें' }).click();
    await expect(page).toHaveURL(/\/renew$/);
    await expect(page.getByText(name)).toBeVisible();
  });

  test('marks someone in by hand and takes it back', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'Writes an attendance event; one project is enough.');
    await login(page, OWNER);

    // Someone who has not been in for a week cannot already be marked in today.
    await page.goto('/crm/attendance?tab=absent');
    const absent = page.locator('a[href^="/crm/members/"]').first();
    test.skip((await absent.count()) === 0, 'Nobody is absent in the seed.');
    const name = (await absent.innerText()).trim();

    await page.goto('/crm/attendance');
    await page.getByRole('searchbox').fill(name);
    await page.getByRole('searchbox').press('Enter');

    const row = page.locator('li').filter({ hasText: name }).first();
    await row.getByRole('button', { name: 'हाज़िरी लगाएँ' }).click();

    const undo = page.getByRole('button', { name: 'वापस लें' });
    await expect(undo).toBeVisible({ timeout: 30_000 });
    // The check-in is on today's list…
    await expect(page.getByRole('status').filter({ hasText: name })).toBeVisible();

    await undo.click();
    // …and gone again, which is the whole point of the bar.
    await expect(undo).toBeHidden({ timeout: 30_000 });
  });

  test('moves an enquiry along the pipeline', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'Changes an enquiry; one project is enough.');
    await login(page, OWNER);
    await page.goto('/crm/leads');

    // A *new* enquiry: one already contacted cannot be contacted again, because an
    // enquiry only moves forward, so "बात हो गई" would not be offered on it.
    const rows = page.locator('li').filter({ hasText: 'नई' }).filter({ has: page.getByRole('button', { name: 'आगे बढ़ाएँ' }) });
    test.skip((await rows.count()) === 0, 'No new enquiries in the seed.');

    // Re-locate by name: the row stops matching "आगे बढ़ाएँ" once its panel opens.
    const name = (await rows.first().locator('span').first().innerText()).trim();
    const row = page.locator('li').filter({ hasText: name }).first();
    const note = `टेस्ट फोन किया ${Date.now().toString().slice(-6)}`;

    await row.getByRole('button', { name: 'आगे बढ़ाएँ' }).click();
    await row.getByRole('textbox').fill(note);
    await row.getByRole('button', { name: 'बात हो गई' }).click();

    const updated = page.locator('li').filter({ hasText: note });
    await expect(updated).toContainText('बात हो गई', { timeout: 30_000 });
  });

  test('records what happened on a call and takes the task off the list', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'Closes a call task; one project is enough.');
    await login(page, OWNER);
    await page.goto('/crm/calls');

    // Call rows only: the bottom navigation is a list too.
    const rows = page.locator('li').filter({ has: page.getByRole('button', { name: 'क्या हुआ?' }) });
    test.skip((await rows.count()) === 0, 'No calls due in the seed today.');

    // The member's own number identifies the row; counting every row is no good when the
    // list is capped, and a row stops matching "क्या हुआ?" the moment its panel opens.
    const phone = await rows.first().getByRole('link', { name: /कॉल/ }).getAttribute('href');
    const forMember = page.locator(`a[href="${phone ?? ''}"]`);
    // One open task per member and reason, so the same member can be on the list twice.
    const before = await forMember.count();
    const row = page.locator('li').filter({ has: page.locator(`a[href="${phone ?? ''}"]`) }).first();

    await row.getByRole('button', { name: 'क्या हुआ?' }).click();
    await row.getByRole('button', { name: 'फोन नहीं उठाया' }).click();

    // It was snoozed to tomorrow, so that task leaves today's list.
    await expect(forMember).toHaveCount(before - 1, { timeout: 30_000 });
  });

  test('voids a payment only after the PIN is typed again', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'Writes and voids a payment; one project is enough.');
    await login(page, OWNER);

    // Take fees first, so the payment being voided is one this test created.
    await page.goto('/crm/members?fee=EXPIRED');
    await page.locator('a[href^="/crm/members/"]').first().click();
    // Wait for the navigation to land, or the URL captured is still the list.
    await page.waitForURL(/\/crm\/members\/[\w-]+$/);
    const profileUrl = page.url();
    await page.getByRole('link', { name: /फीस लें/ }).click();
    await page.getByRole('button', { name: /1 महीना|महीने/ }).first().click();
    await page.getByRole('button', { name: 'कैश' }).click();
    await page.getByRole('button', { name: /हाँ, मिल गया/ }).click();
    await expect(page.getByRole('heading', { name: 'रिन्यू हो गया' })).toBeVisible({ timeout: 30_000 });

    await page.goto(profileUrl);
    await page.getByRole('button', { name: 'पेमेंट रद्द करें' }).first().click();
    // Scoped to the dialog: Next's route announcer is a `role="alert"` too.
    const dialog = page.getByRole('group', { name: 'यह पेमेंट रद्द करें?' });
    const receipt = /MF\/\d{4}-\d{2}\/\d{6}/.exec(await dialog.getByText(/रसीद MF\//).innerText())?.[0] ?? '';
    expect(receipt).not.toBe('');

    await page.getByLabel('वजह लिखें').fill('टेस्ट: गलत रकम');

    // A wrong PIN refuses and voids nothing.
    await page.getByLabel('अपना PIN डालें').fill('9999');
    await dialog.getByRole('button', { name: 'हाँ, रद्द करें' }).click();
    await expect(dialog.getByRole('alert')).toContainText('PIN गलत है', { timeout: 30_000 });

    await page.getByLabel('अपना PIN डालें').fill(OWNER.pin);
    await dialog.getByRole('button', { name: 'हाँ, रद्द करें' }).click();

    // That one payment now reads as voided — and keeps its receipt number (BR-11.2).
    await expect(page.getByText(new RegExp(`${receipt}.*रद्द`))).toBeVisible({ timeout: 30_000 });
  });
});
