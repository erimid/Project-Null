import { describe, expect, it } from 'vitest';
import { HAS_SIDE, PANES, dockRects, paneFront, paneOf, paneTabs, type DockDesign, type DockState } from './dock';
import type { Rect } from './snap';
import type { WindowId } from './windowStore';

// Written out here: the window store itself needs a browser.
const WINDOW_IDS: readonly WindowId[] = ['gateway', 'map', 'server', 'programs', 'messages', 'skills', 'web', 'viewer', 'saves', 'defence'];
const ON_DEMAND: readonly WindowId[] = ['viewer', 'saves', 'defence'];

const DESIGNS: readonly DockDesign[] = ['deck', 'cards', 'sidebar', 'hybrid'];
const SCREENS = [
  { w: 1220, h: 610 },
  { w: 1540, h: 790 },
  { w: 1860, h: 970 },
  { w: 3380, h: 1330 },
  { w: 5060, h: 1330 },
];

const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

function state(over: Partial<DockState> = {}, z: Partial<Record<WindowId, number>> = {}): DockState {
  const layouts = Object.fromEntries(WINDOW_IDS.map((id, index) => [id, { open: !ON_DEMAND.includes(id), z: z[id] ?? index }])) as DockState['layouts'];
  return { layouts, connected: true, floating: [], onDemand: ON_DEMAND, ...over };
}

describe('docked desk designs', () => {
  it('gives every window exactly one home pane in every design', () => {
    for (const design of DESIGNS) {
      const homes = Object.values(PANES[design]).flat();
      expect([...homes].sort(), design).toEqual([...WINDOW_IDS].sort());
      for (const id of WINDOW_IDS) expect(PANES[design][paneOf(design, id)], `${design} ${id}`).toContain(id);
    }
  });

  it('keeps every pane on the desk, with room to read, and never overlapping', () => {
    for (const design of DESIGNS) {
      for (const area of SCREENS) {
        const { side, panes } = dockRects(design, area);
        expect(side !== null, design).toBe(HAS_SIDE[design]);
        const rects = [...Object.values(panes), ...(side ? [side] : [])];
        expect(Object.keys(panes).sort(), design).toEqual(Object.keys(PANES[design]).sort());
        rects.forEach((rect, index) => {
          const where = `${design} ${area.w}x${area.h} #${index}`;
          expect(rect.x, where).toBeGreaterThanOrEqual(0);
          expect(rect.y, where).toBeGreaterThanOrEqual(0);
          expect(rect.x + rect.w, where).toBeLessThanOrEqual(area.w);
          expect(rect.y + rect.h, where).toBeLessThanOrEqual(area.h);
          expect(rect.w, where).toBeGreaterThanOrEqual(240);
          expect(rect.h, where).toBeGreaterThanOrEqual(180);
          for (const other of rects.slice(index + 1)) expect(overlap(rect, other), where).toBe(false);
        });
      }
    }
  });

  it('shows the server tab only while connected, and on-demand windows only while open', () => {
    expect(paneTabs('deck', 'main', state())).toEqual(['server', 'gateway', 'web', 'skills']);
    expect(paneTabs('deck', 'main', state({ connected: false }))).toEqual(['gateway', 'web', 'skills']);
    const open = state();
    const withSaves = { ...open, layouts: { ...open.layouts, saves: { open: true, z: 99 } } };
    expect(paneTabs('deck', 'main', withSaves)).toContain('saves');
    expect(paneFront('deck', 'main', withSaves)).toBe('saves');
  });

  it('puts the tab used last in front', () => {
    expect(paneFront('cards', 'tall', state({}, { programs: 50 }))).toBe('programs');
    expect(paneFront('cards', 'tall', state({}, { messages: 51, programs: 50 }))).toBe('messages');
  });

  it('takes a pulled-out window off its pane, in the design that allows it only', () => {
    const pulled = state({ floating: ['messages'] });
    expect(paneTabs('hybrid', 'low', pulled)).toEqual([]);
    expect(paneFront('hybrid', 'low', pulled)).toBeNull();
    expect(paneTabs('deck', 'low', pulled)).toEqual(['messages']);
  });
});
