import { describe, expect, it } from 'vitest';
import { DESKS, DESK_GAP, deskRects, sideWidth } from './desks';
import type { Area, Rect } from './snap';

const SCREENS: readonly Area[] = [
  { w: 1101, h: 500 },
  { w: 1280, h: 610 },
  { w: 1440, h: 790 },
  { w: 1920, h: 970 },
  { w: 2560, h: 1330 },
];

const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('desk layouts', () => {
  it('keeps every window on the desk, with a gap all round', () => {
    for (const area of SCREENS) {
      for (const name of DESKS) {
        for (const [id, rect] of deskRects(name, area)) {
          const where = `${name} ${id} on ${area.w}x${area.h}`;
          expect(rect.x, where).toBeGreaterThanOrEqual(DESK_GAP);
          expect(rect.y, where).toBeGreaterThanOrEqual(DESK_GAP);
          expect(rect.x + rect.w, where).toBeLessThanOrEqual(area.w - DESK_GAP);
          expect(rect.y + rect.h, where).toBeLessThanOrEqual(area.h - DESK_GAP);
          expect(rect.w, where).toBeGreaterThan(300);
          expect(rect.h, where).toBeGreaterThan(100);
        }
      }
    }
  });

  it('never puts one window on top of another', () => {
    for (const area of SCREENS) {
      for (const name of DESKS) {
        const rects = deskRects(name, area);
        rects.forEach(([a, first], index) =>
          rects.slice(index + 1).forEach(([b, second]) => expect(overlap(first, second), `${name}: ${a} over ${b} on ${area.w}x${area.h}`).toBe(false)),
        );
      }
    }
  });

  it('gives the main window the most room, and puts it in front', () => {
    const area = { w: 1440, h: 790 };
    const main = { plan: 'map', run: 'server', home: 'messages' } as const;
    for (const name of DESKS) {
      const rects = deskRects(name, area);
      const [frontId, front] = rects.at(-1)!;
      expect(frontId).toBe(main[name]);
      for (const [, rect] of rects) expect(front.w * front.h).toBeGreaterThanOrEqual(rect.w * rect.h);
    }
  });

  it('gives the route map the whole height of the desk in Plan, beside a column the contract fits', () => {
    const area = { w: 1440, h: 790 };
    const rects = new Map(deskRects('plan', area));
    expect(rects.get('map')!.h).toBe(area.h - DESK_GAP * 2);
    expect(rects.get('messages')!.w).toBe(sideWidth(area));
    expect(sideWidth(area)).toBeGreaterThanOrEqual(420);
  });

  it('moves the messages down under a dropped-down contract in Plan, when there is room', () => {
    const area = { w: 1440, h: 790 };
    const open = new Map(deskRects('plan', area, 400));
    expect(open.get('messages')).toEqual({ x: area.w - DESK_GAP - sideWidth(area), y: 400 + DESK_GAP, w: sideWidth(area), h: area.h - 400 - DESK_GAP * 2 });
    expect(open.get('map')).toEqual(new Map(deskRects('plan', area)).get('map'));
    // A long brief leaves no room: the messages stay where they were, behind it.
    expect(new Map(deskRects('plan', area, 700)).get('messages')).toEqual(new Map(deskRects('plan', area)).get('messages'));
    // The other layouts take no notice.
    expect(deskRects('run', area, 400)).toEqual(deskRects('run', area));
  });
});
