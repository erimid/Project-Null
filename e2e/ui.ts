/** Getting around the desk the way a player does: opening windows and their sections. */
import { expect, type Locator, type Page } from '@playwright/test';

export const MAIN_WINDOWS = ['gateway', 'map', 'server', 'programs', 'messages', 'skills', 'web'] as const;

/** The window itself, once it is open. */
export const windowOf = (page: Page, id: string): Locator => page.locator(`section.window[data-tour="${id}"]`);

/** Brings a window to the front, from the bottom bar, the side rail, a pane tab or the phone's dock. */
export async function openWindow(page: Page, id: string): Promise<void> {
  const win = windowOf(page, id);
  if ((await win.isVisible()) && !(await isPhone(page))) {
    // Already showing. Press its opener anyway in a docked design, where it may be a tab behind another.
    const opener = page.locator(`.rail__btn[data-window="${id}"]:visible`);
    if (await opener.count()) await opener.first().click();
    return;
  }
  let opener = page.locator(`[data-window="${id}"]:visible`);
  if ((await opener.count()) === 0) {
    // On a phone the rest are under "More".
    const more = page.locator('.pdock__tab:not([data-window])');
    if (await more.isVisible()) await more.click();
    opener = page.locator(`[data-window="${id}"]:visible`);
  }
  await expect(opener.first(), `a button that opens ${id}`).toBeVisible();
  await opener.first().click();
  await expect(win, `the ${id} window`).toBeVisible();
}

export async function isPhone(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.classList.contains('is-phone'));
}

/** The section buttons along the top of a window (Files, Logs, ...), by their text. */
export async function sectionsOf(page: Page, id: string): Promise<string[]> {
  const tabs = windowOf(page, id).locator('.window__tabs button:visible');
  return (await tabs.allTextContents()).map((text) => text.trim()).filter(Boolean);
}
