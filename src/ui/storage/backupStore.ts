/**
 * Keeping saves safe: when each slot was last downloaded as a backup, and
 * whether the browser has promised to keep the game's storage when space
 * runs low. Belongs to the browser, not to a save.
 */
import { useEffect, useState } from 'preact/hooks';

const STORAGE_KEY = 'project-null.backups.v1';

export interface Backup {
  /** When it was downloaded (ms since 1970). */
  readonly at: number;
  readonly handle: string;
}

export interface Safety {
  /** The last backup of each slot, by slot number. */
  readonly slots: Readonly<Record<string, Backup>>;
  /** True once the browser promised to keep storage; null until asked. */
  readonly kept: boolean | null;
}

function load(): Safety {
  try {
    const kept = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<Safety> | null;
    const slots: Record<string, Backup> = {};
    for (const [slot, backup] of Object.entries(kept?.slots ?? {})) {
      if (backup && typeof backup.at === 'number' && typeof backup.handle === 'string') slots[slot] = { at: backup.at, handle: backup.handle };
    }
    return { slots, kept: null };
  } catch {
    return { slots: {}, kept: null };
  }
}

let state = load();
const listeners = new Set<() => void>();

function set(next: Partial<Safety>): void {
  state = { ...state, ...next };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ slots: state.slots }));
  } catch {
    // Storage refused: kept for this visit only.
  }
  listeners.forEach((listener) => listener());
}

export const backups = {
  get: (): Safety => state,
  /** A slot was just downloaded. */
  noted(slot: number, handle: string): void {
    set({ slots: { ...state.slots, [slot]: { at: Date.now(), handle } } });
  },
  /** Finds out, without asking, whether the browser already keeps the game's storage. */
  async check(): Promise<void> {
    const storage = typeof navigator !== 'undefined' ? navigator.storage : undefined;
    if (!storage?.persisted) return;
    try {
      if (await storage.persisted()) set({ kept: true });
    } catch {
      // Not known: stays unasked.
    }
  },
  /** Asks the browser to keep the game's storage even when space runs low. Most browsers say yes for a site used often or installed. */
  async askToKeep(): Promise<void> {
    const storage = typeof navigator !== 'undefined' ? navigator.storage : undefined;
    if (!storage?.persisted) return;
    try {
      const kept = (await storage.persisted()) || (storage.persist ? await storage.persist() : false);
      set({ kept });
    } catch {
      set({ kept: false });
    }
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export function useBackups(): Safety {
  const [now, setNow] = useState(state);
  useEffect(() => backups.subscribe(() => setNow(state)), []);
  return now;
}
