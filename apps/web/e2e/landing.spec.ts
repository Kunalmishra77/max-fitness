import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/** Journey 1 (testing-strategy.md §3): landing loads, hero pause/play, plans toggle shows women's prices. */

test.describe('landing page', () => {
  test('loads with one headline, hero controls and the fee toggle', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    const pause = page.getByRole('button', { name: 'Pause slideshow' });
    await pause.click();
    const play = page.getByRole('button', { name: 'Play slideshow' });
    await expect(play).toBeVisible();
    await play.click();
    await expect(page.getByRole('button', { name: 'Pause slideshow' })).toBeVisible();

    await page.getByRole('button', { name: 'Show slide 2 of 3' }).click();
    await expect(page.getByRole('button', { name: 'Show slide 2 of 3' })).toHaveAttribute('aria-current', 'true');

    const plans = page.locator('#plans');
    await plans.scrollIntoViewIfNeeded();
    // `exact`: accessible-name matching is a substring match, and "Women" contains "men".
    const men = plans.getByRole('radio', { name: 'Men', exact: true });
    const women = plans.getByRole('radio', { name: 'Women', exact: true });

    // With live prices the toggle is present; without them the designed fallback shows instead.
    if ((await men.count()) === 0) {
      await expect(plans.getByRole('status')).toBeVisible();
      return;
    }

    await expect(men).toHaveAttribute('aria-checked', 'true');
    const firstChoose = plans.getByRole('link', { name: /^Choose / }).filter({ visible: true }).first();
    const menLabel = await firstChoose.getAttribute('aria-label');

    await women.click();
    await expect(women).toHaveAttribute('aria-checked', 'true');
    const womenLabel = await plans.getByRole('link', { name: /^Choose / }).filter({ visible: true }).first().getAttribute('aria-label');
    expect(womenLabel).not.toBe(menLabel);
    await expect(plans.getByRole('link', { name: /^Choose / }).filter({ visible: true }).first()).toHaveAttribute(
      'href',
      // Plan codes carry the gender as a suffix, e.g. M1_FEMALE.
      /\/join\?plan=[A-Z0-9]+_FEMALE$/,
    );
  });

  test('serves the Hindi page with lang="hi"', async ({ page }) => {
    await page.goto('/hi');
    await expect(page.locator('html')).toHaveAttribute('lang', 'hi');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('loads no Google Maps request until the visitor asks', async ({ page }) => {
    const mapRequests: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('google.com/maps')) mapRequests.push(request.url());
    });
    await page.goto('/');
    await page.locator('#contact').scrollIntoViewIfNeeded();
    expect(mapRequests).toHaveLength(0);

    await page.getByRole('button', { name: 'Show map' }).click();
    await expect(page.locator('iframe[title^="Map showing"]')).toBeVisible();
  });

  for (const path of ['/', '/hi', '/legal/privacy', '/contact', '/join']) {
    test(`has no detectable accessibility violations on ${path}`, async ({ page }) => {
      await page.goto(path);
      // Off-screen sections use `content-visibility: auto` (ADR-033) and are not rendered,
      // so axe would measure 0×0 targets and the page background instead of the section's.
      // Render everything for the audit so it checks the real colours and sizes.
      await page.addStyleTag({ content: '.deferred-render { content-visibility: visible !important; }' });
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        // Placeholder hero posters sit under a scrim; axe cannot compute contrast over images.
        .exclude('video')
        .analyze();
      // Name each failing element, so a report says what to fix and not just how many.
      expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
    });
  }
});
