/**
 * The tutorial's memory: whether hints are on, which windows have already
 * shown their help card, whether the tour has been offered, and which help
 * card or tour step is showing now. Like the window layout, this belongs
 * to the browser, not to a save file.
 */
import { useEffect, useState } from 'preact/hooks';
import type { WindowId } from './windowStore';

export interface Hints {
  /** Hover labels, and a window's help card the first time it opens. */
  readonly on: boolean;
  /** Windows whose help card has been seen. */
  readonly seen: readonly WindowId[];
  /** The tour was taken (finished or ended). It no longer opens by itself. */
  readonly toured: boolean;
  /** The help card that is open, if any. Not kept. */
  readonly open: WindowId | null;
  /** The tour step showing, or null. Not kept. */
  readonly step: number | null;
}

const STORAGE_KEY = 'project-null.hints.v1';

function load(): Hints {
  const fresh: Hints = { on: true, seen: [], toured: false, open: null, step: null };
  try {
    const kept = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<Hints> | null;
    if (!kept) return fresh;
    return {
      ...fresh,
      on: kept.on !== false,
      seen: Array.isArray(kept.seen) ? kept.seen : [],
      toured: kept.toured === true,
    };
  } catch {
    return fresh;
  }
}

let hints = load();
const listeners = new Set<() => void>();

function set(next: Partial<Hints>): void {
  hints = { ...hints, ...next };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ on: hints.on, seen: hints.seen, toured: hints.toured }));
  } catch {
    // Private browsing can refuse storage. Hints then last for this visit only.
  }
  listeners.forEach((listener) => listener());
}

export const hintStore = {
  get: (): Hints => hints,
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  setOn: (on: boolean) => set({ on }),
  /** Opens a window's help card (closing any other), or closes it if it is the one open. */
  toggleHelp: (id: WindowId) =>
    set({ open: hints.open === id ? null : id, seen: hints.seen.includes(id) ? hints.seen : [...hints.seen, id] }),
  closeHelp: () => set({ open: null }),
  /**
   * The first time a window shows, with hints on and no tour running, its
   * help card opens by itself: once the tour was taken, or once `ready`
   * (the first job is done: until then Wren does the teaching).
   */
  firstShow(id: WindowId, ready = false): void {
    if (!hints.on || hints.seen.includes(id) || hints.step !== null || !(hints.toured || ready)) return;
    set({ open: id, seen: [...hints.seen, id] });
  },
  startTour: () => set({ step: 0, open: null }),
  goToStep: (step: number) => set({ step }),
  endTour: (covered: readonly WindowId[]) =>
    set({ step: null, toured: true, seen: [...new Set([...hints.seen, ...covered])] }),
};

export function useHints(): Hints {
  const [value, setValue] = useState(hints);
  useEffect(() => {
    setValue(hints);
    return hintStore.subscribe(() => setValue(hints));
  }, []);
  return value;
}
