/**
 * The comfort settings: with the largest text, less flashing and alerts in
 * a corner, every window still fits the screen and no text runs over other
 * text. Also checks the game can be installed and keeps its files offline.
 */
import { checkScreen, expect, openGame, test } from './robot';
import { MAIN_WINDOWS, isPhone, openWindow, sectionsOf, windowOf } from './ui';

test('every window with the largest text', async ({ page }, info) => {
  await page.addInitScript(() => {
    localStorage.setItem('project-null.comfort.v1', JSON.stringify({ text: 'larger', calm: true, corner: true }));
  });
  await openGame(page, 'late');
  await expect(page.locator('html')).toHaveClass(/is-calm/);
  const report = page.locator('.jobreport button', { hasText: 'Done' });
  if (await report.isVisible()) await report.click();
  await checkScreen(page, info, 'loaded');
  for (const id of MAIN_WINDOWS) {
    if (id === 'server') continue;
    await openWindow(page, id);
    const sections = await sectionsOf(page, id);
    if (sections.length === 0) await checkScreen(page, info, id);
    for (const name of sections) {
      await windowOf(page, id).locator('.window__tabs button:visible', { hasText: name }).first().click();
      await checkScreen(page, info, `${id} ${name}`);
    }
  }
});

test('the comfort settings in the game menu', async ({ page }, info) => {
  await openGame(page, 'mid');
  const report = page.locator('.jobreport button', { hasText: 'Done' });
  if (await report.isVisible()) await report.click();
  await page.locator('.menu__button').click();
  const sizes = page.getByRole('group', { name: 'Text size' });
  await sizes.getByRole('button', { name: 'Larger' }).click();
  await expect(page.locator('html')).toHaveAttribute('style', /--text-scale: 1.25/);
  await sizes.getByRole('button', { name: 'Normal' }).click();
  await expect(page.locator('html')).toHaveAttribute('style', /--text-scale: 1(;|$)/);
  if (!(await isPhone(page))) await checkScreen(page, info, 'menu');
});

test('the game keeps its files for offline play', async ({ page }) => {
  await openGame(page);
  const manifest = await page.evaluate(async () => (await fetch(document.querySelector<HTMLLinkElement>('link[rel=manifest]')!.href)).json());
  expect(manifest.display).toBe('standalone');
  // The worker installs and keeps the page and its files.
  const kept = await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    const names = await caches.keys();
    const cache = await caches.open(names.find((name) => name.startsWith('project-null-'))!);
    return (await cache.keys()).map((request) => new URL(request.url).pathname);
  });
  expect(kept).toContain('/Project-Null/');
  expect(kept.some((path) => path.endsWith('.js'))).toBe(true);
  // With no connection the game still opens.
  await page.context().setOffline(true);
  await page.reload();
  await expect(page.locator('.desktop')).toBeVisible();
  await page.context().setOffline(false);
});
