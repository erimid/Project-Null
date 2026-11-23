import { describe, expect, it } from 'vitest';
import { boxAround, placeLabels } from './labels';

const bounds = { x: 0, y: 0, w: 500, h: 500 };

describe('placeLabels', () => {
  it('gives a label its first spot when nothing is in the way', () => {
    const placed = placeLabels([{ id: 'a', w: 40, h: 12, spots: [{ x: 100, y: 100 }, { x: 200, y: 200 }] }], [], bounds);
    expect(placed.get('a')).toEqual({ x: 100, y: 100 });
  });

  it('moves a later label to its next spot rather than write over an earlier one', () => {
    const placed = placeLabels(
      [
        { id: 'a', w: 40, h: 12, spots: [{ x: 100, y: 100 }] },
        { id: 'b', w: 40, h: 12, spots: [{ x: 110, y: 104 }, { x: 110, y: 130 }] },
      ],
      [],
      bounds,
    );
    expect(placed.get('a')).toEqual({ x: 100, y: 100 });
    expect(placed.get('b')).toEqual({ x: 110, y: 130 });
  });

  it('leaves a label off when every spot is taken', () => {
    const placed = placeLabels(
      [
        { id: 'a', w: 40, h: 12, spots: [{ x: 100, y: 100 }] },
        { id: 'b', w: 40, h: 12, spots: [{ x: 100, y: 100 }, { x: 104, y: 98 }] },
      ],
      [],
      bounds,
    );
    expect(placed.has('a')).toBe(true);
    expect(placed.has('b')).toBe(false);
  });

  it('keeps clear of blocked boxes and of the edges', () => {
    const placed = placeLabels(
      [
        { id: 'on-dot', w: 40, h: 12, spots: [{ x: 100, y: 100 }, { x: 300, y: 300 }] },
        { id: 'off-edge', w: 40, h: 12, spots: [{ x: 490, y: 100 }] },
      ],
      [boxAround(100, 100, 10)],
      bounds,
    );
    expect(placed.get('on-dot')).toEqual({ x: 300, y: 300 });
    expect(placed.has('off-edge')).toBe(false);
  });

  it('never lets two placed labels overlap', () => {
    const asks = Array.from({ length: 12 }, (_, index) => ({
      id: String(index),
      w: 50,
      h: 14,
      spots: [0, 1, 2].map((turn) => ({ x: 200 + ((index * 17 + turn * 31) % 90), y: 200 + ((index * 11 + turn * 23) % 40) })),
    }));
    const placed = [...placeLabels(asks, [], bounds).entries()].map(([id, at]) => boxAround(at.x, at.y, 50, 14 + Number(id) * 0));
    for (const a of placed) for (const b of placed) if (a !== b) expect(Math.abs(a.x - b.x) >= 50 || Math.abs(a.y - b.y) >= 14).toBe(true);
    expect(placed.length).toBeGreaterThan(1);
  });
});
