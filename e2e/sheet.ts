/**
 * Writes e2e-output/shots/index.html: every screenshot the robot took, one
 * section per screen size and design, so the screens can be looked through
 * in one page. CI keeps the folder with each run.
 */
import { existsSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter';

const ROOT = 'e2e-output/shots';
const escape = (text: string) => text.replace(/[&<>"]/g, (char) => `&#${char.charCodeAt(0)};`);

function pictures(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? pictures(path) : name.endsWith('.png') ? [path] : [];
  });
}

export default class Sheet implements Reporter {
  private readonly failed: string[] = [];

  onTestEnd(test: TestCase, result: TestResult): void {
    if (result.status !== 'passed' && result.status !== 'skipped') failedName(this.failed, test);
  }

  onEnd(result: FullResult): void {
    const shots = pictures(ROOT).sort();
    if (shots.length === 0) return;
    const groups = new Map<string, string[]>();
    for (const shot of shots) {
      const rel = shot.slice(ROOT.length + 1);
      const group = rel.split('/').slice(0, 2).join(' · ');
      groups.set(group, [...(groups.get(group) ?? []), rel]);
    }
    const sections = [...groups].map(
      ([group, list]) =>
        `<h2>${escape(group)}</h2><div class="grid">${list
          .map((rel) => `<figure><a href="${escape(rel)}"><img loading="lazy" src="${escape(rel)}"></a><figcaption>${escape(rel.split('/').pop()!.replace('.png', ''))}</figcaption></figure>`)
          .join('')}</div>`,
    );
    const failed = this.failed.length > 0 ? `<p class="bad">Failed: ${this.failed.map(escape).join(', ')}</p>` : '';
    writeFileSync(
      join(ROOT, 'index.html'),
      `<!doctype html><meta charset="utf-8"><title>Robot playtest: ${result.status}</title><style>
body{background:#0b1220;color:#d6e2f0;font:14px system-ui;margin:24px}h2{margin:28px 0 8px;font-size:16px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px}
figure{margin:0}img{width:100%;border:1px solid #2a3a55}figcaption{font-size:12px;opacity:.8}.bad{color:#ff7a7a}
</style><h1>Robot playtest: ${escape(result.status)}</h1>${failed}${sections.join('')}`,
    );
  }
}

function failedName(list: string[], test: TestCase): void {
  list.push(`${test.parent.project()?.name ?? ''} ${test.title}`);
}
