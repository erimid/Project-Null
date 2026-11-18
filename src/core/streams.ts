/**
 * Named random streams that live in the save file.
 *
 * Each system asks for its own stream by name, e.g. stream(state, 'trace').
 * Its position is written back into GameState after every draw, so a game
 * that is saved and loaded continues with exactly the same random numbers.
 */
import { createRng, restoreRng, type Rng } from './rng';
import type { GameState } from './state';

export function stream(state: GameState, name: string): Rng {
  const seed = createRng(state.seed).fork(name).getState().seed;
  const saved = state.rngStreams[name];
  const rng = saved === undefined ? createRng(seed) : restoreRng({ seed, state: saved });
  const remember = () => {
    state.rngStreams[name] = rng.getState().state;
  };
  const tracked = <A extends unknown[], R>(draw: (...args: A) => R) => {
    return (...args: A): R => {
      const value = draw(...args);
      remember();
      return value;
    };
  };
  return {
    next: tracked(rng.next),
    int: tracked(rng.int),
    range: tracked(rng.range),
    chance: tracked(rng.chance),
    pick: tracked(rng.pick) as Rng['pick'],
    shuffle: tracked(rng.shuffle) as Rng['shuffle'],
    fork: rng.fork,
    getState: rng.getState,
  };
}
