/**
 * What the docked designs share between components: which design is in
 * force on this screen, and the places in the frame (the side column, the
 * sidebar) that other components draw themselves into.
 */
import { useEffect, useState } from 'preact/hooks';
import { isConnected } from '../../core';
import { useGame } from '../hooks';
import { dockRects, paneFront, paneOf, paneTabs, type DockDesign, type DockRects, type DockState, type PaneId } from './dock';
import { useLayout } from './layout';
import { look, useLook } from './lookStore';
import { ON_DEMAND, WINDOW_DEFS, useWindows, windows, type WindowId } from './windowStore';

/** The docked design in force, or null on the classic desk. Phones and tablets always have their own layout. */
export function useDockDesign(): DockDesign | null {
  const design = useLook().design;
  const onDesk = useLayout() === 'desk';
  return onDesk && design !== 'classic' ? design : null;
}

export interface Dock {
  readonly design: DockDesign;
  readonly rects: DockRects;
  readonly state: DockState;
  readonly tabs: (pane: PaneId) => WindowId[];
  readonly front: (pane: PaneId) => WindowId | null;
}

/** Everything a component needs to draw itself docked, or null on the classic desk. */
export function useDock(): Dock | null {
  const design = useDockDesign();
  const layouts = useWindows();
  const floating = useLook().floating;
  const connected = useGame(isConnected);
  if (!design) return null;
  const state: DockState = { layouts, connected, floating, onDemand: ON_DEMAND };
  return {
    design,
    rects: dockRects(design, windows.area()),
    state,
    tabs: (pane) => paneTabs(design, pane, state),
    front: (pane) => paneFront(design, pane, state),
  };
}

/** Design D: pull a window out of its pane. It opens over the pane it left, at its usual size. */
export function pullOut(id: WindowId, design: DockDesign): void {
  const area = windows.area();
  const home = dockRects(design, area).panes[paneOf(design, id)];
  const def = WINDOW_DEFS[id];
  const w = Math.min(def.width, Math.round(area.w * 0.5));
  const h = Math.min(def.height ?? 520, Math.round(area.h * 0.7));
  look.float(id);
  // Over the pane it left, a little in from its corner, and wholly on the desk.
  const x = Math.max(0, Math.min((home?.x ?? 0) + 28, area.w - w - 12));
  const y = Math.max(0, Math.min((home?.y ?? 0) + 28, area.h - h - 12));
  windows.floatAt(id, { x, y, w, h });
}

export type HostName = 'contract' | 'book';

const hosts: Record<HostName, HTMLElement | null> = { contract: null, book: null };
const listeners = new Set<() => void>();

/** The frame hands over (or takes back) one of its places. */
export function setHost(name: HostName, element: HTMLElement | null): void {
  if (hosts[name] === element) return;
  hosts[name] = element;
  listeners.forEach((listener) => listener());
}

/** A place in the frame to draw into, once it is on the page. */
export function useHost(name: HostName): HTMLElement | null {
  const [value, setValue] = useState(hosts[name]);
  useEffect(() => {
    const update = () => setValue(hosts[name]);
    update();
    listeners.add(update);
    return () => void listeners.delete(update);
  }, [name]);
  return value;
}
