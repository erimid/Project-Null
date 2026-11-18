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

/** Reads one value out of the game, e.g. useGame((game) => game.player.balance). */
export function useGame<T>(select: (game: GameState) => T): T {
  return useStore(session.subscribeGame, () => select(session.getState()));
}

export function useSaveStatus(): SaveStatus {
  return useStore(session.subscribeSaves, session.getSaveStatus);
}
