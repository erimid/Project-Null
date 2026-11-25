/**
 * The end of the story (see content/endings.ts). Reached by finishing the
 * final job a certain way, or for Chorus by leaving the story waiting too
 * long. Reaching it sets `ending:<id>`, sends its letter, moves standing,
 * prints its news, and changes Chorus, the patrons and the paper from then
 * on. Play continues: the board, the shops and the ladder stay.
 */
import { endingFlag, type EndingDef } from '../content/endings';
import type { StoryMail } from '../content/story';
import type { ChoiceDef, ContractDef } from '../content/schema';
import { conditionMet } from './conditions';
import { fill } from './generate';
import { freeServer, takeServer } from './chorus';
import { shiftStanding } from './patrons';
import type { GameState, NewsItem } from './state';
import type { Rng } from './rng';
import type { Content } from './world';

export function findEnding(content: Content, id: string | undefined): EndingDef | undefined {
  return id === undefined ? undefined : content.endings?.find((ending) => ending.id === id);
}

/** The ending reached, if any. */
export function endingOf(state: GameState, content: Content): EndingDef | undefined {
  return findEnding(content, state.ending?.id);
}

/** A letter written in the content, with {handle} filled in. */
export function sendLetter(state: GameState, mail: StoryMail): void {
  const values = { handle: state.player.handle };
  state.messages.push({ id: `m${state.nextId++}`, from: fill(mail.from, values), subject: fill(mail.subject, values), body: fill(mail.body, values), timeMs: state.clock.gameTimeMs, read: false, kind: 'story' });
}

/** True if a patron has left the world with the ending. */
export function patronGone(state: GameState, content: Content, patronId: string): boolean {
  return endingOf(state, content)?.gone.includes(patronId) ?? false;
}

/** The ways to finish a contract the player has earned right now. */
export function offeredChoices(state: GameState, contract: ContractDef): ChoiceDef[] {
  return (contract.choices ?? []).filter((choice) => conditionMet(state, choice.when));
}

/** Ends the story. Does nothing if it has already ended. */
export function reachEnding(state: GameState, content: Content, id: string): void {
  const ending = findEnding(content, id);
  if (!ending || state.ending) return;
  state.ending = { id, atMs: state.clock.gameTimeMs };
  if (!state.flags.includes(endingFlag(id))) state.flags.push(endingFlag(id));
  sendLetter(state, ending.mail);
  for (const [patronId, delta] of Object.entries(ending.standing)) shiftStanding(state, content, patronId, delta);
  if (ending.chorus === 'free') {
    for (const serverId of [...state.chorus.taken]) freeServer(state, content, serverId);
  } else if (ending.chorus === 'spread') {
    for (const server of content.servers) if (server.kind === 'company') takeServer(state, content, server.id, true);
  }
  // Nothing more is waiting on a silence that is over.
  state.chorus.ignoredMs = 0;
  for (const item of ending.news) state.news.pending.push({ id: `n${state.nextId++}`, kind: 'story', headline: item.headline, body: item.body });
}

/** The ending's mark on a morning's paper, if the story has ended. */
export function endingPaper(state: GameState, content: Content, rng: Rng): NewsItem | undefined {
  const ending = endingOf(state, content);
  if (!ending || ending.paper.length === 0) return undefined;
  // The first paper after carries the ending's own news (pending), not this.
  const item = rng.pick(ending.paper);
  return { id: `n${state.nextId++}`, kind: 'world', headline: item.headline, body: item.body };
}
