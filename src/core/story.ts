/**
 * The story director. It walks the player through Act 1's beats one at a
 * time (see content/story.ts). A beat arrives when the player's rating and
 * the time since the last beat allow it, and once any contract it requires
 * is done. Arriving sends a message, puts a story contract on the board, or
 * sets an enemy hacker loose. A contract beat then waits for its delivery;
 * a beat with no contract passes straight on to the next.
 *
 * Safe to call any time: on every delivery and once a game minute from the
 * clock. It does nothing once the act is over.
 */
import type { StoryBeat } from '../content/story';
import { scheduleRaid } from './raid';
import type { GameState } from './state';
import type { Content } from './world';

/** The beat the story is waiting on, or undefined once the act is over. */
export function currentBeat(state: GameState, content: Content): StoryBeat | undefined {
  return content.story.beats[state.story.beat];
}

/** Ids of the story contracts on the board right now. */
export function storyOffered(state: GameState): readonly string[] {
  return state.story.offered;
}

/** True once every beat has been seen. */
export function storyComplete(state: GameState, content: Content): boolean {
  return state.story.beat >= content.story.beats.length;
}

/** Whether a beat may arrive now: its rating, its spacing, and any contract it waits on. */
function beatReady(state: GameState, beat: StoryBeat): boolean {
  if (state.player.rating < (beat.minRating ?? 0)) return false;
  if (state.clock.gameTimeMs < state.story.lastMs + (beat.afterHours ?? 0) * 3_600_000) return false;
  if (beat.requires !== undefined && !state.contracts.completed.includes(beat.requires)) return false;
  return true;
}

/** A beat is done once its contract is delivered; a beat with no contract is done as soon as it arrives. */
function beatDone(state: GameState, beat: StoryBeat): boolean {
  return beat.contractId === undefined || state.contracts.completed.includes(beat.contractId);
}

/** Sends a beat's message, posts its contract, and sets its attacker going. */
function arriveBeat(state: GameState, content: Content, beat: StoryBeat): void {
  if (beat.mail) {
    state.messages.push({
      id: `m${state.nextId++}`,
      from: beat.mail.from,
      subject: beat.mail.subject,
      body: beat.mail.body,
      timeMs: state.clock.gameTimeMs,
      read: false,
    });
  }
  if (beat.contractId && !state.story.offered.includes(beat.contractId)) {
    state.story.offered.push(beat.contractId);
  }
  if (beat.raid) scheduleRaid(state, content, beat.raid, true);
}

/** Moves the story forward as far as it can go. */
export function advanceStory(state: GameState, content: Content): void {
  const beats = content.story.beats;
  // At most one pass per beat, so a run of auto beats all fire but nothing loops forever.
  for (let guard = 0; guard <= beats.length; guard++) {
    const beat = beats[state.story.beat];
    if (!beat) return;
    if (!state.story.arrived) {
      if (!beatReady(state, beat)) return;
      arriveBeat(state, content, beat);
      state.story.arrived = true;
      state.story.lastMs = state.clock.gameTimeMs;
    }
    if (!beatDone(state, beat)) return;
    if (beat.contractId) state.story.offered = state.story.offered.filter((id) => id !== beat.contractId);
    state.story.beat += 1;
    state.story.arrived = false;
    state.story.lastMs = state.clock.gameTimeMs;
  }
}
