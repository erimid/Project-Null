/**
 * Keeping windows on the desk, as plain sums so it can be tested without a screen.
 *
 * A window never goes past an edge of the desk: it is moved back in, and
 * if it is bigger than the desk it is made smaller to fit.
 */
import type { Area } from './snap';

export interface Placed {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  /** Null for a window as tall as its contents. */
  readonly h: number | null;
}

/**
 * `box` moved and shrunk so all of it is on the desk. `tall` is how tall
 * a window with no set height really is (its contents), when that is known.
 */
export function fitOnDesk(box: Placed, area: Area, tall?: number): Placed {
  const w = Math.max(0, Math.min(box.w, area.w));
  const h = box.h === null ? null : Math.max(0, Math.min(box.h, area.h));
  const height = Math.min(h ?? tall ?? 0, area.h);
  return {
    x: Math.round(clamp(box.x, 0, area.w - w)),
    y: Math.round(clamp(box.y, 0, area.h - height)),
    w,
    h,
  };
}

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), Math.max(low, high));

/**
 * Where a window goes when the desk changes size: it keeps its distance
 * from whichever side it was nearer to, then is fitted onto the new desk.
 */
export function refit(box: Placed, before: Area, after: Area, tall?: number): Placed {
  const rightGap = before.w - (box.x + box.w);
  const x = box.x > rightGap ? after.w - box.w - rightGap : box.x;
  return fitOnDesk({ ...box, x }, after, tall);
}
