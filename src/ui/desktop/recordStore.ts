/**
 * What the browser keeps about the career record, outside any save:
 * every feat earned in any career here (feats are kept across careers),
 * whether job reports are shown, and which report was last seen.
 */
import { useEffect, useState } from 'preact/hooks';
import { session } from '../session';

const STORAGE_KEY = 'project-null.record.v1';

interface Kept {
  /** Feat ids earned in any career played in this browser. */
  readonly feats: readonly string[];
  /** Show a report card after each job. */
  readonly reports: boolean;
  /** The last report the player put away (contract id @ game time), so a report shows once. */
  readonly seenReport: string;
}

function load(): Kept {
  const fresh: Kept = { feats: [], reports: true, seenReport: '' };
  try {
    const kept = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<Kept> | null;
    if (!kept) return fresh;
    return {
      feats: Array.isArray(kept.feats) ? kept.feats.filter((id) => typeof id === 'string') : [],
      reports: kept.reports !== false,
      seenReport: typeof kept.seenReport === 'string' ? kept.seenReport : '',
    };
  } catch {
    return fresh;
  }
}

let state = load();
const listeners = new Set<() => void>();

function set(next: Partial<Kept>): void {
  state = { ...state, ...next };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage refused: kept for this visit only.
  }
  listeners.forEach((listener) => listener());
}

/** Copies this career's feats into the browser's list whenever the game changes. */
function sync(): void {
  const earned = session.getState().record.feats;
  if (earned.some((id) => !state.feats.includes(id))) set({ feats: [...new Set([...state.feats, ...earned])] });
}

export const recordStore = {
  start(): void {
    sync();
    session.subscribeChanges(sync);
  },
  get: (): Kept => state,
  showReports: (on: boolean) => set({ reports: on }),
  seen: (key: string) => set({ seenReport: key }),
};

export function useRecordStore(): Kept {
  const [value, setValue] = useState(state);
  useEffect(() => {
    const update = () => setValue(state);
    listeners.add(update);
    update();
    return () => void listeners.delete(update);
  }, []);
  return value;
}
