/**
 * Which windows are open, where they are, and which is on top.
 * This is screen layout, not game state, so it is kept per browser (in
 * localStorage) and not in save files.
 */
import { useEffect, useState } from 'preact/hooks';
import { fitOnDesk, refit } from './fit';
import { zoneRect, type Area, type Zone } from './snap';

export const WINDOW_IDS = ['gateway', 'map', 'server', 'programs', 'messages', 'contract', 'skills', 'workbench', 'web', 'dark', 'viewer', 'saves', 'defence'] as const;
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

/*
 * The default desk: the server being worked on fills the left, the route
 * map sits top right with the gateway's readout under it, and nothing
 * that is open from the start covers anything else. Windows opened later
 * step down and to the right from the left edge.
 */
const EDGE = 24;
const GAP = 16;
const TOP = 20;
const MAP_WIDTH = 700;
/** Room the gateway needs under the map for its tiles and its board. */
const GATEWAY_HEIGHT = 424;

export const WINDOW_DEFS: Readonly<Record<WindowId, WindowDef>> = {
  // x: -24 means 24px in from the right edge of the screen. The gateway's y is worked out from the map's height.
  gateway: { title: 'Gateway', pill: 'Gateway', width: MAP_WIDTH, x: -EDGE, y: TOP, open: true },
  map: { title: 'Route map', pill: 'Map', width: MAP_WIDTH, x: -EDGE, y: TOP, open: true },
  server: { title: 'Server', pill: 'Server', width: 760, minWidth: 520, x: EDGE, y: TOP, open: true },
  programs: { title: 'Programs', pill: 'Programs', width: 460, x: 184, y: 92, open: false },
  messages: { title: 'Messages', pill: 'Messages', width: 560, x: EDGE, y: TOP, open: false },
  contract: { title: 'Contract', pill: 'Contract', width: 440, x: 144, y: 56, open: false },
  skills: { title: 'Skills', pill: 'Skills', width: 900, height: 640, x: 64, y: 40, open: false },
  workbench: { title: 'Workbench', pill: 'Bench', width: 620, height: 600, x: 104, y: 56, open: false },
  web: { title: 'Lumen', pill: 'Web', width: 620, height: 500, x: 104, y: 56, open: false },
  dark: { title: 'Undertow', pill: 'Darknet', width: 620, height: 500, x: 144, y: 92, open: false },
  viewer: { title: 'File viewer', pill: 'Viewer', width: 640, x: 224, y: 128, open: false },
  saves: { title: 'Saved games', pill: 'Saves', width: 640, x: 264, y: 92, open: false },
  defence: { title: 'Defence', pill: 'Defence', width: 560, height: 640, x: 120, y: 28, open: false },
};

export const MIN_WIDTH = 320;
export const MIN_HEIGHT = 140;
/** Height of the top bar plus the bottom bar: the desktop is the browser window minus these. */
const BARS_HEIGHT = 110;

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
  /**
   * Set while it fills a snap zone (half, quarter or the whole desk): where
   * it was and how big, so double-clicking the title or dragging it away
   * puts it back. Null when it is just where it was left.
   */
  readonly restore: SavedPlace | null;
  /** The snap zone it fills, so it can fill it again when the desk changes size. */
  readonly zone: Zone | null;
}

export interface SavedPlace {
  readonly x: number;
  readonly y: number;
  readonly w: number | null;
  readonly h: number | null;
}

type Layouts = Readonly<Record<WindowId, WindowLayout>>;

// Bumped whenever the default layout changes, so everyone gets the new one once.
const STORAGE_KEY = 'project-null.windows.v10';
// (v10 layouts load as they are: `restore` is new and simply starts empty.)

/**
 * On a screen narrower than the usual desk (a tablet held wide, a small
 * laptop) the server and the map column are narrowed to share what there
 * is, so nothing starts on top of anything else.
 */
function fittedWidths(): Partial<Record<WindowId, number>> {
  const room = window.innerWidth - EDGE * 2 - GAP;
  if (room >= WINDOW_DEFS.server.width + MAP_WIDTH) return {};
  const serverMin = WINDOW_DEFS.server.minWidth ?? MIN_WIDTH;
  const column = Math.max(560, room - 540);
  const server = Math.max(serverMin, room - column);
  return { server, map: column, gateway: column };
}

function defaults(): Layouts {
  const desk = window.innerHeight - BARS_HEIGHT;
  const fitted = fittedWidths();
  // The map takes what the gateway's readout leaves of the right-hand column, within reason.
  const mapHeight = Math.round(Math.min(720, Math.max(430, desk - TOP - GAP - GATEWAY_HEIGHT - GAP)));
  const entries = WINDOW_IDS.map((id, index) => {
    const def = WINDOW_DEFS[id];
    const width = fitted[id] ?? def.width;
    const x = def.x >= 0 ? def.x : Math.max(EDGE, window.innerWidth + def.x - width);
    const y = id === 'gateway' ? TOP + mapHeight + GAP : def.y;
    const h = id === 'map' ? mapHeight : (def.height ?? null);
    return [id, { x, y, open: def.open, z: index + 1, minimized: false, w: fitted[id] ?? null, h, restore: null, zone: null }] as const;
  });
  return Object.fromEntries(entries) as Layouts;
}

/** The height a window goes back to when its corner is double-clicked. */
const usualWidth = (id: WindowId): number | null => defaults()[id].w;
const usualHeight = (id: WindowId): number | null => defaults()[id].h;

const ZONES: readonly Zone[] = ['left', 'right', 'top-left', 'top-right', 'bottom-left', 'bottom-right', 'full'];

function savedPlace(value: unknown): SavedPlace | null {
  if (typeof value !== 'object' || value === null) return null;
  const { x, y, w, h } = value as Partial<Record<keyof SavedPlace, unknown>>;
  if (typeof x !== 'number' || !Number.isFinite(x) || typeof y !== 'number' || !Number.isFinite(y)) return null;
  const size = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
  return { x, y, w: size(w), h: size(h) };
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
          restore: savedPlace(entry.restore),
          zone: ZONES.includes(entry.zone as Zone) && entry.restore ? (entry.zone as Zone) : null,
        };
      }
    }
  } catch {
    // Unreadable or blocked storage: use the default layout.
  }
  return layouts;
}

let layouts: Layouts = load();
/** The desk's size. A guess until the desk is drawn and reports it with `setArea`. */
let area: Area = { w: window.innerWidth, h: window.innerHeight - BARS_HEIGHT };
/** Whether `area` is the desk's real size yet. */
let measured = false;

/** `layout` moved and shrunk so it is wholly on the desk. */
function fit(id: WindowId, layout: WindowLayout): WindowLayout {
  // Only once the desk has been measured: a phone or tablet never draws the desk, and its screen must not shrink desk windows.
  if (!measured) return layout;
  const width = layout.w ?? WINDOW_DEFS[id].width;
  const box = fitOnDesk({ x: layout.x, y: layout.y, w: width, h: layout.h }, area, MIN_HEIGHT);
  return { ...layout, x: box.x, y: box.y, w: box.w < width ? box.w : layout.w, h: box.h };
}
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
/** Changes one window, keeping it on the desk. */
const patch = (id: WindowId, change: Partial<WindowLayout>): Layouts => ({
  ...layouts,
  [id]: fit(id, { ...layouts[id], ...change }),
});

export const windows = {
  get: (): Layouts => layouts,
  /** The desk's size, as last reported. */
  area: (): Area => area,
  /**
   * The desk changed size (or was measured for the first time): every
   * window is kept on it. One that fills a zone fills the same zone of the
   * new desk; the others keep their distance from their nearer side and
   * shrink if they no longer fit.
   */
  setArea(next: Area): void {
    if (next.w <= 0 || next.h <= 0) return;
    const before = measured ? area : next;
    if (measured && before.w === next.w && before.h === next.h) return;
    area = { w: next.w, h: next.h };
    measured = true;
    const fitted = { ...layouts };
    for (const id of WINDOW_IDS) {
      const layout = layouts[id];
      if (layout.zone) {
        const rect = zoneRect(layout.zone, area);
        fitted[id] = { ...layout, ...rect };
        continue;
      }
      const width = layout.w ?? WINDOW_DEFS[id].width;
      const box = refit({ x: layout.x, y: layout.y, w: width, h: layout.h }, before, area, MIN_HEIGHT);
      fitted[id] = { ...layout, x: box.x, y: box.y, w: box.w < width ? box.w : layout.w, h: box.h };
    }
    set(fitted, true);
  },
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
    set(patch(id, { w, h, restore: null, zone: null }), false);
  },
  /** Back to its usual size. */
  resetSize(id: WindowId): void {
    set(patch(id, { w: usualWidth(id), h: usualHeight(id), restore: null, zone: null }), true);
  },
  /** Fills a snap zone, remembering where it was so it can go back. */
  place(id: WindowId, zone: Zone): void {
    const layout = layouts[id];
    const restore = layout.restore ?? { x: layout.x, y: layout.y, w: layout.w, h: layout.h };
    set(patch(id, { ...zoneRect(zone, area), restore, zone }), true);
  },
  /**
   * Leaves the zone it fills: back to the size it had before. Moves it back
   * too unless it is being dragged, in which case the drag decides where.
   */
  unplace(id: WindowId, keepPosition = false): void {
    const restore = layouts[id].restore;
    if (!restore) return;
    const where = keepPosition ? {} : { x: restore.x, y: restore.y };
    set(patch(id, { ...where, w: restore.w, h: restore.h, restore: null, zone: null }), !keepPosition);
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
