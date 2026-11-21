/**
 * Chorus spreading through the world (see content/chorus.ts).
 *
 * Once the story sets Chorus's flag, a slow clock runs: every so many game
 * hours it takes one more server. It spreads faster while the player has
 * delivered no story job for a while, and a delivered story job for the
 * Office or the AIs sets it back. The story can also take or free a
 * server by name.
 *
 * A taken server is marked (globe and address book), gets a polite note
 * for the player, and tidies the player out of its own access log once
 * they have gone. So work there is quietly easier, which is the
 * unsettling part. Every few servers, Chorus comes to the gateway too.
 */
import { CHORUS_ID, type ChorusDef } from '../content/chorus';
import { fill } from './generate';
import { markServer } from './news';
import { scheduleRaid } from './raid';
import { stream } from './streams';
import type { GameState } from './state';
import { findServer, type Content } from './world';
import { reachEnding, sendLetter } from './endings';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** True once the story has woken Chorus. */
export function chorusAwake(state: GameState, content: Content): boolean {
  return !!content.chorus && state.flags.includes(content.chorus.awakeFlag);
}

export function isTaken(state: GameState, serverId: string): boolean {
  return state.chorus.taken.includes(serverId);
}

/** Game time the story has been left waiting since the player last delivered a story job (see ChorusState.ignoredMs). */
export function storyQuietMs(state: GameState): number {
  return state.chorus.ignoredMs;
}

/** True while a story job is on the board and nobody is working on it: the story is waiting for the player. */
function storyWaiting(state: GameState): boolean {
  return state.story.offered.some((id) => id !== state.contracts.activeId);
}

/** Game ms until the next server is taken at the pace right now. */
function spreadMs(state: GameState, chorus: ChorusDef): number {
  const quiet = storyQuietMs(state) >= chorus.quietDays * DAY;
  return (chorus.spreadHours * HOUR) / (quiet ? chorus.quietPace : 1);
}

/** Servers Chorus could take on its own right now. */
export function chorusTargets(state: GameState, content: Content): string[] {
  const chorus = content.chorus;
  if (!chorus) return [];
  const connected = new Set(state.connections.map((connection) => connection.serverId));
  // The story decides what happens to its own servers.
  const story = new Set(
    content.contracts
      .filter((contract) => contract.story && !state.contracts.completed.includes(contract.id))
      .flatMap((contract) => [contract.targetId, ...(contract.stages ?? []).map((stage) => stage.targetId), ...(contract.heist?.holds ?? []).map((hold) => hold.targetId)]),
  );
  return content.servers
    .filter((server) => server.kind === 'company' && !chorus.protected.includes(server.id) && !isTaken(state, server.id) && !connected.has(server.id) && !story.has(server.id))
    .map((server) => server.id);
}

/** Chorus takes a server: marked, a note left, the Wire told. Every few, it comes to the gateway. */
export function takeServer(state: GameState, content: Content, serverId: string, quietly = false): void {
  const chorus = content.chorus;
  const server = findServer(content, serverId);
  if (!chorus || !server || isTaken(state, serverId)) return;
  state.chorus.taken.push(serverId);
  state.chorus.takes += 1;
  markServer(state, serverId, chorus.label);
  const files = state.servers[serverId]?.files;
  const name = fill(chorus.note.name, { handle: state.player.handle });
  if (files && !files.some((file) => file.name === name)) {
    files.push({ name, sizeGq: 1, access: 'guest', text: fill(chorus.note.text, { handle: state.player.handle }) });
  }
  // Taken all at once (the Chorus ending), it is one story, not a hundred.
  if (quietly) return;
  const rng = stream(state, 'chorus');
  const item = rng.pick(chorus.news);
  state.news.pending.push({
    id: `n${state.nextId++}`,
    kind: 'world',
    headline: fill(item.headline, { company: server.name }),
    body: fill(item.body, { company: server.name }),
    serverId,
  });
  if (chorus.raidEvery > 0 && state.chorus.takes % chorus.raidEvery === 0) scheduleRaid(state, content, CHORUS_ID);
}

/** The story wins a server back: unmarked, its note gone. */
export function freeServer(state: GameState, content: Content, serverId: string): void {
  const chorus = content.chorus;
  if (!chorus || !isTaken(state, serverId)) return;
  state.chorus.taken = state.chorus.taken.filter((id) => id !== serverId);
  if (state.news.marks[serverId]?.label === chorus.label) delete state.news.marks[serverId];
  const name = fill(chorus.note.name, { handle: state.player.handle });
  const server = state.servers[serverId];
  if (server) server.files = server.files.filter((file) => file.name !== name);
}

/** A delivered story job: the quiet ends, and one for the Office or the AIs sets the clock back. */
export function noteStoryJob(state: GameState, content: Content, patronId: string | undefined, extraHours = 0, delivered = true): void {
  const chorus = content.chorus;
  if (delivered) {
    state.chorus.ignoredMs = 0;
    state.chorus.warned = 0;
  }
  if (!chorus || state.chorus.nextMs === 0) return;
  const push = (patronId && chorus.pushPatrons.includes(patronId) ? chorus.pushbackHours : 0) + extraHours;
  if (push > 0) state.chorus.nextMs += push * HOUR;
}

/** A taken server the player has left forgets they were there. */
function tidy(state: GameState, content: Content, chorus: ChorusDef): void {
  const connected = new Set(state.connections.map((connection) => connection.serverId));
  for (const id of state.chorus.taken) {
    const server = state.servers[id];
    if (!server || connected.has(id)) continue;
    // Lines the player wrote on purpose to point at someone else are left: that is the player's work, not their trail.
    const kept = server.logs.filter((entry) => !entry.byPlayer || entry.framed !== undefined);
    if (kept.length === server.logs.length) continue;
    kept.push({ id: state.nextId++, timeMs: state.clock.gameTimeMs, text: chorus.tidyLine, byPlayer: false });
    server.logs = kept;
  }
  void content;
}

/** Runs Chorus's clock. Called once a game minute. */
export function advanceChorus(state: GameState, content: Content): void {
  const chorus = content.chorus;
  if (!chorus || !chorusAwake(state, content)) return;
  const now = state.clock.gameTimeMs;
  // After the ending the clock stops; what it already holds it keeps tidy.
  if (state.ending) {
    if (state.chorus.taken.length > 0) tidy(state, content, chorus);
    return;
  }
  if (state.chorus.checkedMs > 0 && storyWaiting(state)) state.chorus.ignoredMs += Math.max(0, now - state.chorus.checkedMs);
  state.chorus.checkedMs = now;
  if (chorus.doom && doom(state, content, chorus.doom)) return;
  if (state.chorus.nextMs === 0) state.chorus.nextMs = now + spreadMs(state, chorus);
  // A long jump in time (a save loaded days later) takes a few at most, not a flood.
  for (let guard = 0; guard < 5 && now >= state.chorus.nextMs; guard++) {
    const targets = chorusTargets(state, content);
    if (targets.length > 0) takeServer(state, content, stream(state, 'chorus').pick(preferKnown(state, targets)));
    state.chorus.nextMs += spreadMs(state, chorus);
  }
  if (now >= state.chorus.nextMs) state.chorus.nextMs = now + spreadMs(state, chorus);
  if (state.chorus.taken.length > 0) tidy(state, content, chorus);
}

/** Warns of the long silence, then ends it. True if the story has just ended. */
function doom(state: GameState, content: Content, rule: NonNullable<ChorusDef['doom']>): boolean {
  const days = state.chorus.ignoredMs / DAY;
  const before = state.chorus.warned;
  while (state.chorus.warned < rule.warnings.length && days >= rule.warnings[state.chorus.warned]!.days) {
    sendLetter(state, rule.warnings[state.chorus.warned]!.mail);
    state.chorus.warned += 1;
  }
  // Every warning is always seen before the end, even after a long jump in time.
  if (days < rule.days || state.chorus.warned < rule.warnings.length || state.chorus.warned !== before) return false;
  reachEnding(state, content, rule.ending);
  return true;
}

/** Servers the player knows come first, so they see it happen. */
function preferKnown(state: GameState, targets: string[]): string[] {
  const known = targets.filter((id) => state.knownServers.includes(id));
  return known.length > 0 ? known : targets;
}
