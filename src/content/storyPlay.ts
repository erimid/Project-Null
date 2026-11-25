/**
 * A scripted player for the story tests: a new game at a high rating
 * that delivers whatever the story puts on the board, choosing as it is
 * told, a quarter of a game day at a time. Not part of the game.
 */
import { createGame, postJobs, syncWithContent, worldFor, type Content, type GameState } from '../core';
import { advanceStory, storyOffered } from '../core/story';
import { events, assets, chorus, companies, contracts, data, endings, gameInfo, hardware, ladder, mail, models, modules, news, patrons, people, programs, rivals, servers, skills, story, tuning } from './index';

const written: Content = { servers, startingServers: gameInfo.startingServers, programs, startingPrograms: gameInfo.startingPrograms, contracts, mail, people, models, hardware, companies, skills, modules, rivals, story, news, patrons, ladder, events, data, assets, rules: tuning, chorus, endings };

export const HOUR = 3_600_000;
export const content = worldFor(written, 31);

export function fresh(): GameState {
  const state = syncWithContent(createGame({ seed: 31, handle: 'Kestrel', startDate: tuning.startDate, startingBalance: 500_000 }), content);
  state.player.rating = 130;
  state.player.bestRating = 130;
  // A gateway that can run the final job alone: the last job waits for one that can (see the story's needs).
  state.player.hardware.ports = 4;
  // Acts 1 and 2 hang on a written job the board posts.
  state.contracts.completed.push('halvorsen-lantern');
  postJobs(state, content);
  return state;
}

/** Plays the story: delivers whatever is offered (except `skip`), choosing as `choose` says, for `days` game days. */
export function play(state: GameState, choose: Record<string, string> = {}, skip: readonly string[] = [], days = 60): void {
  for (let step = 0; step < days * 4; step++) {
    advanceStory(state, content);
    for (const id of storyOffered(state)) {
      if (skip.includes(id) || state.contracts.completed.includes(id)) continue;
      const contract = content.contracts.find((item) => item.id === id)!;
      if (contract.choices?.length) state.patrons.choices[id] = choose[id] ?? 'default';
      state.contracts.completed.push(id);
    }
    state.clock.gameTimeMs += 6 * HOUR;
  }
  advanceStory(state, content);
}
