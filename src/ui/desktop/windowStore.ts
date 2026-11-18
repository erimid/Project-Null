/**
 * Which windows are open, where they are, and which is on top.
 * This is screen layout, not game state, so it is kept per browser (in
 * localStorage) and not in save files.
 */
import { useEffect, useState } from 'preact/hooks';

export const WINDOW_IDS = ['gateway', 'map', 'server', 'programs', 'messages', 'contract', 'saves'] as const;
export type WindowId = (typeof WINDOW_IDS)[number];

export interface WindowDef {
  readonly title: string;
  /** Short name on the bottom-bar pill. */
  readonly pill: string;
  readonly width: number;
  /** Starting position. A negative x is measured from the right edge of the screen. */
  readonly x: number;
  readonly y: number;
  readonly open: boolean;
}

export const WINDOW_DEFS: Readonly<Record<WindowId, WindowDef>> = {
  gateway: { title: 'Gateway', pill: 'Gateway', width: 360, x: 24, y: 20, open: true },
  // x: -24 means 24px in from the right edge of the screen.
  map: { title: 'Route map', pill: 'Route map', width: 700, x: -24, y: 20, open: true },
  server: { title: 'Server', pill: 'Server', width: 668, x: 24, y: 292, open: true },
  programs: { title: 'Programs', pill: 'Programs', width: 440, x: 410, y: 60, open: false },
  messages: { title: 'Messages', pill: 'Messages', width: 520, x: -48, y: 56, open: false },
  contract: { title: 'Contract', pill: 'Contract', width: 440, x: 24, y: 20, open: false },
  saves: { title: 'Saved games', pill: 'Saves', width: 640, x: 200, y: 120, open: false },
};

export interface WindowLayout {
  readonly x: number;
  readonly y: number;
  readonly open: boolean;
  /** Higher = closer to the front. */
  readonly z: number;
}

type Layouts = Readonly<Record<WindowId, WindowLayout>>;

const STORAGE_KEY = 'project-null.windows.v5';

function defaults(): Layouts {
  const entries = WINDOW_IDS.map((id, index) => {
    const def = WINDOW_DEFS[id];
    const x = def.x >= 0 ? def.x : Math.max(24, window.innerWidth + def.x - def.width);
    return [id, { x, y: def.y, open: def.open, z: index + 1 }] as const;
  });
  return Object.fromEntries(entries) as Layouts;
}

function load(): Layouts {
  const layouts: Record<WindowId, WindowLayout> = { ...defaults() };
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (typeof saved !== 'object' || saved === null) return layouts;
    for (const id of WINDOW_IDS) {
      const entry = (saved as Record<string, Partial<WindowLayout> | undefined>)[id];
      if (
        entry &&
        Number.isFinite(entry.x) &&
        Number.isFinite(entry.y) &&
        Number.isFinite(entry.z) &&
        typeof entry.open === 'boolean'
      ) {
        layouts[id] = { x: entry.x!, y: entry.y!, z: entry.z!, open: entry.open };
      }
    }
  } catch {
    // Unreadable or blocked storage: use the default layout.
  }
  return layouts;
}

let layouts: Layouts = load();
const listeners = new Set<() => void>();

function set(next: Layouts, persist: boolean): void {
  layouts = next;
  listeners.forEach((listener) => listener());
  if (!persist) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layouts));
  } catch {
    // Storage full or blocked: the layout just won't be remembered.
  }
}

const topZ = () => Math.max(...WINDOW_IDS.map((id) => layouts[id].z));
const patch = (id: WindowId, change: Partial<WindowLayout>): Layouts => ({
  ...layouts,
  [id]: { ...layouts[id], ...change },
});

export const windows = {
  get: (): Layouts => layouts,
  isOnTop: (id: WindowId) => layouts[id].open && layouts[id].z === topZ(),

  focus(id: WindowId): void {
    if (!windows.isOnTop(id)) set(patch(id, { open: true, z: topZ() + 1 }), true);
  },
  close(id: WindowId): void {
    set(patch(id, { open: false }), true);
  },
  /** Bottom-bar pill: open it, bring it forward, or close it if it's already in front. */
  toggle(id: WindowId): void {
    if (windows.isOnTop(id)) windows.close(id);
    else windows.focus(id);
  },
  /** While dragging. Call `settle` when the drag ends. */
  move(id: WindowId, x: number, y: number): void {
    set(patch(id, { x, y }), false);
  },
  settle(): void {
    set(layouts, true);
  },
};

export function useWindows(): Layouts {
  const [value, setValue] = useState(layouts);
  useEffect(() => {
    const update = () => setValue(layouts);
    update();
    listeners.add(update);
    return () => void listeners.delete(update);
  }, []);
  return value;
}
