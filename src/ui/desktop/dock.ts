/**
 * The docked desk designs, as plain sums so they can be tested without a
 * screen. A docked design cuts the desk into panes; every window has one
 * pane as its home and shows there as a tab. Nothing overlaps and nothing
 * is dragged about.
 *
 *   deck     A  side column, main pane over a low one, two panes at the right. Flat, hairlines between.
 *   cards    B  side column, one big main pane, one tall pane at the right. Rounded cards.
 *   sidebar  C  (the names are down the sidebar) main pane over a low one, one tall pane for the whole map at the right.
 *   hybrid   D  as A but in cards, and a window can be pulled out to float.
 */
import type { DesignId } from './lookStore';
import type { Area, Rect } from './snap';
import type { WindowId } from './windowStore';

export type DockDesign = Exclude<DesignId, 'classic'>;
export type PaneId = 'main' | 'low' | 'top' | 'bottom' | 'tall';

/** Which windows live in which pane, in tab order. */
export const PANES: Readonly<Record<DockDesign, Partial<Record<PaneId, readonly WindowId[]>>>> = {
  deck: { main: ['server', 'gateway', 'web', 'skills', 'viewer', 'saves', 'defence'], low: ['messages'], top: ['map'], bottom: ['programs'] },
  hybrid: { main: ['server', 'gateway', 'web', 'skills', 'viewer', 'saves', 'defence'], low: ['messages'], top: ['map'], bottom: ['programs'] },
  cards: { main: ['server', 'gateway', 'web', 'skills', 'viewer', 'saves', 'defence'], tall: ['map', 'programs', 'messages'] },
  sidebar: { main: ['server', 'gateway', 'web', 'skills', 'viewer', 'saves', 'defence'], low: ['programs', 'messages'], tall: ['map'] },
};

/** A side column for the contract and the address book. The sidebar design keeps both elsewhere. */
export const HAS_SIDE: Readonly<Record<DockDesign, boolean>> = { deck: true, cards: true, hybrid: true, sidebar: false };

/** Room around the panes and between them. The deck's panes touch, with a hairline between. */
export const DOCK_GAP: Readonly<Record<DockDesign, { pad: number; gap: number }>> = {
  deck: { pad: 0, gap: 1 },
  cards: { pad: 10, gap: 10 },
  sidebar: { pad: 8, gap: 8 },
  hybrid: { pad: 10, gap: 10 },
};

export function paneOf(design: DockDesign, id: WindowId): PaneId {
  const found = (Object.entries(PANES[design]) as [PaneId, readonly WindowId[]][]).find(([, ids]) => ids.includes(id));
  return found ? found[0] : 'main';
}

const clamp = (value: number, low: number, high: number) => Math.round(Math.min(Math.max(value, low), Math.max(low, high)));

export interface DockRects {
  readonly side: Rect | null;
  readonly panes: Partial<Record<PaneId, Rect>>;
}

/** Where the side column and every pane go on a desk of this size. They never overlap and never leave the desk. */
export function dockRects(design: DockDesign, area: Area): DockRects {
  const { pad, gap } = DOCK_GAP[design];
  const top = pad;
  const height = Math.max(0, area.h - pad * 2);
  let left = pad;
  let width = Math.max(0, area.w - pad * 2);
  let side: Rect | null = null;
  if (HAS_SIDE[design]) {
    const w = clamp(area.w * 0.22, 300, 400);
    side = { x: left, y: top, w, h: height };
    left += w + gap;
    width -= w + gap;
  }
  // The right column: wide enough for the globe, never more than the main pane gets.
  // The sidebar design keeps the address book in the map, so its map pane is wide enough for globe and book side by side.
  const wholeMap = design === 'sidebar';
  const most = wholeMap ? Math.max(Math.floor((width - gap) / 2), width - gap - 540) : Math.floor((width - gap) / 2);
  const right = Math.min(clamp(width * (wholeMap ? 0.52 : 0.4), wholeMap ? 660 : 380, 1100), Math.max(0, most));
  const mainW = Math.max(0, width - right - gap);
  const rightX = left + mainW + gap;
  const panes: Partial<Record<PaneId, Rect>> = {};
  if (design === 'cards') {
    panes.main = { x: left, y: top, w: mainW, h: height };
    panes.tall = { x: rightX, y: top, w: right, h: height };
    return { side, panes };
  }
  const lowH = clamp(height * (design === 'sidebar' ? 0.34 : 0.3), 190, 360);
  const mainH = Math.max(0, height - lowH - gap);
  panes.main = { x: left, y: top, w: mainW, h: mainH };
  panes.low = { x: left, y: top + mainH + gap, w: mainW, h: lowH };
  if (design === 'sidebar') {
    panes.tall = { x: rightX, y: top, w: right, h: height };
    return { side, panes };
  }
  const topH = Math.round((height - gap) * 0.56);
  panes.top = { x: rightX, y: top, w: right, h: topH };
  panes.bottom = { x: rightX, y: top + topH + gap, w: right, h: height - topH - gap };
  return { side, panes };
}

export interface DockState {
  /** Whether each window is open, and how near the front it is. */
  readonly layouts: Readonly<Record<WindowId, { readonly open: boolean; readonly z: number }>>;
  readonly connected: boolean;
  /** Windows pulled out of their pane (design D). */
  readonly floating: readonly WindowId[];
  /** Windows that are only there while open. */
  readonly onDemand: readonly WindowId[];
}

/** The tabs a pane shows now: its windows, without the server while offline, a closed on-demand window, or one pulled out. */
export function paneTabs(design: DockDesign, pane: PaneId, state: DockState): WindowId[] {
  return (PANES[design][pane] ?? []).filter(
    (id) =>
      !(design === 'hybrid' && state.floating.includes(id)) &&
      (id !== 'server' || state.connected) &&
      (!state.onDemand.includes(id) || state.layouts[id].open),
  );
}

/** The tab on show in a pane: the one used last. */
export function paneFront(design: DockDesign, pane: PaneId, state: DockState): WindowId | null {
  const tabs = paneTabs(design, pane, state);
  return tabs.reduce<WindowId | null>((best, id) => (best === null || state.layouts[id].z > state.layouts[best].z ? id : best), null);
}
