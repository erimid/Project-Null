/**
 * Comfort settings: text size, less flashing, and where alerts appear.
 * Like the look of the desk, they belong to the browser, not to a save.
 * Each is a class on the page root, read by the style sheets.
 */
import { useEffect, useState } from 'preact/hooks';

export type TextSize = 'normal' | 'large' | 'larger';

export const TEXT_SIZES: readonly (readonly [TextSize, string, number])[] = [
  ['normal', 'Normal', 1],
  ['large', 'Large', 1.12],
  ['larger', 'Larger', 1.25],
];

export interface Comfort {
  readonly text: TextSize;
  /** No flashing, pulsing or shaking: warnings stay lit instead. */
  readonly calm: boolean;
  /** Alerts drop into the bottom right corner instead of the top middle. */
  readonly corner: boolean;
}

const STORAGE_KEY = 'project-null.comfort.v1';

function load(): Comfort {
  const fresh: Comfort = { text: 'normal', calm: false, corner: false };
  try {
    const kept = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<Comfort> | null;
    if (!kept) return fresh;
    return {
      text: TEXT_SIZES.some(([id]) => id === kept.text) ? kept.text! : 'normal',
      calm: kept.calm === true,
      corner: kept.corner === true,
    };
  } catch {
    return fresh;
  }
}

let state = load();
const listeners = new Set<() => void>();

function apply(): void {
  const root = document.documentElement;
  const scale = TEXT_SIZES.find(([id]) => id === state.text)?.[2] ?? 1;
  root.style.setProperty('--text-scale', String(scale));
  root.classList.toggle('is-calm', state.calm);
  root.classList.toggle('alerts-corner', state.corner);
}

function set(next: Partial<Comfort>): void {
  state = { ...state, ...next };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage refused: kept for this visit only.
  }
  apply();
  listeners.forEach((listener) => listener());
}

export const comfort = {
  /** Puts the settings on the page before anything is drawn. */
  start: apply,
  get: (): Comfort => state,
  setText: (text: TextSize) => set({ text }),
  setCalm: (calm: boolean) => set({ calm }),
  setCorner: (corner: boolean) => set({ corner }),
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export function useComfort(): Comfort {
  const [now, setNow] = useState(state);
  useEffect(() => comfort.subscribe(() => setNow(state)), []);
  return now;
}
