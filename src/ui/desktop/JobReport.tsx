/**
 * The job report: a card on delivery that says how the job went. Pay,
 * time inside, the closest a trace came, lines left in the logs, standing
 * gained or lost, and how far the rating is from the next title. One press
 * puts it away; it can be switched off in the game menu.
 */
import { feats as featList } from '../../content';
import type { JobReport as Report } from '../../core';
import { formatMoney, ratingStep } from '../format';
import { useWorld } from '../hooks';
import { content } from '../session';
import { recordStore, useRecordStore } from './recordStore';

/** "1 min 05 s" for real time spent inside. */
export function formatSpan(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} s`;
  return `${Math.floor(seconds / 60)} min ${String(seconds % 60).padStart(2, '0')} s`;
}

/** "2 h 10 min" of game time. */
export function formatGameSpan(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h ${String(minutes % 60).padStart(2, '0')} min`;
  return `${Math.round(hours / 24)} days`;
}

/** What the closest trace says about the job. */
export function closeness(closestMs: number | null): { text: string; tone: string } {
  if (closestMs === null) return { text: 'No trace ran', tone: 'good' };
  const seconds = closestMs / 1000;
  return { text: `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)} s to spare`, tone: seconds < 5 ? 'bad' : seconds < 20 ? 'warn' : 'good' };
}

/** A word for a kind of job, for the report and the career page. */
export const KIND_NAMES: Readonly<Record<string, string>> = {
  steal: 'Theft',
  destroy: 'Wipe a file',
  record: 'Change a record',
  read: 'Read a file',
  plant: 'Plant a file',
  frame: 'Frame someone',
  guard: 'Guard',
  hold: 'Stay inside',
  hunt: 'Hunt',
  swap: 'Swap a file',
  leak: 'Find the leak',
  wipe: 'Wipe a trail',
  round: 'The round',
  heist: 'Heist',
  delete: 'Delete',
  earlier: 'Before the record began',
};
export const kindName = (kind: string): string => KIND_NAMES[kind] ?? kind.charAt(0).toUpperCase() + kind.slice(1);

export function JobReport() {
  const kept = useRecordStore();
  const report = useWorld((game) => game.record.last);
  if (!report || !kept.reports) return null;
  const key = `${report.contractId}@${report.timeMs}`;
  if (kept.seenReport === key) return null;
  return <Card report={report} onDone={() => recordStore.seen(key)} />;
}

function Card({ report, onDone }: { report: Report; onDone: () => void }) {
  const close = closeness(report.closestMs);
  const step = ratingStep(report.ratingAfter);
  const gained = report.ratingAfter - report.ratingBefore;
  const standing = Object.entries(report.standing).map(([id, moved]) => ({ name: content.patrons?.find((patron) => patron.id === id)?.name ?? id, moved }));
  const fresh = (report.feats ?? []).map((id) => featList.find((feat) => feat.id === id)).filter((feat) => feat !== undefined);
  return (
    <section class="jobreport" aria-label="Job report">
      <header class="jobreport__head">
        <span class="jobreport__kind">{kindName(report.kind)}</span>
        <h2 class="jobreport__title">{report.title}</h2>
        <span class="jobreport__pay data">+{formatMoney(report.pay)}</span>
      </header>
      <dl class="jobreport__facts">
        <div>
          <dt>Inside</dt>
          <dd class="data">{formatSpan(report.insideMs)}</dd>
        </div>
        <div>
          <dt>Closest trace</dt>
          <dd class={`data is-${close.tone}`}>{close.text}</dd>
        </div>
        <div>
          <dt>Left in the logs</dt>
          <dd class={`data is-${report.linesLeft === 0 ? 'good' : 'warn'}`}>{report.linesLeft === 0 ? 'Clean' : `${report.linesLeft} line${report.linesLeft === 1 ? '' : 's'}`}</dd>
        </div>
        <div>
          <dt>Rating</dt>
          <dd class="data">
            {report.ratingAfter}
            {gained !== 0 && <span class={gained > 0 ? 'is-good' : 'is-bad'}> {gained > 0 ? `+${gained}` : gained}</span>}
          </dd>
        </div>
      </dl>
      <div class="jobreport__ladder">
        <span class="jobreport__step">{step.title}</span>
        <span class="jobreport__bar" aria-hidden="true">
          <span style={{ width: `${Math.round(step.share * 100)}%` }} />
        </span>
        <span class="jobreport__next">{step.next ? `${step.next.title} at ${step.next.min}` : 'Top of the ladder'}</span>
      </div>
      {standing.length > 0 && (
        <ul class="jobreport__standing">
          {standing.map(({ name, moved }) => (
            <li key={name} class={moved > 0 ? 'is-good' : 'is-bad'}>
              {name} <span class="data">{moved > 0 ? `+${moved}` : moved}</span>
            </li>
          ))}
        </ul>
      )}
      {report.notes.map((note, index) => (
        <p key={index} class="jobreport__note">
          {note}
        </p>
      ))}
      {fresh.length > 0 && (
        <ul class="jobreport__feats">
          {fresh.map((feat) => (
            <li key={feat.id}>
              <span class="jobreport__feat">Feat</span> {feat.name}
            </li>
          ))}
        </ul>
      )}
      <footer class="jobreport__actions">
        <button type="button" class="jobreport__off" data-tip="Stop showing a report after each job. Switch it back on in the game menu." onClick={() => recordStore.showReports(false)}>
          Don't show these
        </button>
        <button type="button" class="btn btn--go" onClick={onDone}>
          Done
        </button>
      </footer>
    </section>
  );
}
