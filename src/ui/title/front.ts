/**
 * Which screen is up: the title, the opening of a new career, or the
 * desk. The game's clock only runs at the desk.
 */
import { useEffect, useState } from 'preact/hooks';
import { session, type NewCareer } from '../session';

export type Panel = 'menu' | 'new' | 'load' | 'settings' | 'credits';

export interface Front {
  readonly screen: 'title' | 'opening' | 'desk';
  /** What the title screen is showing. */
  readonly panel: Panel;
  /** The slot a new game was asked for from Saved games, if it was. */
  readonly slot: number | null;
}

let state: Front = { screen: 'title', panel: 'menu', slot: null };
const listeners = new Set<() => void>();

function set(next: Partial<Front>): void {
  state = { ...state, ...next };
  listeners.forEach((listener) => listener());
}

export const front = {
  get: (): Front => state,
  show: (panel: Panel) => set({ panel, slot: null }),
  /** Leaves the desk for the title screen. The game is saved first. */
  toTitle(panel: Panel = 'menu', slot: number | null = null): void {
    session.leave();
    set({ screen: 'title', panel, slot });
  },
  /** Sits down at the desk with the game that is loaded. */
  play(): void {
    session.enter();
    set({ screen: 'desk', panel: 'menu', slot: null });
  },
  /** Starts a new career and plays its opening. */
  async begin(career: NewCareer): Promise<boolean> {
    if (!(await session.newGame(career))) return false;
    set({ screen: 'opening', panel: 'menu', slot: null });
    return true;
  },
};

export function useFront(): Front {
  const [value, setValue] = useState(state);
  useEffect(() => {
    const update = () => setValue(state);
    listeners.add(update);
    update();
    return () => void listeners.delete(update);
  }, []);
  return value;
}
