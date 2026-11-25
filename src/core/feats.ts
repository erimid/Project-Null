/**
 * Feats: things worth doing once. Each has a rule here, checked after
 * every delivery and whenever something it counts moves; their names and
 * wording are in content/feats.json. Earned feats are kept in the save
 * (`record.feats`), and the browser keeps them across careers too.
 */
import type { JobReport } from './record';
import type { GameState } from './state';

/** The rating each title feat needs. */
const GHOST = 12;
const WRAITH = 25;
const PHANTOM = 49;
const LEGEND = 111;

const jobsDone = (state: GameState) => state.contracts.completed.length;
const kinds = (state: GameState) => Object.keys(state.record.stats.jobs).length;

/** Each feat's rule. `report` is the job just delivered, when the check follows a delivery. */
const RULES = {
  'first-job': (state) => jobsDone(state) >= 1,
  'ten-jobs': (state) => jobsDone(state) >= 10,
  'fifty-jobs': (state) => jobsDone(state) >= 50,
  'hundred-jobs': (state) => jobsDone(state) >= 100,
  'close-shave': (_, report) => report !== undefined && report.closestMs !== null && report.closestMs < 3000,
  'never-seen': (_, report) => report !== undefined && report.closestMs === null && report.linesLeft === 0,
  'clean-ten': (state) => state.record.stats.bestCleanRun >= 10,
  'clean-twenty-five': (state) => state.record.stats.bestCleanRun >= 25,
  quick: (_, report) => report !== undefined && report.tookMs > 0 && report.tookMs <= 20 * 60_000,
  'long-way': (_, report, watch) => report !== undefined && (watch?.mostRelays ?? 0) >= 8,
  bare: (_, report, watch) => report !== undefined && watch?.fewestRelays === 0 && report.ratingAfter - report.ratingBefore >= 5,
  'two-lines': (_, report, watch) => report !== undefined && (watch?.mostOpen ?? 0) >= 3,
  jammed: (_, report, watch) => report !== undefined && watch?.jammed === true,
  heist: (state) => (state.record.stats.jobs.heist ?? 0) >= 1,
  'heist-three': (state) => (state.record.stats.jobs.heist ?? 0) >= 3,
  'five-kinds': (state) => kinds(state) >= 5,
  'ten-kinds': (state) => kinds(state) >= 10,
  'stolen-hundred': (state) => state.record.stats.stolenGq >= 100,
  'raid-beaten': (state) => state.record.stats.raidsBeaten >= 1,
  'raid-five': (state) => state.record.stats.raidsBeaten >= 5,
  rich: (state) => state.player.balance >= 50_000,
  'very-rich': (state) => state.player.balance >= 250_000,
  ghost: (state) => state.player.bestRating >= GHOST,
  phantom: (state) => state.player.bestRating >= PHANTOM,
  legend: (state) => state.player.bestRating >= LEGEND,
  untouched: (state) => state.player.bestRating >= WRAITH && state.record.stats.caught === 0,
  'legend-job': (state) => state.player.legends >= 1,
  phish: (state) => state.phish.done.length >= 1,
  builder: (state) => state.player.builds.length >= 1,
  property: (state) => state.player.assets.length >= 1,
  comeback: (_, report) => report !== undefined && report.linesLeft === 0 && report.afterCaught,
  ending: (state) => state.ending !== null,
} satisfies Record<string, (state: GameState, report?: JobReport, watch?: Watched) => boolean>;

/** What the watch saw on the job just delivered (see record.ts). */
interface Watched {
  readonly mostRelays: number;
  readonly fewestRelays: number | null;
  readonly mostOpen: number;
  readonly jammed: boolean;
}

export type FeatId = keyof typeof RULES;
export const FEAT_IDS = Object.keys(RULES) as FeatId[];

/**
 * Checks every feat not yet earned in this career and records the new
 * ones. Returns their ids, so the screen can say so.
 */
export function checkFeats(state: GameState, report?: JobReport, watch?: Watched): FeatId[] {
  const earned: FeatId[] = [];
  for (const id of FEAT_IDS) {
    if (state.record.feats.includes(id)) continue;
    if (RULES[id](state, report, watch)) {
      state.record.feats.push(id);
      earned.push(id);
    }
  }
  return earned;
}
