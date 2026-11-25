/**
 * The robot plays the guided first job from a new game, pressing what
 * Wren lights up, and looks over the screen at every step.
 */
import { checkScreen, expect, openGame, test } from './robot';
import { openWindow } from './ui';

/** Which window a step's button lives in, for when nothing lit is showing. */
const WINDOW_FOR: Readonly<Record<string, string>> = {
  goto: 'map',
  'goto-target': 'map',
  login: 'server',
  accept: 'server',
  break: 'server',
  enter: 'server',
  relog: 'server',
  copy: 'server',
  scrub: 'server',
};

test('the guided first job, start to pay', async ({ page }, info) => {
  await openGame(page);
  const guide = page.locator('.guide:visible');
  const startBalance = await page.locator('.dock__stat .dock__value.data, .pdock__stat.data').first().textContent();

  let last = '';
  /** What was pressed on this step already, so a step with two lit buttons presses each once in turn. */
  let pressed = new Set<string>();
  const deadline = Date.now() + 150_000;
  while (Date.now() < deadline) {
    if (!(await guide.isVisible())) break;
    const step = (await guide.getAttribute('data-step')) ?? '';
    if (step !== last) {
      await checkScreen(page, info, `step ${step}`);
      last = step;
      pressed = new Set();
      // Bring the step's window to the front first, as a player would: on a phone or tablet the contract can cover it.
      const where = WINDOW_FOR[step];
      if (where) await openWindow(page, where);
    }
    if (step === 'wait') {
      await page.waitForTimeout(500);
      continue;
    }
    const lit = page.locator('.is-guided:visible');
    const count = await lit.count();
    let clicked = false;
    for (let index = 0; index < count; index += 1) {
      const button = lit.nth(index);
      // Known by its first class and its text, which stay the same as it opens and closes.
      const key = `${await button.evaluate((element) => element.classList[0])}|${(await button.textContent())?.trim()}`;
      if (pressed.has(key) || !(await button.isEnabled())) continue;
      pressed.add(key);
      if (process.env.ROBOT_LOG) console.log(step, key);
      await button.click();
      clicked = true;
      break;
    }
    if (!clicked) {
      if (pressed.size > 0) {
        // Everything lit was pressed once and the step has not moved on: start over on it.
        pressed = new Set();
        await page.waitForTimeout(400);
        continue;
      }
      const where = WINDOW_FOR[step];
      expect(where, `something to press for step "${step}"`).toBeTruthy();
      await openWindow(page, where!);
    }
    await page.waitForTimeout(200);
  }
  expect(await guide.isVisible(), 'the first job was finished in time').toBe(false);
  // The job report comes up on delivery, and goes with one press.
  const report = page.locator('.jobreport');
  await expect(report, 'the job report').toBeVisible();
  await checkScreen(page, info, 'delivered');
  await report.locator('button', { hasText: 'Done' }).click();
  await expect(report).toHaveCount(0);
  const endBalance = await page.locator('.dock__stat .dock__value.data, .pdock__stat.data').first().textContent();
  expect(endBalance, 'the job paid').not.toBe(startBalance);
});
