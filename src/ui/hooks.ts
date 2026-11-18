import { useEffect, useRef, useState } from 'preact/hooks';
import type { GameState } from '../core';
import { session, type SaveStatus } from './session';

/**
 * Re-renders the component only when `read()` returns a different value.
 * Have `read` return text, numbers or booleans (or an unchanged object),
 * not a new object every time.
 */
function useStore<T>(subscribe: (listener: () => void) => () => void, read: () => T): T {
  const latest = useRef(read);
  latest.current = read;
  const [value, setValue] = useState(read);
  useEffect(() => {
    const update = () => setValue(() => latest.current());
    update();
    return subscribe(update);
  }, [subscribe]);
  return value;
}

/**
 * Reads one simple value (text, number, true/false) out of the game, e.g.
 * useGame((game) => game.player.balance). Checked on every clock tick.
 */
export function useGame<T>(select: (game: GameState) => T): T {
  return useStore(session.subscribeGame, () => select(session.getState()));
}

/**
 * Reads anything out of the game, including lists and objects. The
 * component re-renders whenever the player does something or a game is
 * loaded, but not on clock ticks, so don't use it for the time.
 */
export function useWorld<T>(select: (game: GameState) => T): T {
  useStore(session.subscribeChanges, session.getRevision);
  return select(session.getState());
}

export function useSaveStatus(): SaveStatus {
  return useStore(session.subscribeSaves, session.getSaveStatus);
}
