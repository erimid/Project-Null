/**
 * What every robot playtest shares: a page set up with a desk design and
 * (optionally) a saved game, a watch on errors the game logs, the screen
 * checks, and the screenshots for the sheet.
 */
import { readFileSync } from 'node:fs';
import { test as base, expect, type Page, type TestInfo } from '@playwright/test';

export type DesignName = 'classic' | 'deck' | 'cards' | 'sidebar' | 'hybrid';

export interface RobotOptions {
  design: DesignName;
}

interface Robot {
  /** Errors the game logged while the test ran. Checked at the end of every test. */
  errors: string[];
}

export const test = base.extend<RobotOptions & Robot>({
  design: ['classic', { option: true }],
  errors: async ({ page, design }, use) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(`page error: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(`console: ${message.text()}`);
    });
    // The look (desk design) belongs to the browser, so it is set before the game starts.
    await page.addInitScript((chosen) => {
      localStorage.setItem('project-null.look.v1', JSON.stringify({ design: chosen, theme: 'deep-signal', floating: [], bar: true }));
    }, design);
    await use(errors);
    expect(errors, 'the game logged errors').toEqual([]);
  },
});

export { expect };

/** Opens the game. With a save name, loads that saved game from e2e/.saves/ (made by e2e/saves.gen.ts). */
export async function openGame(page: Page, save?: string): Promise<void> {
  if (save) {
    const text = readFileSync(`e2e/.saves/${save}.json`, 'utf8');
    // Only on the first load: later reloads keep whatever the game saved itself.
    await page.addInitScript((saved) => {
      if (sessionStorage.getItem('robot.seeded')) return;
      sessionStorage.setItem('robot.seeded', '1');
      localStorage.setItem('project-null.exit-save.v1', saved);
      // The tour and first-visit hints stay out of the way.
      localStorage.setItem('project-null.hints.v1', JSON.stringify({ on: true, seen: [], toured: true }));
    }, text);
  }
  await page.goto('./');
  await expect(page.locator('.desktop')).toBeVisible();
}

export interface Problem {
  readonly kind: 'off-desk' | 'overlap';
  readonly where: string;
  readonly detail: string;
}

/**
 * Looks over the screen as it is now and lists what is wrong: a window
 * reaching past the edge of the screen, or two pieces of text drawn over
 * each other inside one window or bar.
 */
export async function lookOver(page: Page): Promise<Problem[]> {
  return page.evaluate(() => {
    const problems: { kind: 'off-desk' | 'overlap'; where: string; detail: string }[] = [];
    const width = document.documentElement.clientWidth;
    const height = document.documentElement.clientHeight;
    const shown = (element: Element): boolean => {
      for (let at: Element | null = element; at; at = at.parentElement) {
        const style = getComputedStyle(at);
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
      }
      return true;
    };
    const nameOf = (element: Element): string => element.getAttribute('aria-label') ?? element.getAttribute('data-tour') ?? element.className.toString().split(' ')[0] ?? element.tagName;

    // Windows stay on the screen.
    for (const win of document.querySelectorAll('section.window')) {
      if (!shown(win)) continue;
      const box = win.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      if (box.left < -1 || box.top < -1 || box.right > width + 1 || box.bottom > height + 1) {
        problems.push({ kind: 'off-desk', where: nameOf(win), detail: `at ${Math.round(box.left)},${Math.round(box.top)} to ${Math.round(box.right)},${Math.round(box.bottom)} on a ${width}x${height} screen` });
      }
    }

    // Text over text. Each window and bar is looked at on its own, since floating windows may lie over each other.
    type Line = { readonly owner: Element; readonly text: string; readonly left: number; readonly top: number; readonly right: number; readonly bottom: number };
    const groups = new Map<Element, Line[]>();
    const clip = (node: Element, rect: DOMRect): DOMRect | null => {
      let { left, top, right, bottom } = rect;
      for (let at: Element | null = node; at && at !== document.body; at = at.parentElement) {
        const style = getComputedStyle(at);
        if (style.overflowX !== 'visible' || style.overflowY !== 'visible') {
          const box = at.getBoundingClientRect();
          left = Math.max(left, box.left);
          top = Math.max(top, box.top);
          right = Math.min(right, box.right);
          bottom = Math.min(bottom, box.bottom);
        }
      }
      return right - left > 1 && bottom - top > 1 ? new DOMRect(left, top, right - left, bottom - top) : null;
    };
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent?.trim() ?? '';
      const owner = node.parentElement;
      if (!text || !owner || owner.closest('svg, [aria-hidden="true"], .hover-tip, .touch-tip, .lookbar, [role="dialog"], [role="tooltip"]')) continue;
      if (!shown(owner)) continue;
      const group = owner.closest('section.window, .tabbar, .dock, .pdock, .guide, .rail, .sidebar, .alerts, .contract');
      if (!group) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const rect of range.getClientRects()) {
        const seen = clip(owner, rect);
        if (!seen) continue;
        const lines = groups.get(group) ?? [];
        lines.push({ owner, text: text.slice(0, 40), left: seen.left, top: seen.top, right: seen.right, bottom: seen.bottom });
        groups.set(group, lines);
      }
    }
    // A touch of overlap is how lines of text sit; more than this means one is drawn over the other.
    const SLACK = 4;
    for (const [group, lines] of groups) {
      for (let a = 0; a < lines.length; a += 1) {
        for (let b = a + 1; b < lines.length; b += 1) {
          const one = lines[a]!;
          const two = lines[b]!;
          if (one.owner === two.owner || one.owner.contains(two.owner) || two.owner.contains(one.owner)) continue;
          const across = Math.min(one.right, two.right) - Math.max(one.left, two.left);
          const down = Math.min(one.bottom, two.bottom) - Math.max(one.top, two.top);
          if (across > SLACK && down > SLACK) {
            // Something drawn on top (a menu, a card) hides what is under it: only text that can be seen counts.
            const x = (Math.max(one.left, two.left) + Math.min(one.right, two.right)) / 2;
            const y = (Math.max(one.top, two.top) + Math.min(one.bottom, two.bottom)) / 2;
            const top = document.elementFromPoint(x, y);
            if (top && !(one.owner.contains(top) || two.owner.contains(top) || top.contains(one.owner) || top.contains(two.owner))) continue;
            problems.push({ kind: 'overlap', where: nameOf(group), detail: `"${one.text}" and "${two.text}" overlap` });
          }
        }
      }
    }
    return problems;
  });
}

/** Checks the screen and fails the test with every problem found, after saving a screenshot. */
export async function checkScreen(page: Page, info: TestInfo, label: string): Promise<void> {
  // Let animations and the window fit settle.
  await page.waitForTimeout(250);
  await shoot(page, info, label);
  const problems = await lookOver(page);
  expect.soft(problems.map((problem) => `${problem.kind} in ${problem.where}: ${problem.detail}`), `screen "${label}"`).toEqual([]);
}

/** A screenshot for the sheet (see e2e/sheet.ts). */
export async function shoot(page: Page, info: TestInfo, label: string): Promise<void> {
  const safe = label.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  const path = `e2e-output/shots/${info.project.name}/${info.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}/${safe}.png`;
  await page.screenshot({ path });
  await info.attach(label, { path, contentType: 'image/png' });
}
