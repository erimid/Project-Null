/**
 * The Career page in the Gateway window: the career's numbers, and every
 * feat, earned in this career, in an earlier one, or still to do.
 */
import { feats } from '../../../content';
import { MODES } from '../../../core';
import { content } from '../../session';
import { formatMoney } from '../../format';
import { useWorld } from '../../hooks';
import { closeness, formatGameSpan, kindName } from '../JobReport';
import { useRecordStore } from '../recordStore';

export function CareerSection() {
  const game = useWorld((state) => state);
  const kept = useRecordStore();
  const stats = game.record.stats;
  const jobs = Object.entries(stats.jobs).sort((a, b) => b[1] - a[1]);
  const total = game.contracts.completed.length;
  const days = Math.max(1, Math.ceil((game.clock.gameTimeMs - stats.startMs) / 86_400_000));
  const close = stats.closestMs === null ? null : closeness(stats.closestMs);
  const here = new Set(game.record.feats);
  const before = new Set(kept.feats);
  const earnedCount = feats.filter((feat) => here.has(feat.id) || before.has(feat.id)).length;

  const numbers: readonly (readonly [string, string, string])[] = [
    ['Jobs delivered', String(total), 'Every contract handed in and paid'],
    ['Closest escape', close ? close.text : 'Never traced on a job', 'The least time a trace had left on a job you still delivered'],
    ['Fastest job', stats.fastestMs === null ? 'None yet' : formatGameSpan(stats.fastestMs), 'From taking a job to handing it in, in game time'],
    ['Stolen', `${stats.stolenGq} GB`, 'Every file copied home'],
    ['Clean run', `${stats.cleanRun} now · best ${stats.bestCleanRun}`, 'Jobs in a row with no line of yours left in a log'],
    ['Traces landed', String(stats.caught), 'Times a trace reached you'],
    ['Attackers traced back', String(stats.raidsBeaten), 'Raids on your gateway that ended with their address in your book'],
    ['Relays burned', String(stats.relaysBurned), 'Relays a trace got past on its way to you'],
    ['Days played', String(days), 'Game days since your first letter'],
    ['Credits', formatMoney(Math.floor(game.player.balance)), 'What you hold now'],
    ['Difficulty', MODES[game.difficulty].name, `${MODES[game.difficulty].blurb} Change it in the game menu.`],
    ...(game.loan.owed > 0 ? ([['Owed to Wren', formatMoney(game.loan.owed), `Wren takes ${Math.round((content.rules.loan?.repayShare ?? 0) * 100)}% of each payment until the loan is square. No interest.`]] as const) : []),
  ];

  return (
    <div class="career">
      <dl class="tiles career__numbers">
        {numbers.map(([label, value, tip]) => (
          <div key={label} class="tile" data-tip={tip}>
            <dt>{label}</dt>
            <dd class="data">{value}</dd>
          </div>
        ))}
      </dl>
      {jobs.length > 0 && (
        <>
          <h3 class="map__heading">Jobs by kind</h3>
          <ul class="career__kinds">
            {jobs.map(([kind, count]) => (
              <li key={kind}>
                <span>{kindName(kind)}</span>
                <span class="data">{count}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <h3 class="map__heading">
        Feats <span class="career__count data">{earnedCount} of {feats.length}</span>
      </h3>
      <p class="career__hint">Feats stay with you from one career to the next, in this browser.</p>
      <ul class="career__feats">
        {feats.map((feat) => {
          const state = here.has(feat.id) ? 'is-earned' : before.has(feat.id) ? 'is-before' : '';
          return (
            <li key={feat.id} class={`feat ${state}`} data-tip={here.has(feat.id) ? 'Earned in this career' : before.has(feat.id) ? 'Earned in an earlier career' : 'Not earned yet'}>
              <span class="feat__name">{feat.name}</span>
              <span class="feat__text">{feat.text}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
