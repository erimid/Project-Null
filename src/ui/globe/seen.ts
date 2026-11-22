/**
 * Which jobs and stories the player has already noticed on the globe, so
 * only new ones pulse. Kept in the browser, not the save: it is screen
 * state, like the address book's order. The first time it is used it
 * takes in everything already there, so an old save does not light up.
 */
import { useEffect, useState } from 'preact/hooks';

const KEY = 'project-null.globe-seen.v1';
/** Ids kept at most. Old ones drop off the front; a job that old is long gone. */
const KEEP = 400;

let seen: string[] | null = null;
const listeners = new Set<() => void>();

function load(): string[] | null {
  if (seen) return seen;
  try {
    const raw = localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed)) seen = parsed.filter((id): id is string => typeof id === 'string');
  } catch {
    // A broken store starts again.
  }
  return seen;
}

function save(list: string[]): void {
  seen = list.slice(-KEEP);
  try {
    localStorage.setItem(KEY, JSON.stringify(seen));
  } catch {
    // It still holds for this visit.
  }
  listeners.forEach((listener) => listener());
}

export const globeSeen = {
  /** True once an id has been noticed. Before the store is started, everything counts as seen. */
  has(id: string): boolean {
    const list = load();
    return list === null || list.includes(id);
  },
  /** Notes ids as seen. */
  mark(ids: readonly string[]): void {
    const list = load() ?? [];
    const fresh = ids.filter((id) => !list.includes(id));
    if (fresh.length > 0) save([...list, ...fresh]);
  },
  /** Starts the store the first time, with everything on the globe right now already seen. */
  start(ids: readonly string[]): void {
    if (load() === null) save([...ids]);
  },
};

/** Redraws when the seen list changes. */
export function useGlobeSeen(): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const update = () => setCount((n) => n + 1);
    listeners.add(update);
    return () => void listeners.delete(update);
  }, []);
  return count;
}
