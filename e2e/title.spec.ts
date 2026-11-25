/**
 * The front door: the title screen, the new-game setup, the opening,
 * and the way back from the desk.
 */
import { checkScreen, expect, test } from './robot';

test('the title screen, a new game and back again', async ({ page }, info) => {
  await page.goto('./');
  const title = page.locator('.title');
  await expect(title).toBeVisible();
  // The name keeps its last three letters back until a career has read it.
  await expect(page.locator('.title__name')).toHaveText(/^PROJECT\s+N$/);
  await expect(page.locator('.title__block')).toHaveCount(3);
  // Nothing to continue yet.
  await expect(page.locator('[data-title="continue"]')).toHaveCount(0);
  await checkScreen(page, info, 'title');
  for (const panel of ['load', 'settings', 'credits']) {
    await page.locator(`[data-title="${panel}"]`).click();
    await checkScreen(page, info, panel);
    await page.locator('[data-title="back"]').click();
  }

  await page.locator('[data-title="new"]').click();
  const first = await page.locator('[data-title="handle"]').textContent();
  await page.locator('[data-title="spin"]').click();
  await expect(page.locator('[data-title="spin"]')).toBeEnabled();
  const handle = (await page.locator('[data-title="handle"]').textContent())!;
  expect(handle).not.toBe(first);
  await page.locator('[data-difficulty="story"]').click();
  expect((await page.locator('[data-title="digit"]').allTextContents()).join('')).toMatch(/^\d{4}$/);
  await checkScreen(page, info, 'new game');
  await page.locator('[data-title="begin"]').click();

  // The opening names the player, and can be skipped.
  await expect(page.locator('.opening')).toContainText(handle);
  await page.locator('[data-title="skip"]').click();
  await expect(page.locator('.desktop')).toBeVisible();

  // Back to the title from the game menu: the career can now be continued.
  await page.locator('.menu__button:visible').first().click();
  await page.locator('[data-menu="title"]').click();
  await expect(title).toBeVisible();
  const resume = page.locator('[data-title="continue"]');
  await expect(resume).toContainText(handle);
  await resume.click();
  await expect(page.locator('.desktop')).toBeVisible();
});
