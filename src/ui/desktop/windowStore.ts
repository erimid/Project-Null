/**
 * Which windows are open, where they are, and which is on top.
 * This is screen layout, not game state, so it is kept per browser (in
 * localStorage) and not in save files.
 */
import { useEffect, useState } from 'preact/hooks';
import { DESKS, deskColumns, deskRects, type DeskName } from './desks';
import { fitOnDesk, refit } from './fit';
import { zoneRect, type Area, type Rect, type Zone } from './snap';

export const WINDOW_IDS = ['gateway', 'map', 'server', 'programs', 'messages', 'skills', 'web', 'viewer', 'saves', 'defence'] as const;
export type WindowId = (typeof WINDOW_IDS)[number];

/** Windows that only have a tab on the bar while they are open: Saved games opens from the game menu, the file viewer from a file. */
export const ON_DEMAND: readonly WindowId[] = ['viewer', 'saves', 'defence'];

export interface WindowDef {
  readonly title: string;
  /** Short name on its bottom-bar tab. */
  readonly pill: string;
  /** Its width when it is not part of a desk layout. */
  readonly width: number;
  /** Its height then, for windows whose contents scroll inside them. Others are as tall as their contents. */
  readonly height?: number;
  /** Narrowest it can be dragged to. Defaults to MIN_WIDTH. */
  readonly minWidth?: number;
  /** Where it opens when it is not part of a desk layout. */
  readonly x: number;
  readonly y: number;
}

/*
 * The desk starts in the Plan layout (see desks.ts), which places the
 * route map and messages. These are the sizes and places of windows
 * opened outside a layout: they step down and to the right from the left edge.
 */
export const WINDOW_DEFS: Readonly<Record<WindowId, WindowDef>> = {
  gateway: { title: 'Gateway', pill: 'Gateway', width: 720, x: 144, y: 56 },
  map: { title: 'Route map', pill: 'Map', width: 760, height: 620, x: 104, y: 40 },
  server: { title: 'Server', pill: 'Server', width: 760, minWidth: 520, x: 24, y: 20 },
  programs: { title: 'Programs', pill: 'Programs', width: 600, height: 620, x: 184, y: 72 },
  messages: { title: 'Messages', pill: 'Messages', width: 780, height: 560, x: 24, y: 20 },
  skills: { title: 'Skills', pill: 'Skills', width: 900, height: 640, x: 64, y: 40 },
  web: { title: 'Browser', pill: 'Web', width: 620, height: 520, x: 104, y: 56 },
  viewer: { title: 'File viewer', pill: 'Viewer', width: 640, x: 224, y: 128 },
  saves: { title: 'Saved games', pill: 'Saves', width: 640, x: 264, y: 92 },
  defence: { title: 'Defence', pill: 'Defence', width: 560, height: 640, x: 120, y: 28 },
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
  /**
   * The desk layout that put it where it is, so it keeps its place in that
   * layout when the desk changes size. Null once the player moves or sizes it.
   */
  readonly desk: DeskName | null;
}

export interface SavedPlace {
  readonly x: number;
  readonly y: number;
  readonly w: number | null;
  readonly h: number | null;
}

type Layouts = Readonly<Record<WindowId, WindowLayout>>;

// Bumped whenever the default layout changes, so everyone gets the new one once.
const STORAGE_KEY = 'project-null.windows.v12';

/** The desk's size before it has been drawn: the browser window less the two bars. */
const guessArea = (): Area => ({ w: window.innerWidth, h: window.innerHeight - BARS_HEIGHT });

function defaults(): Layouts {
  const planned = new Map<WindowId, Rect>(deskRects('plan', guessArea()));
  const entries = WINDOW_IDS.map((id, index) => {
    const def = WINDOW_DEFS[id];
    const rect = planned.get(id);
    const layout: WindowLayout = rect
      ? { ...rect, open: true, z: index + 1, minimized: false, restore: null, zone: null, desk: 'plan' }
      : { x: def.x, y: def.y, open: false, z: index + 1, minimized: false, w: null, h: def.height ?? null, restore: null, zone: null, desk: null };
    return [id, layout] as const;
  });
  return Object.fromEntries(entries) as Layouts;
}

const ZONES: readonly Zone[] = ['left', 'right', 'top-left', 'top-right', 'bottom-left', 'bottom-right', 'full', 'third-left', 'third-centre', 'third-right'];

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
          desk: DESKS.includes(entry.desk as DeskName) ? (entry.desk as DeskName) : null,
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
let area: Area = guessArea();
/** Whether `area` is the desk's real size yet. */
let measured = false;
/** How far the contract hangs down from the top bar, while it is dropped down. */
let contractDrop = 0;
/** Where a desk layout puts its windows on the desk as it is now. */
const placedBy = (name: DeskName) => new Map<WindowId, Rect>(deskRects(name, area, contractDrop));

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
    // A desk that grows wide enough gets another column of windows, and one that narrows loses it.
    const regrouped = measured && deskColumns(before) !== deskColumns(next);
    area = { w: next.w, h: next.h };
    measured = true;
    const fitted = { ...layouts };
    // The layout still in force, if the player has left any of its windows where it put them.
    const inForce = WINDOW_IDS.map((id) => layouts[id]).find((layout) => layout.desk && layout.open && !layout.minimized && !layout.zone)?.desk;
    const joining = regrouped && inForce ? placedBy(inForce) : undefined;
    let z = topZ();
    for (const id of WINDOW_IDS) {
      let layout = layouts[id];
      const joins = joining?.get(id);
      if (joins && layout.desk !== inForce && !ON_DEMAND.includes(id)) {
        // The layout has a place for it now: bring it out, behind the windows already there.
        fitted[id] = { ...layout, ...joins, open: true, minimized: false, restore: null, zone: null, desk: inForce!, z: ++z };
        continue;
      }
      if (layout.desk && !layout.zone && !placedBy(layout.desk).has(id)) {
        // Its layout no longer has a column for it on a desk this size: it goes back on the bar.
        layout = { ...layout, minimized: layout.open, desk: null };
      }
      const rect = layout.zone ? zoneRect(layout.zone, area) : layout.desk ? placedBy(layout.desk).get(id) : undefined;
      if (rect) {
        fitted[id] = { ...layout, ...rect };
        continue;
      }
      const width = layout.w ?? WINDOW_DEFS[id].width;
      const box = refit({ x: layout.x, y: layout.y, w: width, h: layout.h }, before, area, MIN_HEIGHT);
      fitted[id] = { ...layout, x: box.x, y: box.y, w: box.w < width ? box.w : layout.w, h: box.h };
    }
    set(fitted, true);
  },
  /**
   * The contract dropped down, changed height or was put away: windows
   * that a layout placed around it (the messages in Plan) make room.
   */
  setContractDrop(height: number): void {
    const next = Math.max(0, Math.round(height));
    if (next === contractDrop) return;
    contractDrop = next;
    if (!measured) return;
    const moved = { ...layouts };
    let changed = false;
    for (const id of WINDOW_IDS) {
      const layout = layouts[id];
      const rect = layout.desk && !layout.zone ? placedBy(layout.desk).get(id) : undefined;
      if (!rect || (rect.x === layout.x && rect.y === layout.y && rect.w === layout.w && rect.h === layout.h)) continue;
      moved[id] = { ...layout, ...rect };
      changed = true;
    }
    if (changed) set(moved, false);
  },
  isOnTop: (id: WindowId) => isShown(id) && layouts[id].z === topShownZ(),

  /** Opens it if it is closed or minimized, and brings it to the front. */
  focus(id: WindowId): void {
    if (windows.isOnTop(id)) return;
    // Heights only ever grow, so now and then they are counted afresh from 1 (the bars and alerts sit at fixed heights above).
    if (topZ() > 1000) {
      const order = [...WINDOW_IDS].sort((a, b) => layouts[a].z - layouts[b].z);
      layouts = Object.fromEntries(WINDOW_IDS.map((other) => [other, { ...layouts[other], z: order.indexOf(other) + 1 }])) as Layouts;
    }
    set(patch(id, { open: true, minimized: false, z: topZ() + 1 }), true);
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
  /**
   * Lays the desk out: the layout's windows are opened and put in their
   * places, and the other everyday windows are put away on the bar. The
   * file viewer, saved games and Defence stay as they are, on top.
   */
  arrange(name: DeskName): void {
    const next = { ...layouts };
    const placed = placedBy(name);
    let z = topZ();
    for (const id of WINDOW_IDS) {
      if (ON_DEMAND.includes(id) || placed.has(id)) continue;
      if (layouts[id].open) next[id] = { ...layouts[id], minimized: true };
    }
    for (const [id, rect] of placed) next[id] = { ...layouts[id], ...rect, open: true, minimized: false, z: ++z, restore: null, zone: null, desk: name };
    for (const id of ON_DEMAND) if (isShown(id)) next[id] = { ...layouts[id], z: ++z };
    set(next, true);
  },
  /** While dragging the corner. Call `settle` when the drag ends. */
  resize(id: WindowId, w: number, h: number): void {
    set(patch(id, { w, h, restore: null, zone: null, desk: null }), false);
  },
  /** Back to its usual size. */
  resetSize(id: WindowId): void {
    set(patch(id, { w: null, h: WINDOW_DEFS[id].height ?? null, restore: null, zone: null, desk: null }), true);
  },
  /** Fills a snap zone, remembering where it was so it can go back. */
  place(id: WindowId, zone: Zone): void {
    const layout = layouts[id];
    const restore = layout.restore ?? { x: layout.x, y: layout.y, w: layout.w, h: layout.h };
    set(patch(id, { ...zoneRect(zone, area), restore, zone, desk: null }), true);
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
  /** A docked design lets go of it: it floats at this place and size, in front. */
  floatAt(id: WindowId, rect: Rect): void {
    set(patch(id, { ...rect, open: true, minimized: false, z: topZ() + 1, restore: null, zone: null, desk: null }), true);
  },
  /** While dragging. Call `settle` when the drag ends. */
  move(id: WindowId, x: number, y: number): void {
    set(patch(id, { x, y, desk: null }), false);
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
