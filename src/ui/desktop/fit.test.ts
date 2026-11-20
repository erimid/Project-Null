import { describe, expect, it } from 'vitest';
import { fitOnDesk, refit } from './fit';
import { snapMove } from './snap';

const area = { w: 1600, h: 900 };

describe('fitOnDesk', () => {
  it('leaves a window that is already on the desk alone', () => {
    expect(fitOnDesk({ x: 100, y: 50, w: 600, h: 400 }, area)).toEqual({ x: 100, y: 50, w: 600, h: 400 });
  });

  it('pulls a window back in past every edge', () => {
    expect(fitOnDesk({ x: -50, y: -20, w: 600, h: 400 }, area)).toEqual({ x: 0, y: 0, w: 600, h: 400 });
    expect(fitOnDesk({ x: 1300, y: 700, w: 600, h: 400 }, area)).toEqual({ x: 1000, y: 500, w: 600, h: 400 });
  });

  it('shrinks a window bigger than the desk to fit it', () => {
    expect(fitOnDesk({ x: 200, y: 100, w: 2000, h: 1200 }, area)).toEqual({ x: 0, y: 0, w: 1600, h: 900 });
  });

  it('keeps a window as tall as its contents on the desk by its real height', () => {
    expect(fitOnDesk({ x: 0, y: 800, w: 600, h: null }, area, 300)).toEqual({ x: 0, y: 600, w: 600, h: null });
  });
});

describe('refit', () => {
  it('keeps a window by the right edge by the right edge when the desk narrows', () => {
    const box = { x: 1000, y: 20, w: 576, h: 400 };
    expect(refit(box, area, { w: 1200, h: 900 })).toMatchObject({ x: 600, w: 576 });
  });

  it('shrinks windows that no longer fit a smaller desk', () => {
    const box = { x: 24, y: 20, w: 760, h: 860 };
    expect(refit(box, area, { w: 700, h: 600 })).toEqual({ x: 0, y: 0, w: 700, h: 600 });
  });
});

describe('dragging a window taller than the room below it', () => {
  // The window is 800 tall at y 300: the desk draws only 600 of it. Snapping
  // with that cut-short height kept its bottom stuck to the desk's bottom,
  // so slow drags went nowhere and fast ones jumped. With its full height it
  // simply follows the pointer, and is kept on the desk.
  it('follows the pointer instead of sticking', () => {
    const full = { w: 700, h: 800 };
    for (const y of [30, 50, 70]) {
      const snapped = snapMove({ x: 400, y, ...full }, area, []);
      expect(fitOnDesk({ x: snapped.x, y: snapped.y, ...full }, area).y).toBe(y);
    }
    expect(fitOnDesk({ x: 400, y: 300, ...full }, area).y).toBe(100);
  });
});
