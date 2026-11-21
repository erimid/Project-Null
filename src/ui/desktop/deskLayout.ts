/**
 * Which desk layout is in use, and whether the game changes it by itself:
 * to Run when a connection opens, and back when the last one closes.
 * A setting kept per browser, like the window positions.
 */
import { useEffect, useState } from 'preact/hooks';
import { activeContract } from '../../core';
import { content, session } from '../session';
import { deskStore } from './deskStore';
import { DESKS, type DeskName } from './desks';
import { windows } from './windowStore';

export interface DeskLayout {
  /** The layout last chosen, by the player or by the game. */
  readonly current: DeskName;
  /** The game switches to Run on connecting and back on disconnecting. */
  readonly auto: boolean;
  /** The layout to go back to when the last connection closes. */
  readonly back: DeskName;
}

const STORAGE_KEY = 'project-null.desk.v1';

function load(): DeskLayout {
  const fresh: DeskLayout = { current: 'plan', auto: true, back: 'plan' };
  try {
    const kept = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<DeskLayout> | null;
    if (typeof kept !== 'object' || kept === null) return fresh;
    const name = (value: unknown, otherwise: DeskName) => (DESKS.includes(value as DeskName) ? (value as DeskName) : otherwise);
    return { current: name(kept.current, 'plan'), auto: kept.auto !== false, back: name(kept.back, 'plan') };
  } catch {
    // Unreadable or blocked storage: start from the usual desk.
    return fresh;
  }
}

let state = load();
const listeners = new Set<() => void>();

function set(next: Partial<DeskLayout>): void {
  state = { ...state, ...next };
  listeners.forEach((listener) => listener());
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage full or blocked: the setting just won't be remembered.
  }
}

export const deskLayout = {
  get: (): DeskLayout => state,
  /** Lays the desk out. Plan drops the contract down beside the map; the others put it away. */
  show(name: DeskName): void {
    set({ current: name });
    windows.arrange(name);
    deskStore.showContract(name === 'plan' && activeContract(session.getState(), content) !== undefined);
  },
  setAuto: (auto: boolean) => set({ auto }),
  /** The first connection opened. */
  connected(): void {
    if (!state.auto) return;
    if (state.current !== 'run') set({ back: state.current });
    deskLayout.show('run');
  },
  /** The last connection closed. */
  disconnected(): void {
    if (state.auto && state.current === 'run') deskLayout.show(state.back === 'run' ? 'plan' : state.back);
  },
};

export function useDeskLayout(): DeskLayout {
  const [value, setValue] = useState(state);
  useEffect(() => {
    const update = () => setValue(state);
    update();
    listeners.add(update);
    return () => void listeners.delete(update);
  }, []);
  return value;
}
