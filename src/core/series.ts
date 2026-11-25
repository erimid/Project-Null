/**
 * Side stories: a few written contracts for one client, offered one after
 * another (see content/series.ts). The first part comes onto the board
 * when the player's rating reaches it; each part after that some hours
 * after the one before it was delivered. The client writes when a part is
 * ready. A part's own conditions (`when`, `minRating`) still apply.
 */
import type { SeriesDef } from '../content/series';
import type { ContractDef } from '../content/schema';
import { conditionMet } from './conditions';
import { gateRating } from './story';
import type { GameState } from './state';
import { sendLetter, type Content } from './world';

/** Game hours between one part being delivered and the next being offered, unless the part says otherwise. */
export const SERIES_GAP_HOURS = 12;

const HOUR = 3_600_000;
const seriesList = (content: Content): readonly SeriesDef[] => content.series ?? [];

/** The side story a contract is part of, and which part it is (0 = the first). */
export function seriesOf(content: Content, contractId: string): { series: SeriesDef; index: number } | undefined {
  for (const series of seriesList(content)) {
    const index = series.parts.findIndex((part) => part.contract === contractId);
    if (index >= 0) return { series, index };
  }
  return undefined;
}

const openFlag = (seriesId: string, index: number): string => `series:${seriesId}:${index}`;

/** False for a part of a side story whose turn has not come. True for every other contract. */
export function seriesOpen(state: GameState, content: Content, contract: ContractDef): boolean {
  const found = seriesOf(content, contract.id);
  return !found || state.flags.includes(openFlag(found.series.id, found.index));
}

/** "Part 2 of 4 · The harbour file", for a contract that is part of a side story. */
export function seriesLine(content: Content, contract: ContractDef): string | undefined {
  const found = seriesOf(content, contract.id);
  return found && `Part ${found.index + 1} of ${found.series.parts.length} · ${found.series.name}`;
}

/** How many parts of a side story are done. */
export const seriesDone = (state: GameState, seriesId: string): number => state.contracts.series[seriesId]?.done ?? 0;

/**
 * Opens the next part of each side story when its time has come, and has
 * the client write. Cheap when there is nothing to do.
 */
export function advanceSeries(state: GameState, content: Content): void {
  const now = state.clock.gameTimeMs;
  for (const series of seriesList(content)) {
    const progress = state.contracts.series[series.id];
    const done = progress?.done ?? 0;
    const part = series.parts[done];
    if (!part || state.flags.includes(openFlag(series.id, done))) continue;
    const contract = content.contracts.find((item) => item.id === part.contract);
    if (!contract || state.player.rating < gateRating(state, contract) || !conditionMet(state, contract.when)) continue;
    if (done > 0 && now < (progress?.atMs ?? 0) + (part.gapHours ?? SERIES_GAP_HOURS) * HOUR) continue;
    state.flags.push(openFlag(series.id, done));
    // A client's letter about work: it is filed with the work, not with the story.
    if (part.invite) sendLetter(state, { from: series.client, ...part.invite }, {}, 'work');
  }
}

/** A contract was delivered. If it was the next part of a side story, the story moves on. */
export function noteSeries(state: GameState, content: Content, contract: ContractDef): void {
  const found = seriesOf(content, contract.id);
  if (!found || seriesDone(state, found.series.id) !== found.index) return;
  state.contracts.series[found.series.id] = { done: found.index + 1, atMs: state.clock.gameTimeMs };
}
