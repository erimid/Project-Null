/**
 * The rivals ladder: a dozen hackers, the player among them, ranked on
 * the Backroom. Rivals climb on their own once a game day, take jobs off
 * the board before the player can, turn up in the paper, and write when
 * one passes the other.
 *
 * Beating a raider in a raid (see raid.ts) leaves a choice: sell their
 * address, keep their rig as a private relay that never warms up, or
 * call a truce that turns them into a contact who sends tips. Selling or
 * a truce only takes them out of the random raids: a story raid still
 * lands, and they stay on the ladder.
 *
 * Every draw is on the 'ladder' stream, so nothing else moves.
 */
import type { LadderDef, LadderRivalDef } from '../content/ladder';
import { fill } from './generate';
import { isJob } from './jobs';
import { editionDay } from './news';
import type { GameState, LadderOutcome } from './state';
import { stream } from './streams';
import { findServer, type Content } from './world';

/** Most moves kept in the ladder's recent list. */
export const KEEP_MOVES = 8;
/** Chance each day that a rival takes a job off the board. */
export const SNIPE_CHANCE = 0.3;
/** A rival takes jobs only if they are within this much of the player's rating. */
export const SNIPE_REACH = 15;
/** Credits for a beaten rival's address, per level of the rival. */
export const ADDRESS_PRICE = 900;
/** A rival whose address was sold climbs at this share of their pace from then on. */
export const SOLD_PACE = 0.3;
/** Days between a truced rival's tips, on average. */
export const TIP_DAYS = 3;

const EMPTY: LadderDef = { rivals: [], taunts: [], overtaken: [], tips: [], sniped: [] };
const ladderOf = (content: Content): LadderDef => content.ladder ?? EMPTY;

export function ladderRival(content: Content, id: string): LadderRivalDef | undefined {
  return ladderOf(content).rivals.find((rival) => rival.id === id);
}

export function rivalScore(state: GameState, content: Content, id: string): number {
  return state.ladder.scores[id] ?? ladderRival(content, id)?.start ?? 0;
}

export interface LadderRow {
  /** A rival's id, or null for the player. */
  readonly id: string | null;
  readonly handle: string;
  readonly score: number;
  readonly outcome?: LadderOutcome;
}

/** The ladder as it stands, top first. The player is on it with their rating. */
export function ladderRows(state: GameState, content: Content): LadderRow[] {
  const rows: LadderRow[] = ladderOf(content).rivals.map((rival) => {
    const outcome = state.ladder.outcomes[rival.id];
    return { id: rival.id, handle: rival.handle, score: Math.floor(rivalScore(state, content, rival.id)), ...(outcome ? { outcome } : {}) };
  });
  rows.push({ id: null, handle: state.player.handle, score: state.player.rating });
  // Ties go to the player: the board lists whoever got there most recently first.
  return rows.sort((a, b) => b.score - a.score || (a.id === null ? -1 : b.id === null ? 1 : 0));
}

/** The player's place on the ladder, 1 = top. */
export function ladderPlace(state: GameState, content: Content): number {
  return ladderRows(state, content).findIndex((row) => row.id === null) + 1;
}

function note(state: GameState, text: string): void {
  state.ladder.moves.unshift({ timeMs: state.clock.gameTimeMs, text });
  state.ladder.moves = state.ladder.moves.slice(0, KEEP_MOVES);
}

function write(state: GameState, from: string, subject: string, body: string): void {
  state.messages.push({ id: `m${state.nextId++}`, from, subject, body, timeMs: state.clock.gameTimeMs, read: false });
}

/** Ids of the rivals above the player right now. */
const above = (state: GameState, content: Content) =>
  ladderOf(content)
    .rivals.filter((rival) => Math.floor(rivalScore(state, content, rival.id)) > state.player.rating)
    .map((rival) => rival.id);

/**
 * Moves the ladder on, once per game day (on the paper's clock): every
 * rival climbs, one may take a job off the board, a truced rival may send
 * a tip, and a rival who passed the player, or was passed, may write.
 * Cheap when the day has already been done.
 */
export function advanceLadder(state: GameState, content: Content): void {
  const ladder = ladderOf(content);
  const today = editionDay(state.clock.gameTimeMs);
  if (ladder.rivals.length === 0 || state.ladder.day >= today) return;
  const first = state.ladder.day < 0;
  state.ladder.day = today;
  const rng = stream(state, 'ladder');
  if (first) {
    // A new ladder: everyone where they start, and nobody has passed anybody yet.
    for (const rival of ladder.rivals) state.ladder.scores[rival.id] ??= rival.start;
    state.ladder.above = above(state, content);
    return;
  }

  for (const rival of ladder.rivals) {
    const pace = rival.pace * (state.ladder.outcomes[rival.id] === 'sold' ? SOLD_PACE : 1);
    state.ladder.scores[rival.id] = rivalScore(state, content, rival.id) + pace * rng.range(0.4, 1.6);
  }

  // A rival near the player's level takes a job off the board.
  const near = ladder.rivals.filter((rival) => Math.abs(rivalScore(state, content, rival.id) - state.player.rating) <= SNIPE_REACH);
  const open = state.contracts.jobs.filter((job) => isJob(job) && job.id !== state.contracts.activeId && !job.news);
  if (near.length > 0 && open.length > 2 && rng.chance(SNIPE_CHANCE)) {
    const rival = rng.pick(near);
    const job = rng.pick(open);
    state.contracts.jobs = state.contracts.jobs.filter((item) => item !== job);
    state.ladder.scores[rival.id] = rivalScore(state, content, rival.id) + job.rating;
    const company = findServer(content, job.targetId);
    note(state, `${rival.handle} took a job at ${company?.name ?? 'a company'} before you could.`);
    if (company && ladder.sniped.length > 0) {
      const story = rng.pick(ladder.sniped);
      const values = { rival: rival.handle, company: company.name, city: company.city, CITY: company.city.toUpperCase() };
      state.news.pending.push({ id: `n${state.nextId++}`, kind: 'world', headline: fill(story.headline, values), body: fill(story.body, values), serverId: company.id });
    }
  }

  // A truced rival keeps their side of it.
  for (const rival of ladder.rivals) {
    if (state.ladder.outcomes[rival.id] !== 'truce' || !rng.chance(1 / TIP_DAYS)) continue;
    const unknown = content.servers.filter((server) => (server.kind === 'company' || server.kind === 'relay') && server.listed && !state.knownServers.includes(server.id));
    if (unknown.length === 0) continue;
    const server = rng.pick(unknown);
    state.knownServers.push(server.id);
    write(state, rival.handle, 'A tip', fill(rng.pick(ladder.tips), { handle: state.player.handle, server: server.name }));
  }

  // Who passed whom since yesterday. One letter a day at most, and never from a friend.
  const now = above(state, content);
  const passedYou = now.filter((id) => !state.ladder.above.includes(id) && state.ladder.outcomes[id] !== 'truce');
  const youPassed = state.ladder.above.filter((id) => !now.includes(id) && state.ladder.outcomes[id] !== 'truce');
  for (const id of passedYou) note(state, `${ladderRival(content, id)!.handle} passed you on the ladder.`);
  for (const id of youPassed) note(state, `You passed ${ladderRival(content, id)!.handle} on the ladder.`);
  const handle = { handle: state.player.handle };
  if (passedYou.length > 0 && ladder.taunts.length > 0) {
    write(state, ladderRival(content, rng.pick(passedYou))!.handle, 'Ladder', fill(rng.pick(ladder.taunts), handle));
  } else if (youPassed.length > 0 && ladder.overtaken.length > 0) {
    write(state, ladderRival(content, rng.pick(youPassed))!.handle, 'Ladder', fill(rng.pick(ladder.overtaken), handle));
  }
  state.ladder.above = now;
}

/** A raider the player traced back: they wait on the ladder for the player to decide what to do with them. */
export function noteBeaten(state: GameState, content: Content, rivalId: string): void {
  if (!ladderRival(content, rivalId) || state.ladder.outcomes[rivalId] || state.ladder.beaten.includes(rivalId)) return;
  state.ladder.beaten.push(rivalId);
  note(state, `You traced ${ladderRival(content, rivalId)!.handle} back to their rig.`);
}

/** True if a rival should be left out of random raids: their address was sold, or there is a truce. */
export function outOfRaids(state: GameState, rivalId: string): boolean {
  const outcome = state.ladder.outcomes[rivalId];
  return outcome === 'sold' || outcome === 'truce';
}

/** True for a relay that is the player's own: a beaten rival's rig, kept. It never warms up. */
export function privateRelay(state: GameState, content: Content, serverId: string): boolean {
  return Object.entries(state.ladder.outcomes).some(([id, outcome]) => outcome === 'relay' && content.rivals.find((rival) => rival.id === id)?.homeId === serverId);
}

/** What selling a beaten rival's address pays. */
export function addressPrice(content: Content, rivalId: string): number {
  return ADDRESS_PRICE * (content.rivals.find((rival) => rival.id === rivalId)?.level ?? 1);
}

/** Decides what to do with a rival the player beat. Null on success, else the reason. */
export function settleRival(state: GameState, content: Content, rivalId: string, outcome: LadderOutcome): string | null {
  const rival = ladderRival(content, rivalId);
  if (!rival || !state.ladder.beaten.includes(rivalId)) return 'You have nothing on them to decide about.';
  state.ladder.beaten = state.ladder.beaten.filter((id) => id !== rivalId);
  state.ladder.outcomes[rivalId] = outcome;
  if (outcome === 'sold') {
    const price = addressPrice(content, rivalId);
    state.player.balance += price;
    state.ladder.scores[rivalId] = rivalScore(state, content, rivalId) * 0.7;
    note(state, `${rival.handle}'s address went to the highest bidder. They have gone quiet.`);
  } else if (outcome === 'relay') {
    note(state, `You kept ${rival.handle}'s rig as a private relay.`);
  } else {
    note(state, `You and ${rival.handle} called a truce.`);
  }
  return null;
}
