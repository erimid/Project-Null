/**
 * The robot loads a career part-way through and opens every window and
 * every section of each, looking over the screen each time.
 */
import { checkScreen, expect, openGame, test } from './robot';
import { MAIN_WINDOWS, openWindow, sectionsOf, windowOf } from './ui';

for (const save of ['mid', 'late']) {
  test(`every window, ${save}-career`, async ({ page }, info) => {
    await openGame(page, save);
    // The saved career is loaded, not a new game: the first job's guide is gone.
    await expect(page.locator('.guide:visible')).toHaveCount(0);
    await checkScreen(page, info, 'loaded');
    for (const id of MAIN_WINDOWS) {
      // The Server window needs a connection; it is reached in the first job instead.
      if (id === 'server') continue;
      await openWindow(page, id);
      const sections = await sectionsOf(page, id);
      if (sections.length === 0) {
        await checkScreen(page, info, id);
        continue;
      }
      for (const name of sections) {
        await windowOf(page, id).locator('.window__tabs button:visible', { hasText: name }).first().click();
        await checkScreen(page, info, `${id} ${name}`);
      }
    }
  });
}
