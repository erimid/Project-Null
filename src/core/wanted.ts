/**
 * The wanted level. Being traced, and leaving logs behind for a review to
 * find, draws attention; delivered work and quiet days let it fade. Each
 * level costs something concrete: shops charge more, fines grow, enemy
 * hackers come more often for the bounty, and at the top the patron who
 * trusts the player most steps back. The first trace is a warning; the
 * second and third in a row are what hurt. There is no letter of its own:
 * the letter about the trace or the review says what the word is now.
 */
import { shiftStanding, standingWith } from './patrons';
import type { GameState } from './state';
import type { Content } from './world';
import { SAFE_HOUSE, hasAsset } from './assets';

export interface WantedLevel {
  /** Heat at which the level begins. */
  readonly heat: number;
  readonly name: string;
  /** Shop prices are multiplied by this. */
  readonly prices: number;
  /** Fines are multiplied by this. */
  readonly fines: number;
  /** Random attacks on the gateway are this many times as likely, and their cool-down this many times shorter. */
  readonly raids: number;
  /** Time spent lying low after a trace is multiplied by this. */
  readonly lieLow: number;
}

export const WANTED_LEVELS: readonly WantedLevel[] = [
  { heat: 0, name: 'Clean', prices: 1, fines: 1, raids: 1, lieLow: 1 },
  { heat: 2, name: 'Noticed', prices: 1.1, fines: 1.25, raids: 1, lieLow: 1 },
  { heat: 4, name: 'Wanted', prices: 1.2, fines: 1.5, raids: 2, lieLow: 1.5 },
  { heat: 6, name: 'Hunted', prices: 1.35, fines: 2, raids: 3, lieLow: 2 },
];

/** Heat never goes above this, so even the worst run can be worked off. */
export const MAX_HEAT = 8;
/** Heat for a trace that reached the gateway. One trace is one level. */
export const TRACED_HEAT = 2;
/** Heat for a log review that found the player's lines. */
export const REVIEW_HEAT = 1;
/** Heat a delivered contract takes off. */
export const JOB_COOL = 0.5;
/** Heat a quiet day takes off. */
export const DAY_COOL = 0.5;

const DAY_MS = 86_400_000;

const levelOf = (heat: number): number => WANTED_LEVELS.reduce((best, level, index) => (heat >= level.heat ? index : best), 0);

/** The level the player is wanted at right now: 0 = clean. */
export const wantedLevel = (state: GameState): number => levelOf(state.wanted?.heat ?? 0);

/** What the current level costs. */
export const wanted = (state: GameState): WantedLevel => WANTED_LEVELS[wantedLevel(state)]!;

/** How far the heat is through its current level, 0 to 1: the bar under the badge. */
export function wantedShare(state: GameState): number {
  const index = wantedLevel(state);
  const from = WANTED_LEVELS[index]!.heat;
  const to = WANTED_LEVELS[index + 1]?.heat ?? MAX_HEAT;
  return Math.max(0, Math.min(1, (state.wanted.heat - from) / Math.max(0.001, to - from)));
}

/** What a level costs, as lines for a letter or a tip. */
export function wantedEffects(level: WantedLevel): string[] {
  const lines: string[] = [];
  const more = (factor: number) => `${Math.round((factor - 1) * 100)}%`;
  if (level.prices > 1) lines.push(`Shops charge ${more(level.prices)} more.`);
  if (level.fines > 1) lines.push(`Fines are ${more(level.fines)} bigger.`);
  if (level.lieLow > 1) lines.push(`Lying low after a trace lasts ${level.lieLow === 2 ? 'twice' : 'half again'} as long.`);
  if (level.raids > 1) lines.push(`There is a bounty on your gateway: other hackers come for it ${level.raids === 2 ? 'twice' : 'three times'} as often.`);
  return lines;
}

/** At the top, the patron who trusts the player most steps back to arm's length. Returns their name, if anyone did. */
function patronStepsBack(state: GameState, content: Content): string | undefined {
  const closest = (content.patrons ?? [])
    .filter((patron) => !patron.hidden && state.patrons.met.includes(patron.id) && standingWith(state, patron.id) > 0)
    .sort((a, b) => standingWith(state, b.id) - standingWith(state, a.id))[0];
  if (!closest) return undefined;
  shiftStanding(state, content, closest.id, -standingWith(state, closest.id));
  return closest.name;
}

/**
 * Draws attention: a trace that landed, or a review that found something.
 * If that pushed the player up a level, what it now costs is added to the
 * letter that has just told them about it (the newest message).
 */
export function raiseHeat(state: GameState, content: Content, amount: number): void {
  state.wanted.heat = Math.min(MAX_HEAT, state.wanted.heat + amount);
  const now = wantedLevel(state);
  const before = state.wanted.level;
  state.wanted.level = now;
  if (now <= before) return;
  const level = WANTED_LEVELS[now]!;
  const lines = wantedEffects(level);
  if (now === WANTED_LEVELS.length - 1) {
    const who = patronStepsBack(state, content);
    if (who) lines.push(`${who} has stepped back. Your standing with them starts again from nothing.`);
  }
  const letter = state.messages[state.messages.length - 1];
  if (letter) letter.body += `\n\nThe word on you now: ${level.name.toUpperCase()}.\n${lines.join('\n')}\nIt fades with every job you deliver and every quiet day.`;
}

/** Lets attention fade: a job delivered, or a day gone by. */
export function coolHeat(state: GameState, content: Content, amount: number): void {
  // From a safe house it fades faster.
  const rate = hasAsset(state, content, 'safeHouse') ? SAFE_HOUSE.cool : 1;
  state.wanted.heat = Math.max(0, state.wanted.heat - amount * rate);
  state.wanted.level = wantedLevel(state);
}

/** Cools a little for every day that has passed since it last did. Called with the board's daily round. */
export function coolWithTime(state: GameState, content: Content): void {
  const day = Math.floor(state.clock.gameTimeMs / DAY_MS);
  if (state.wanted.day === 0 || day < state.wanted.day) state.wanted.day = day;
  const days = day - state.wanted.day;
  if (days <= 0) return;
  state.wanted.day = day;
  if (state.wanted.heat > 0) coolHeat(state, content, days * DAY_COOL);
}
