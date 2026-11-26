/**
 * What the browser keeps about the career record, outside any save:
 * every feat earned in any career here (feats are kept across careers),
 * every ending reached here (the title screen marks them),
 * whether job reports are shown, and which report was last seen.
 */
import { useEffect, useState } from 'preact/hooks';
import { session } from '../session';

const STORAGE_KEY = 'project-null.record.v1';

interface Kept {
  /** Feat ids earned in any career played in this browser. */
  readonly feats: readonly string[];
  /** Ending ids reached in any career played in this browser. */
  readonly endings: readonly string[];
  /** Show a report card after each job. */
  readonly reports: boolean;
  /** The last report the player put away (contract id @ game time), so a report shows once. */
  readonly seenReport: string;
}

function load(): Kept {
  const fresh: Kept = { feats: [], endings: [], reports: true, seenReport: '' };
  try {
    const kept = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<Kept> | null;
    if (!kept) return fresh;
    return {
      feats: Array.isArray(kept.feats) ? kept.feats.filter((id) => typeof id === 'string') : [],
      endings: Array.isArray(kept.endings) ? kept.endings.filter((id) => typeof id === 'string') : [],
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

/** Copies this career's feats and its ending into the browser's lists whenever the game changes. */
function sync(): void {
  const earned = session.getState().record.feats;
  if (earned.some((id) => !state.feats.includes(id))) set({ feats: [...new Set([...state.feats, ...earned])] });
  const ending = session.getState().ending?.id;
  if (ending && !state.endings.includes(ending)) set({ endings: [...state.endings, ending] });
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
