/**
 * Window snapping, as plain sums so it can be tested without a screen.
 *
 * While a window is dragged its edges stick to the edges of the desk and
 * to the edges of other windows when they come close. Dragging the
 * pointer right up to a side of the desk offers to fill that half,
 * a corner a quarter, and the top edge the whole desk.
 */

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface Area {
  readonly w: number;
  readonly h: number;
}

export type Zone = 'left' | 'right' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'full';

/** How close, in pixels, an edge has to come before it sticks. */
export const SNAP_DISTANCE = 12;
/** How close the pointer has to come to a side of the desk to offer a zone. */
export const ZONE_EDGE = 14;
/** How far along a side counts as its corner. */
export const ZONE_CORNER = 90;
/** Space left around and between windows placed in a zone. */
export const ZONE_GAP = 8;

/** The nearest candidate within reach of `value`, or `value` itself if none is. */
function nearest(value: number, candidates: readonly number[], reach: number): number {
  let best = value;
  let bestDistance = reach + 1;
  for (const candidate of candidates) {
    const distance = Math.abs(candidate - value);
    if (distance <= reach && distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

/** Whether two spans overlap or come within `reach` of each other. */
const near = (a0: number, a1: number, b0: number, b1: number, reach: number) => a0 <= b1 + reach && b0 <= a1 + reach;

/**
 * Where a window being dragged to `rect` should actually go. Each axis
 * snaps on its own: the left edge or the right edge, whichever is nearer
 * to something, and the same for top and bottom. Other windows only
 * count if they sit alongside, so a window far above does not pull.
 */
export function snapMove(rect: Rect, area: Area, others: readonly Rect[], reach = SNAP_DISTANCE): { x: number; y: number } {
  const xs: number[] = [0, area.w - rect.w];
  const ys: number[] = [0, area.h - rect.h];
  for (const other of others) {
    if (near(rect.y, rect.y + rect.h, other.y, other.y + other.h, reach)) {
      // Left edge to its left or right edge; right edge to its left or right edge.
      xs.push(other.x, other.x + other.w, other.x - rect.w, other.x + other.w - rect.w);
    }
    if (near(rect.x, rect.x + rect.w, other.x, other.x + other.w, reach)) {
      ys.push(other.y, other.y + other.h, other.y - rect.h, other.y + other.h - rect.h);
    }
  }
  return { x: nearest(rect.x, xs, reach), y: nearest(rect.y, ys, reach) };
}

/**
 * The size a window being resized to `rect` should actually take: its
 * right and bottom edges stick like `snapMove`, its top-left corner stays put.
 */
export function snapSize(rect: Rect, area: Area, others: readonly Rect[], reach = SNAP_DISTANCE): { w: number; h: number } {
  const rights: number[] = [area.w];
  const bottoms: number[] = [area.h];
  for (const other of others) {
    if (near(rect.y, rect.y + rect.h, other.y, other.y + other.h, reach)) rights.push(other.x, other.x + other.w);
    if (near(rect.x, rect.x + rect.w, other.x, other.x + other.w, reach)) bottoms.push(other.y, other.y + other.h);
  }
  const right = nearest(rect.x + rect.w, rights.filter((edge) => edge > rect.x), reach);
  const bottom = nearest(rect.y + rect.h, bottoms.filter((edge) => edge > rect.y), reach);
  return { w: right - rect.x, h: bottom - rect.y };
}

/** The zone the pointer is offering, if it is pressed up against a side of the desk. */
export function zoneAt(px: number, py: number, area: Area): Zone | null {
  const left = px <= ZONE_EDGE;
  const right = px >= area.w - ZONE_EDGE;
  const top = py <= ZONE_EDGE;
  const bottom = py >= area.h - ZONE_EDGE;
  const nearTop = py <= ZONE_CORNER;
  const nearBottom = py >= area.h - ZONE_CORNER;
  const nearLeft = px <= ZONE_CORNER;
  const nearRight = px >= area.w - ZONE_CORNER;
  if (left || right) {
    const side = left ? 'left' : 'right';
    if (nearTop) return `top-${side}`;
    if (nearBottom) return `bottom-${side}`;
    return side;
  }
  if (top) {
    if (nearLeft) return 'top-left';
    if (nearRight) return 'top-right';
    return 'full';
  }
  if (bottom) {
    if (nearLeft) return 'bottom-left';
    if (nearRight) return 'bottom-right';
  }
  return null;
}

/** Where a window placed in `zone` goes. */
export function zoneRect(zone: Zone, area: Area, gap = ZONE_GAP): Rect {
  const halfW = Math.round((area.w - gap * 3) / 2);
  const halfH = Math.round((area.h - gap * 3) / 2);
  const fullW = area.w - gap * 2;
  const fullH = area.h - gap * 2;
  const rightX = area.w - gap - halfW;
  const bottomY = area.h - gap - halfH;
  switch (zone) {
    case 'full':
      return { x: gap, y: gap, w: fullW, h: fullH };
    case 'left':
      return { x: gap, y: gap, w: halfW, h: fullH };
    case 'right':
      return { x: rightX, y: gap, w: halfW, h: fullH };
    case 'top-left':
      return { x: gap, y: gap, w: halfW, h: halfH };
    case 'top-right':
      return { x: rightX, y: gap, w: halfW, h: halfH };
    case 'bottom-left':
      return { x: gap, y: bottomY, w: halfW, h: halfH };
    case 'bottom-right':
      return { x: rightX, y: bottomY, w: halfW, h: halfH };
  }
}

/**
 * When a window that fills a zone is dragged away, it goes back to its
 * own size. This keeps the pointer at the same fraction along its title
 * bar, so the window does not jump out from under the hand.
 */
export function grabOffset(dx: number, fromWidth: number, toWidth: number): number {
  if (fromWidth <= 0) return Math.min(dx, toWidth);
  return Math.round((dx / fromWidth) * toWidth);
}
