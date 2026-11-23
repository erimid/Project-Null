/**
 * How the desk looks: which desk design is in use and which colour theme.
 * Like the window layout, this belongs to the browser, not to a save file.
 *
 * The first design, "classic", is the desk of free-floating windows the game
 * has always had. The others dock the windows into panes with tabs.
 */
import { useEffect, useState } from 'preact/hooks';
import { DEFAULT_THEME, THEMES, themeById, themeVars } from './themes';
import type { WindowId } from './windowStore';

export type DesignId = 'classic' | 'deck' | 'cards' | 'sidebar' | 'hybrid';

export interface Design {
  readonly id: DesignId;
  /** One letter for the swap button. */
  readonly key: string;
  readonly name: string;
  readonly note: string;
}

export const DESIGNS: readonly Design[] = [
  { id: 'classic', key: '0', name: 'Classic', note: 'Free windows, as the game has always been' },
  { id: 'deck', key: 'A', name: 'Deck', note: 'Flat docked panes, side rail, bars top and bottom' },
  { id: 'cards', key: 'B', name: 'Top bar and cards', note: 'One bar on top, rounded cards, one tall side pane' },
  { id: 'sidebar', key: 'C', name: 'Labelled sidebar', note: 'Window names and your numbers down the left' },
  { id: 'hybrid', key: 'D', name: 'Docked with pull-outs', note: 'Docked panes, and any window can be pulled out to float' },
];

export interface Look {
  readonly design: DesignId;
  readonly theme: string;
  /** Design D: the windows pulled out of their pane. */
  readonly floating: readonly WindowId[];
  /** The test bar across the top of the screen, for swapping designs and themes quickly. */
  readonly bar: boolean;
}

const STORAGE_KEY = 'project-null.look.v1';

function load(): Look {
  const fresh: Look = { design: 'classic', theme: DEFAULT_THEME, floating: [], bar: true };
  try {
    const kept = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<Look> | null;
    if (!kept) return fresh;
    return {
      design: DESIGNS.some((design) => design.id === kept.design) ? kept.design! : 'classic',
      theme: themeById(String(kept.theme)).id,
      floating: Array.isArray(kept.floating) ? kept.floating : [],
      bar: kept.bar !== false,
    };
  } catch {
    return fresh;
  }
}

let state = load();
const listeners = new Set<() => void>();
let applied: string[] = [];

/** Write the theme's colours on the page root, and clear the last theme's. */
function paint(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const vars = themeVars(themeById(state.theme));
  for (const name of applied) if (!(name in vars)) root.style.removeProperty(name);
  for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value);
  applied = Object.keys(vars);
  root.dataset.theme = state.theme;
  root.classList.toggle('is-light', themeById(state.theme).light === true);
  root.classList.toggle('has-lookbar', state.bar);
}

function set(next: Partial<Look>): void {
  state = { ...state, ...next };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Private browsing can refuse storage. The look then lasts for this visit only.
  }
  paint();
  for (const listener of listeners) listener();
}

function step<T>(list: readonly T[], at: number, by: number): T {
  return list[(at + by + list.length) % list.length]!;
}

export const look = {
  get: (): Look => state,
  /** Paint the kept theme. Called once, before the first frame. */
  start: paint,
  setDesign: (design: DesignId) => set({ design }),
  setTheme: (theme: string) => set({ theme: themeById(theme).id }),
  nextDesign: (by = 1) => set({ design: step(DESIGNS, DESIGNS.findIndex((design) => design.id === state.design), by).id }),
  nextTheme: (by = 1) => set({ theme: step(THEMES, THEMES.findIndex((theme) => theme.id === state.theme), by).id }),
  setBar: (bar: boolean) => set({ bar }),
  /** Design D: pull a window out of its pane, or put it back. */
  float: (id: WindowId) => set({ floating: state.floating.includes(id) ? state.floating : [...state.floating, id] }),
  dock: (id: WindowId) => set({ floating: state.floating.filter((other) => other !== id) }),
};

export function useLook(): Look {
  const [, redraw] = useState(0);
  useEffect(() => {
    const listener = () => redraw((count) => count + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return state;
}
