/**
 * The story director. The story is a set of lines (see content/story.ts),
 * each walking its own beats one at a time. A line opens when its
 * condition holds. A beat arrives when the player's rating, the time since
 * the line's last beat, any contract it requires and any condition it
 * waits on allow it. Arriving sends a message, puts a story contract on
 * the board, or sets an enemy hacker loose. A contract beat then waits for
 * its delivery; a beat with no contract passes straight on.
 *
 * A passing beat sets its flag (`story:<id>`) and any flags it names, and
 * may move standing (the AIs' hidden trust among them). A beat whose `if`
 * does not hold when its line reaches it is skipped. A beat with a lapse
 * is a timed turn: left undone too long, it fires once, and may withdraw
 * the beat's contract so the line moves on without it.
 *
 * Safe to call any time: on every delivery and once a game minute from the
 * clock. It does nothing once every open line is over.
 */
import { beatFlag, linesOf, MAIN_LINE, type StoryBeat, type StoryLapse, type StoryLine, type StoryMail, type StoryNeed } from '../content/story';
import type { ConditionDef, LeadDef } from '../content/schema';
import { conditionMet, readClueFlag } from './conditions';
import { maxConnections } from './hardware';
import { heistLines } from './heists';
import { liftStanding, shiftStanding, standingWith } from './patrons';
import { scheduleRaid } from './raid';
import { freeServer, noteStoryJob, takeServer } from './chorus';
import type { GameState, StoryLineState } from './state';
import { sendLetter, type Content } from './world';

/** The patron id that holds the AIs' trust. It is hidden: the player never sees the number. */
export const AI_TRUST = 'ais';

/** How far the AIs trust the player. */
export function aiTrust(state: GameState): number {
  return standingWith(state, AI_TRUST);
}

/** True once the beat has passed (done, not skipped or withdrawn). */
export function beatPassed(state: GameState, beatId: string): boolean {
  return state.flags.includes(beatFlag(beatId));
}

/** The beat a line is waiting on, or undefined if it has not opened or is over. Main line by default. */
export function currentBeat(state: GameState, content: Content, lineId: string = MAIN_LINE): StoryBeat | undefined {
  const line = linesOf(content.story).find((item) => item.id === lineId);
  const at = state.story.lines[lineId];
  return line && at ? line.beats[at.beat] : undefined;
}

/** Ids of the story contracts on the board right now. */
export function storyOffered(state: GameState): readonly string[] {
  return state.story.offered;
}

/** Ids of every beat that has arrived so far, line by line in story order. */
export function beatsSeen(state: GameState, content: Content): string[] {
  return linesOf(content.story).flatMap((line) => {
    const at = state.story.lines[line.id];
    if (!at) return [];
    const count = Math.min(line.beats.length, at.beat + (at.arrived ? 1 : 0));
    return line.beats.slice(0, count).map((beat) => beat.id);
  });
}

function lineOpens(state: GameState, line: StoryLine): boolean {
  return state.player.rating >= (line.minRating ?? 0) && conditionMet(state, line.when);
}

/** True once nothing more can happen now: every open line is over and no closed line could open. */
export function storyComplete(state: GameState, content: Content): boolean {
  return linesOf(content.story).every((line) => {
    const at = state.story.lines[line.id];
    return at ? at.beat >= line.beats.length : !lineOpens(state, line);
  });
}

/** The rating gate as it stands: lower once the player has followed the lead, if there is one. */
export function gateRating(state: GameState, item: { readonly minRating?: number; readonly lead?: LeadDef }): number {
  const gate = item.minRating ?? 0;
  return item.lead && conditionMet(state, item.lead.when) ? Math.min(gate, item.lead.minRating) : gate;
}

/** Whether a beat may arrive now, needs aside: its rating, its spacing, any contract and condition it waits on. */
function beatDue(state: GameState, at: StoryLineState, beat: StoryBeat): boolean {
  if (state.player.rating < gateRating(state, beat)) return false;
  if (state.clock.gameTimeMs < at.lastMs + (beat.afterHours ?? 0) * 3_600_000) return false;
  if (beat.requires !== undefined && !state.contracts.completed.includes(beat.requires)) return false;
  return conditionMet(state, beat.when);
}

/** True if the player has this in hand now. */
export function needMet(state: GameState, content: Content, need: StoryNeed): boolean {
  if (need.rating !== undefined && state.player.rating < need.rating) return false;
  if (need.lines !== undefined && maxConnections(state, content) < need.lines) return false;
  if (need.linesFor !== undefined) {
    const contract = content.contracts.find((item) => item.id === need.linesFor);
    if (contract && maxConnections(state, content) < heistLines(state, contract)) return false;
  }
  return conditionMet(state, need.when);
}

/** A beat the story is holding back until the player is ready, and what it is waiting for. */
export interface StoryWait {
  readonly lineId: string;
  readonly beatId: string;
  readonly needs: readonly { readonly note: string; readonly met: boolean }[];
}

/** Beats that are due but for what the player has in hand, each with its needs met and unmet. */
export function storyWaits(state: GameState, content: Content): StoryWait[] {
  return linesOf(content.story).flatMap((line) => {
    const at = state.story.lines[line.id];
    const beat = at && !at.arrived ? line.beats[at.beat] : undefined;
    if (!at || !beat?.needs || (beat.if && !conditionMet(state, beat.if)) || !beatDue(state, at, beat)) return [];
    const needs = beat.needs.map((need) => ({ note: need.note, met: needMet(state, content, need) }));
    return needs.some((need) => !need.met) ? [{ lineId: line.id, beatId: beat.id, needs }] : [];
  });
}

/** Every file some condition in the content asks the player to have read, as "serverId/file name". */
const clueCache = new WeakMap<Content, ReadonlySet<string>>();
export function clueFiles(content: Content): ReadonlySet<string> {
  const known = clueCache.get(content);
  if (known) return known;
  const found = new Set<string>();
  const walk = (condition: ConditionDef | undefined): void => {
    if (!condition) return;
    for (const ref of condition.read ?? []) found.add(ref);
    for (const part of [...(condition.anyOf ?? []), ...(condition.atLeast?.of ?? [])]) walk(part);
  };
  for (const line of linesOf(content.story)) {
    walk(line.when);
    for (const beat of line.beats) {
      walk(beat.when);
      walk(beat.if);
      walk(beat.lead?.when);
      for (const need of beat.needs ?? []) walk(need.when);
    }
  }
  for (const contract of content.contracts) {
    walk(contract.when);
    walk(contract.lead?.when);
  }
  clueCache.set(content, found);
  return found;
}

/** Remembers that the player read a file, if the story cares whether they did (a clue). */
export function noteClue(state: GameState, content: Content, serverId: string, name: string): void {
  const ref = `${serverId}/${name}`;
  if (!clueFiles(content).has(ref)) return;
  const flag = readClueFlag(ref);
  if (!state.flags.includes(flag)) state.flags.push(flag);
}

/** A beat is done once its contract is delivered; a beat with no contract is done as soon as it arrives. */
function beatDone(state: GameState, beat: StoryBeat): boolean {
  return beat.contractId === undefined || state.contracts.completed.includes(beat.contractId);
}

function sendStoryMail(state: GameState, mail: StoryMail, fill: Readonly<Record<string, string>> = {}): void {
  sendLetter(state, mail, fill);
}

function setFlags(state: GameState, set: readonly string[] | undefined, clear: readonly string[] | undefined): void {
  for (const flag of set ?? []) if (!state.flags.includes(flag)) state.flags.push(flag);
  if (clear && clear.length > 0) state.flags = state.flags.filter((flag) => !clear.includes(flag));
}

/** Sends a beat's message, posts its contract, and sets its attacker going. */
function arriveBeat(state: GameState, content: Content, beat: StoryBeat): void {
  if (beat.mail) sendStoryMail(state, beat.mail);
  if (beat.contractId && !state.story.offered.includes(beat.contractId)) {
    state.story.offered.push(beat.contractId);
  }
  if (beat.raid) scheduleRaid(state, content, beat.raid, true);
}

/** Sets a passing beat's flags and moves its standing. */
function passBeat(state: GameState, content: Content, beat: StoryBeat): void {
  if (!state.flags.includes(beatFlag(beat.id))) state.flags.push(beatFlag(beat.id));
  setFlags(state, beat.set, beat.clear);
  for (const [patronId, least] of Object.entries(beat.floor ?? {})) liftStanding(state, content, patronId, least);
  for (const [patronId, delta] of Object.entries(beat.standing ?? {})) shiftStanding(state, content, patronId, delta);
  for (const id of beat.take ?? []) takeServer(state, content, id);
  for (const id of beat.free ?? []) freeServer(state, content, id);
  if (beat.contractId) {
    const contract = content.contracts.find((item) => item.id === beat.contractId);
    noteStoryJob(state, content, contract?.patron, beat.chorus ?? 0);
  } else if (beat.chorus) {
    noteStoryJob(state, content, undefined, beat.chorus, false);
  }
}

/** Fires a timed turn. True if it withdrew the beat's contract, so the line moves on. */
function fireLapse(state: GameState, content: Content, beat: StoryBeat, lapse: StoryLapse): boolean {
  if (lapse.mail) sendStoryMail(state, lapse.mail);
  setFlags(state, lapse.set, lapse.clear);
  for (const id of lapse.take ?? []) takeServer(state, content, id);
  if (!lapse.withdraw) return false;
  // A contract being worked on is not snatched away; the turn waits for the player to give it up or finish it.
  return state.contracts.activeId !== beat.contractId;
}

function moveOn(state: GameState, line: StoryLine, at: StoryLineState, beat: StoryBeat): void {
  if (beat.contractId) state.story.offered = state.story.offered.filter((id) => id !== beat.contractId);
  at.beat += 1;
  at.arrived = false;
  delete at.lapsed;
  delete at.warned;
  delete at.waited;
  placeLine(line, at);
  at.lastMs = state.clock.gameTimeMs;
}

/** Notes which beat a line is on by id (none once it is over). */
function placeLine(line: StoryLine, at: StoryLineState): void {
  const id = line.beats[at.beat]?.id;
  if (id === undefined) delete at.id;
  else at.id = id;
}

/** Moves one line on by one step. True if anything changed. */
function stepLine(state: GameState, content: Content, line: StoryLine): boolean {
  let at = state.story.lines[line.id];
  if (!at) {
    if (!lineOpens(state, line)) return false;
    at = { beat: 0, arrived: false, lastMs: state.clock.gameTimeMs };
    placeLine(line, at);
    state.story.lines[line.id] = at;
    return true;
  }
  const beat = line.beats[at.beat];
  if (!beat) return false;
  if (!at.arrived) {
    if (beat.if && !conditionMet(state, beat.if)) {
      // Skipped: the line moves on, and the next beat's spacing still counts from the last real one.
      const lastMs = at.lastMs;
      moveOn(state, line, at, beat);
      at.lastMs = lastMs;
      return true;
    }
    if (!beatDue(state, at, beat)) return false;
    const missing = (beat.needs ?? []).filter((need) => !needMet(state, content, need));
    if (missing.length > 0) {
      // Ready but for what the player has in hand: say once what is missing, then wait.
      if (beat.waitMail && !at.waited) {
        at.waited = true;
        sendStoryMail(state, beat.waitMail, { needs: missing.map((need) => `- ${need.note}`).join('\n') });
        return true;
      }
      return false;
    }
    arriveBeat(state, content, beat);
    at.arrived = true;
    at.lastMs = state.clock.gameTimeMs;
    return true;
  }
  if (beatDone(state, beat)) {
    passBeat(state, content, beat);
    moveOn(state, line, at, beat);
    return true;
  }
  const lapse = beat.lapse;
  // A turn that is coming says so first, once, unless the job is already in hand.
  if (lapse?.warn && !at.warned && !at.lapsed && state.clock.gameTimeMs >= at.lastMs + lapse.warn.hours * 3_600_000) {
    at.warned = true;
    if (state.contracts.activeId !== beat.contractId) sendStoryMail(state, lapse.warn.mail);
    return true;
  }
  if (lapse && state.clock.gameTimeMs >= at.lastMs + lapse.hours * 3_600_000) {
    if (!at.lapsed) {
      at.lapsed = true;
      if (fireLapse(state, content, beat, lapse)) moveOn(state, line, at, beat);
      return true;
    }
    if (lapse.withdraw && state.contracts.activeId !== beat.contractId) {
      moveOn(state, line, at, beat);
      return true;
    }
  }
  return false;
}

/** Moves the story forward as far as it can go. */
export function advanceStory(state: GameState, content: Content): void {
  const lines = linesOf(content.story);
  // Every step opens a line, or moves a beat on: a bounded number of them, so this always ends.
  const limit = lines.length * 2 + content.story.beats.length * 3 + 1;
  for (let guard = 0; guard < limit; guard++) {
    let changed = false;
    for (const line of lines) if (stepLine(state, content, line)) changed = true;
    if (!changed) return;
  }
}

/** Fills in the flags of beats an old save had already passed, before beats set flags. Safe to call on every load. */
export function backfillStoryFlags(state: GameState, content: Content): void {
  for (const [rivalId, outcome] of Object.entries(state.ladder.outcomes)) {
    const flag = `ladder:${rivalId}:${outcome}`;
    if (!state.flags.includes(flag)) state.flags.push(flag);
  }
  for (const line of linesOf(content.story)) {
    const at = state.story.lines[line.id];
    if (!at) continue;
    realignLine(line, at);
    for (const beat of line.beats.slice(0, at.beat)) {
      if (!beat.if && !beat.lapse && !state.flags.includes(beatFlag(beat.id))) state.flags.push(beatFlag(beat.id));
    }
  }
}

/**
 * Puts a line back on the beat it remembers by id, if new beats were
 * written in ahead of it (or old ones taken out) since the save was made.
 * A save from before ids takes its id from where it stands. A beat that
 * is gone leaves the line where it was.
 */
function realignLine(line: StoryLine, at: StoryLineState): void {
  if (at.id !== undefined) {
    const index = line.beats.findIndex((beat) => beat.id === at.id);
    if (index >= 0) at.beat = index;
  }
  at.beat = Math.min(at.beat, line.beats.length);
  placeLine(line, at);
}
