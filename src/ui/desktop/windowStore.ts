/**
 * Which windows are open, where they are, and which is on top.
 * This is screen layout, not game state, so it is kept per browser (in
 * localStorage) and not in save files.
 */
import { useEffect, useState } from 'preact/hooks';

export const WINDOW_IDS = ['gateway', 'map', 'server', 'programs', 'messages', 'contract', 'web', 'dark', 'viewer', 'saves'] as const;
export type WindowId = (typeof WINDOW_IDS)[number];

export interface WindowDef {
  readonly title: string;
  /** Short name on its bottom-bar tab. */
  readonly pill: string;
  readonly width: number;
  /** Starting height, for windows whose contents scroll inside them. Others are as tall as their contents. */
  readonly height?: number;
  /** Narrowest it can be dragged to. Defaults to MIN_WIDTH. */
  readonly minWidth?: number;
  /** Starting position. A negative x is measured from the right edge of the screen. */
  readonly x: number;
  readonly y: number;
  readonly open: boolean;
}

export const WINDOW_DEFS: Readonly<Record<WindowId, WindowDef>> = {
  gateway: { title: 'Gateway', pill: 'Gateway', width: 360, x: 24, y: 20, open: true },
  // x: -24 means 24px in from the right edge of the screen.
  map: { title: 'Route map', pill: 'Map', width: 700, x: -24, y: 20, open: true },
  server: { title: 'Server', pill: 'Server', width: 760, x: 24, y: 292, open: true },
  programs: { title: 'Programs', pill: 'Programs', width: 440, x: 410, y: 60, open: false },
  messages: { title: 'Messages', pill: 'Messages', width: 520, x: -48, y: 56, open: false },
  contract: { title: 'Contract', pill: 'Contract', width: 440, x: 24, y: 20, open: false },
  web: { title: 'Lumen', pill: 'Web', width: 620, height: 500, x: 260, y: 40, open: false },
  dark: { title: 'Undertow', pill: 'Darknet', width: 620, height: 500, x: 320, y: 70, open: false },
  viewer: { title: 'File viewer', pill: 'Viewer', width: 640, x: 320, y: 90, open: false },
  saves: { title: 'Saved games', pill: 'Saves', width: 640, x: 200, y: 120, open: false },
};

export const MIN_WIDTH = 320;
export const MIN_HEIGHT = 140;
/** Height of the top bar plus the bottom bar: the desktop is the browser window minus these. */
const BARS_HEIGHT = 110;
/** How much of a window must stay on screen so it can always be grabbed again. */
export const KEEP_VISIBLE = 80;

export interface WindowLayout {
  readonly x: number;
  readonly y: number;
  readonly open: boolean;
  /** Higher = closer to the front. */
  readonly z: number;
  /** Open but tucked away on the bottom bar. */
  readonly minimized: boolean;
  /** Size the player dragged it to. Null = the window's usual width, or as tall as its contents. */
  readonly w: number | null;
  readonly h: number | null;
}

type Layouts = Readonly<Record<WindowId, WindowLayout>>;

const STORAGE_KEY = 'project-null.windows.v8';

function defaults(): Layouts {
  const entries = WINDOW_IDS.map((id, index) => {
    const def = WINDOW_DEFS[id];
    const x = def.x >= 0 ? def.x : Math.max(24, window.innerWidth + def.x - def.width);
    return [id, { x, y: def.y, open: def.open, z: index + 1, minimized: false, w: null, h: def.height ?? null }] as const;
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
        const size = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null);
        layouts[id] = {
          x: entry.x!,
          y: entry.y!,
          z: entry.z!,
          open: entry.open,
          minimized: entry.minimized === true,
          w: size(entry.w),
          h: size(entry.h),
        };
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
const isShown = (id: WindowId) => layouts[id].open && !layouts[id].minimized;
/** The highest window that is actually on screen. */
const topShownZ = () => Math.max(0, ...WINDOW_IDS.filter(isShown).map((id) => layouts[id].z));
export const widthOf = (id: WindowId) => layouts[id].w ?? WINDOW_DEFS[id].width;
const patch = (id: WindowId, change: Partial<WindowLayout>): Layouts => ({
  ...layouts,
  [id]: { ...layouts[id], ...change },
});

export const windows = {
  get: (): Layouts => layouts,
  isOnTop: (id: WindowId) => isShown(id) && layouts[id].z === topShownZ(),

  /** Opens it if it is closed or minimized, and brings it to the front. */
  focus(id: WindowId): void {
    if (!windows.isOnTop(id)) set(patch(id, { open: true, minimized: false, z: topZ() + 1 }), true);
  },
  close(id: WindowId): void {
    set(patch(id, { open: false, minimized: false }), true);
  },
  /** Tucks it away. Its tab on the bottom bar brings it back as it was. */
  minimize(id: WindowId): void {
    set(patch(id, { minimized: true }), true);
  },
  /** Bottom-bar tab: open it, bring it forward, or minimize it if it's already in front. */
  toggle(id: WindowId): void {
    if (windows.isOnTop(id)) windows.minimize(id);
    else windows.focus(id);
  },
  /** While dragging the corner. Call `settle` when the drag ends. */
  resize(id: WindowId, w: number, h: number): void {
    set(patch(id, { w, h }), false);
  },
  /** Back to its usual size. */
  resetSize(id: WindowId): void {
    set(patch(id, { w: null, h: WINDOW_DEFS[id].height ?? null }), true);
  },
  /** While dragging. Call `settle` when the drag ends. */
  move(id: WindowId, x: number, y: number): void {
    set(patch(id, { x, y }), false);
  },
  settle(): void {
    set(layouts, true);
  },
};

/**
 * When the browser window changes size, windows keep their distance from
 * whichever side edge they were nearer to, and are pulled back in if they
 * would end up off screen.
 */
let viewportWidth = window.innerWidth;
window.addEventListener('resize', () => {
  const before = viewportWidth;
  viewportWidth = window.innerWidth;
  const height = window.innerHeight - BARS_HEIGHT;
  const next = { ...layouts };
  for (const id of WINDOW_IDS) {
    const layout = layouts[id];
    const width = widthOf(id);
    const rightGap = before - (layout.x + width);
    const x = layout.x > rightGap ? viewportWidth - width - rightGap : layout.x;
    next[id] = {
      ...layout,
      x: Math.max(Math.min(x, viewportWidth - KEEP_VISIBLE), Math.min(0, KEEP_VISIBLE - width)),
      y: Math.max(0, Math.min(layout.y, height - KEEP_VISIBLE)),
    };
  }
  set(next, true);
});

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
