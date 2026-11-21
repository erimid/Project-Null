import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TOUCH_LAST_STEP, TOUR, WINDOW_HELP } from './help';

const here = new URL('.', import.meta.url).pathname;

// Read from the source: the window store itself needs a browser to load.
const WINDOW_IDS = [...(readFileSync(join(here, 'windowStore.ts'), 'utf8').match(/WINDOW_IDS = \[([^\]]*)\]/)?.[1] ?? '').matchAll(/'(\w+)'/g)].map(
  (match) => match[1] as keyof typeof WINDOW_HELP,
);

/** Every data-tip and data-tour written in the desktop's components. */
function sources(): string {
  const files = [...readdirSync(here), ...readdirSync(join(here, 'windows')).map((name) => join('windows', name))];
  return files.filter((name) => name.endsWith('.tsx')).map((name) => readFileSync(join(here, name), 'utf8')).join('\n');
}

describe('tutorial text', () => {
  it('has a help card for every window', () => {
    expect(WINDOW_IDS.length).toBeGreaterThanOrEqual(10);
    for (const id of WINDOW_IDS) {
      expect(WINDOW_HELP[id].summary.length).toBeGreaterThan(10);
      expect(WINDOW_HELP[id].points.length).toBeGreaterThan(0);
    }
  });

  it('never names the secret project', () => {
    const all = [JSON.stringify(WINDOW_HELP), JSON.stringify(TOUR), TOUCH_LAST_STEP, sources()].join('\n');
    const tips = [...all.matchAll(/(data-tip|tip)=\{?["`']([^"`']*)/g)].map((match) => match[2] ?? '');
    for (const text of [JSON.stringify(WINDOW_HELP), JSON.stringify(TOUR), TOUCH_LAST_STEP, ...tips]) {
      expect(text.toLowerCase()).not.toContain('project null');
    }
  });

  it('points every tour step at something on the desk', () => {
    const code = sources();
    for (const step of TOUR) {
      if (!step.target) continue;
      const marked = (WINDOW_IDS as string[]).includes(step.target) ? code.includes('data-tour={id}') : code.includes(`data-tour="${step.target}"`);
      expect(marked, step.target).toBe(true);
    }
  });
});
