import { describe, expect, it } from 'vitest';
import { grabOffset, snapMove, snapSize, zoneAt, zoneRect, ZONE_GAP } from './snap';

const area = { w: 1600, h: 900 };

describe('snapMove', () => {
  it('sticks to the desk edges when close', () => {
    expect(snapMove({ x: 7, y: 9, w: 400, h: 300 }, area, [])).toEqual({ x: 0, y: 0 });
    expect(snapMove({ x: 1193, y: 595, w: 400, h: 300 }, area, [])).toEqual({ x: 1200, y: 600 });
  });

  it('leaves a window alone away from any edge', () => {
    expect(snapMove({ x: 300, y: 200, w: 400, h: 300 }, area, [])).toEqual({ x: 300, y: 200 });
  });

  it('sticks its left edge to the right edge of a window beside it', () => {
    const other = { x: 100, y: 100, w: 500, h: 400 };
    expect(snapMove({ x: 608, y: 150, w: 300, h: 200 }, area, [other])).toEqual({ x: 600, y: 150 });
  });

  it('sticks its right edge to the left edge of a window beside it', () => {
    const other = { x: 900, y: 100, w: 500, h: 400 };
    expect(snapMove({ x: 595, y: 150, w: 300, h: 200 }, area, [other])).toEqual({ x: 600, y: 150 });
  });

  it('lines its top up with a neighbour', () => {
    const other = { x: 100, y: 100, w: 500, h: 400 };
    expect(snapMove({ x: 600, y: 106, w: 300, h: 200 }, area, [other])).toEqual({ x: 600, y: 100 });
  });

  it('is not pulled by a window far above or below', () => {
    const other = { x: 100, y: 0, w: 500, h: 100 };
    expect(snapMove({ x: 608, y: 500, w: 300, h: 200 }, area, [other])).toEqual({ x: 608, y: 500 });
  });

  it('takes the nearest of several edges', () => {
    const a = { x: 100, y: 100, w: 500, h: 400 };
    const b = { x: 603, y: 100, w: 300, h: 400 };
    expect(snapMove({ x: 604, y: 150, w: 300, h: 200 }, area, [a, b]).x).toBe(603);
  });
});

describe('snapSize', () => {
  it('stretches the right edge to the desk edge', () => {
    expect(snapSize({ x: 1000, y: 100, w: 592, h: 300 }, area, [])).toEqual({ w: 600, h: 300 });
  });

  it('stops the bottom edge at the top of a window below', () => {
    const below = { x: 0, y: 500, w: 800, h: 300 };
    expect(snapSize({ x: 100, y: 100, w: 400, h: 395 }, area, [below])).toEqual({ w: 400, h: 400 });
  });
});

describe('zones', () => {
  it('offers halves on the sides and quarters in the corners', () => {
    expect(zoneAt(2, 450, area)).toBe('left');
    expect(zoneAt(1598, 450, area)).toBe('right');
    expect(zoneAt(3, 20, area)).toBe('top-left');
    expect(zoneAt(1597, 880, area)).toBe('bottom-right');
    expect(zoneAt(40, 897, area)).toBe('bottom-left');
    expect(zoneAt(1560, 2, area)).toBe('top-right');
  });

  it('fills the desk from the top edge, and offers nothing in the middle', () => {
    expect(zoneAt(800, 3, area)).toBe('full');
    expect(zoneAt(800, 450, area)).toBeNull();
    expect(zoneAt(800, 897, area)).toBeNull();
  });

  it('places halves side by side without overlap, inside the desk', () => {
    const left = zoneRect('left', area);
    const right = zoneRect('right', area);
    expect(left.x).toBe(ZONE_GAP);
    expect(left.x + left.w).toBeLessThan(right.x);
    expect(right.x + right.w).toBe(area.w - ZONE_GAP);
    expect(left.h).toBe(area.h - ZONE_GAP * 2);
  });

  it('places quarters in their corners', () => {
    const q = zoneRect('bottom-right', area);
    expect(q.x + q.w).toBe(area.w - ZONE_GAP);
    expect(q.y + q.h).toBe(area.h - ZONE_GAP);
    const top = zoneRect('top-right', area);
    expect(top.y + top.h).toBeLessThan(q.y);
  });
});

describe('grabOffset', () => {
  it('keeps the pointer the same fraction along the title bar', () => {
    expect(grabOffset(400, 800, 400)).toBe(200);
    expect(grabOffset(10, 800, 400)).toBe(5);
  });

  it('offers thirds along the bottom edge of a wide desk only', () => {
    const wide = { w: 3440, h: 1330 };
    expect(zoneAt(600, 1328, wide)).toBe('third-left');
    expect(zoneAt(1720, 1328, wide)).toBe('third-centre');
    expect(zoneAt(2900, 1328, wide)).toBe('third-right');
    expect(zoneAt(40, 1328, wide)).toBe('bottom-left');
    expect(zoneAt(800, 898, { w: 1600, h: 900 })).toBe(null);
    const rects = (['third-left', 'third-centre', 'third-right'] as const).map((zone) => zoneRect(zone, wide));
    expect(rects[0]!.x).toBe(ZONE_GAP);
    expect(rects[1]!.x).toBe(rects[0]!.x + rects[0]!.w + ZONE_GAP);
    expect(rects[2]!.x).toBe(rects[1]!.x + rects[1]!.w + ZONE_GAP);
    expect(rects[2]!.x + rects[2]!.w).toBe(wide.w - ZONE_GAP);
    for (const rect of rects) expect(rect.h).toBe(wide.h - ZONE_GAP * 2);
  });
});
