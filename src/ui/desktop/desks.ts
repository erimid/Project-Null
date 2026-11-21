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
 */
import type { Area, Rect } from './snap';

export const DESKS = ['plan', 'run', 'home'] as const;
export type DeskName = (typeof DESKS)[number];

/** The windows a layout can place. */
export type DeskWindow = 'map' | 'messages' | 'server' | 'programs' | 'gateway';

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
export const MIN_UNDER_CONTRACT = 150;

const clamp = (value: number, low: number, high: number) => Math.round(Math.min(Math.max(value, low), Math.max(low, high)));

/** Width of the column beside the map in Plan. The contract drops down over it, so it is also the contract's width. */
export function sideWidth(area: Area): number {
  return clamp(area.w * 0.31, 420, 540);
}

/**
 * Where each window of a layout goes on a desk of the given size, the
 * main window last (it ends up in front). Windows fill the desk exactly:
 * none overlaps another and none passes an edge.
 *
 * `contract` is how far the contract hangs down from the top bar while
 * it is dropped down (0 when it is away). In Plan the messages move down
 * to start under it, as long as that leaves them room to be read.
 */
export function deskRects(name: DeskName, area: Area, contract = 0): readonly (readonly [DeskWindow, Rect])[] {
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
