/**
 * The three desk layouts, as plain sums so they can be tested without a
 * screen. Each one says which windows are out and where they sit:
 *
 * - Plan: the route map large, with messages beside it. The contract
 *   drops down over that side column, so the brief is next to the map.
 * - Run: the server large, with the route map (where the trace shows)
 *   and the running programs beside it.
 * - Home: messages, the gateway and its programs, for between jobs.
 *
 * Everything else is put away on the bar.
 *
 * A wide desk (an ultrawide monitor, or a big ordinary one) has room for
 * more than two columns, so each layout brings out a third column there,
 * and a fourth on the widest: the windows that go with the work, not one
 * window stretched across the whole screen.
 */
import type { Area, Rect } from './snap';

export const DESKS = ['plan', 'run', 'home'] as const;
export type DeskName = (typeof DESKS)[number];

/** The windows a layout can place. */
export type DeskWindow = 'map' | 'messages' | 'server' | 'programs' | 'gateway' | 'skills';

export const DESK_LABELS: Readonly<Record<DeskName, { name: string; tip: string }>> = {
  plan: { name: 'Plan', tip: 'Plan a job: the Route map large, your contract and messages beside it.' },
  run: { name: 'Run', tip: 'Work a server: the Server large, the Route map and your programs beside it.' },
  home: { name: 'Home', tip: 'Between jobs: messages, your gateway and your programs.' },
};

/** Space left around and between the windows of a layout. */
export const DESK_GAP = 12;

/** Room the gateway needs for its tiles and its hardware board. */
export const GATEWAY_HEIGHT = 420;

/** The least height worth giving the messages under a dropped-down contract. Shorter than this, they stay full height behind it. */
export const MIN_UNDER_CONTRACT = 260;

const clamp = (value: number, low: number, high: number) => Math.round(Math.min(Math.max(value, low), Math.max(low, high)));

/** From this width a desk gets three columns: 21:9 monitors, and 16:9 ones from 1440p up. */
export const WIDE_DESK = 2200;
/** From this width it gets four: 32:9 monitors, and 4K ones at full size. */
export const SUPERWIDE_DESK = 3800;

/** How many columns of windows a desk of this size is laid out in. */
export function deskColumns(area: Area): 2 | 3 | 4 {
  return area.w >= SUPERWIDE_DESK ? 4 : area.w >= WIDE_DESK ? 3 : 2;
}

/** Width of the column beside the map in Plan. The contract drops down over it, so it is also the contract's width. */
export function sideWidth(area: Area): number {
  return deskColumns(area) === 2 ? clamp(area.w * 0.31, 420, 540) : clamp(area.w * 0.19, 540, 680);
}

/** One window in a column: `height` is its height in pixels, or 'rest' for whatever the column has left. */
type Slot = readonly [DeskWindow, number | 'rest'];
/** A column of a wide layout: `width` in pixels, or 'rest' for the main column, which takes what is left. */
interface Column {
  readonly width: number | 'rest';
  readonly slots: readonly Slot[];
}

/**
 * The columns of a wide layout, left to right. The main window keeps the
 * left and the most room; the columns beside it are as wide as their
 * windows are comfortable at, so no window is stretched thin or left empty.
 */
function wideColumns(name: DeskName, area: Area, fullH: number): readonly Column[] {
  const four = deskColumns(area) === 4;
  const w = area.w;
  const gatewayH = Math.min(GATEWAY_HEIGHT, fullH * 0.5);
  switch (name) {
    case 'plan':
      return four
        ? [
            { width: 'rest', slots: [['map', 'rest']] },
            { width: clamp(w * 0.18, 640, 960), slots: [['programs', 'rest']] },
            { width: clamp(w * 0.2, 760, 1040), slots: [['gateway', gatewayH], ['skills', 'rest']] },
            { width: sideWidth(area), slots: [['messages', 'rest']] },
          ]
        : [
            { width: 'rest', slots: [['map', 'rest']] },
            { width: clamp(w * 0.24, 600, 860), slots: [['gateway', gatewayH], ['programs', 'rest']] },
            { width: sideWidth(area), slots: [['messages', 'rest']] },
          ];
    case 'run':
      return four
        ? [
            { width: 'rest', slots: [['server', 'rest']] },
            { width: clamp(w * 0.24, 760, 1280), slots: [['map', 'rest']] },
            { width: clamp(w * 0.2, 600, 1040), slots: [['programs', 'rest']] },
            { width: clamp(w * 0.2, 560, 1040), slots: [['messages', 'rest']] },
          ]
        : [
            { width: 'rest', slots: [['server', 'rest']] },
            { width: clamp(w * 0.3, 700, 1080), slots: [['map', 'rest']] },
            { width: clamp(w * 0.23, 560, 820), slots: [['programs', fullH * 0.58], ['messages', 'rest']] },
          ];
    case 'home':
      return four
        ? [
            { width: 'rest', slots: [['messages', 'rest']] },
            { width: clamp(w * 0.19, 700, 1000), slots: [['gateway', gatewayH], ['programs', 'rest']] },
            { width: clamp(w * 0.2, 860, 1040), slots: [['skills', 'rest']] },
            { width: clamp(w * 0.24, 760, 1280), slots: [['map', 'rest']] },
          ]
        : [
            { width: 'rest', slots: [['messages', 'rest']] },
            { width: clamp(w * 0.27, 640, 900), slots: [['gateway', gatewayH], ['programs', 'rest']] },
            { width: clamp(w * 0.3, 700, 1080), slots: [['map', 'rest']] },
          ];
  }
}

const MAIN: Readonly<Record<DeskName, DeskWindow>> = { plan: 'map', run: 'server', home: 'messages' };

/** A wide desk: three or four columns, each a window or a stack of them. */
function wideRects(name: DeskName, area: Area, contract: number): readonly (readonly [DeskWindow, Rect])[] {
  const gap = DESK_GAP;
  const fullH = Math.max(0, area.h - gap * 2);
  const columns = wideColumns(name, area, fullH);
  const fixed = columns.reduce((sum, column) => sum + (column.width === 'rest' ? 0 : column.width), 0);
  const restW = Math.max(0, area.w - gap * (columns.length + 1) - fixed);
  const placed: [DeskWindow, Rect][] = [];
  let x = gap;
  for (const column of columns) {
    const width = column.width === 'rest' ? restW : column.width;
    let y = gap;
    let left = fullH;
    column.slots.forEach(([id, height], index) => {
      const last = index === column.slots.length - 1;
      const h = last || height === 'rest' ? left : clamp(height, 0, left - gap);
      let rect: Rect = { x, y, w: width, h };
      // In Plan the messages start under the dropped-down contract, as on a narrower desk.
      if (name === 'plan' && id === 'messages' && contract > 0) {
        const under = Math.round(contract) + gap;
        const room = area.h - gap - under;
        if (room >= MIN_UNDER_CONTRACT) rect = { x, y: under, w: width, h: room };
      }
      placed.push([id, rect]);
      y += h + gap;
      left -= h + gap;
    });
    x += width + gap;
  }
  // The main window last, so it ends up in front.
  return [...placed.filter(([id]) => id !== MAIN[name]), ...placed.filter(([id]) => id === MAIN[name])];
}

/**
 * Where each window of a layout goes on a desk of the given size, the
 * main window last (it ends up in front). Windows fill the desk exactly:
 * none overlaps another and none passes an edge. A wide desk gets more
 * columns, and so more windows (see `deskColumns`).
 *
 * `contract` is how far the contract hangs down from the top bar while
 * it is dropped down (0 when it is away). In Plan the messages move down
 * to start under it, as long as that leaves them room to be read.
 */
export function deskRects(name: DeskName, area: Area, contract = 0): readonly (readonly [DeskWindow, Rect])[] {
  if (deskColumns(area) > 2) return wideRects(name, area, contract);
  const gap = DESK_GAP;
  const fullH = Math.max(0, area.h - gap * 2);
  // Two columns: a main one on the left, a side one of `side` width on the right.
  const columns = (side: number) => {
    const sideW = Math.min(side, Math.max(0, Math.floor((area.w - gap * 3) / 2)));
    const mainW = Math.max(0, area.w - gap * 3 - sideW);
    return { mainW, sideW, sideX: gap * 2 + mainW };
  };
  // A column split in two, the top part `topH` tall.
  const split = (top: number) => {
    const topH = clamp(top, 0, Math.max(0, fullH - gap));
    return { topH, lowY: gap * 2 + topH, lowH: Math.max(0, fullH - gap - topH) };
  };
  switch (name) {
    case 'plan': {
      const { mainW, sideW, sideX } = columns(sideWidth(area));
      const under = Math.round(contract) + gap;
      const room = area.h - gap - under;
      const messages = contract > 0 && room >= MIN_UNDER_CONTRACT ? { y: under, h: room } : { y: gap, h: fullH };
      return [
        ['messages', { x: sideX, w: sideW, ...messages }],
        ['map', { x: gap, y: gap, w: mainW, h: fullH }],
      ];
    }
    case 'run': {
      const { mainW, sideW, sideX } = columns(clamp(area.w * 0.38, 500, 680));
      const { topH, lowY, lowH } = split(fullH * 0.58);
      return [
        ['programs', { x: sideX, y: lowY, w: sideW, h: lowH }],
        ['map', { x: sideX, y: gap, w: sideW, h: topH }],
        ['server', { x: gap, y: gap, w: mainW, h: fullH }],
      ];
    }
    case 'home': {
      const { mainW, sideW, sideX } = columns(clamp(area.w * 0.5, 620, 860));
      const { topH, lowY, lowH } = split(Math.min(GATEWAY_HEIGHT, fullH * 0.62));
      return [
        ['programs', { x: sideX, y: lowY, w: sideW, h: lowH }],
        ['gateway', { x: sideX, y: gap, w: sideW, h: topH }],
        ['messages', { x: gap, y: gap, w: mainW, h: fullH }],
      ];
    }
  }
}
