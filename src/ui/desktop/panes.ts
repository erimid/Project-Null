/**
 * Which two windows a tablet shows, and in which half of the screen.
 * A window keeps its half while it stays on screen, so opening another
 * one replaces the older of the two instead of shuffling both around.
 */
import { useWorld } from '../hooks';
import { activeConnection, useDesk } from './deskStore';
import { WINDOW_IDS, useWindows, windows, type WindowId } from './windowStore';

export type Panes = readonly [WindowId | null, WindowId | null];

let panes: Panes = [null, null];

/** The windows that are open and not tucked away, most recent first. */
function shownByRecency(): WindowId[] {
  const layouts = windows.get();
  return WINDOW_IDS.filter((id) => layouts[id].open && !layouts[id].minimized).sort((a, b) => layouts[b].z - layouts[a].z);
}

/** Works out the panes from what is open. Pure apart from reading the window layouts. */
export function nextPanes(previous: Panes, shown: readonly WindowId[]): Panes {
  const layouts = windows.get();
  const kept = previous.map((id) => (id !== null && shown.includes(id) ? id : null)) as [WindowId | null, WindowId | null];
  const front = shown[0];
  if (front !== undefined && !kept.includes(front)) {
    const empty = kept.indexOf(null);
    if (empty >= 0) kept[empty] = front;
    else {
      // Replace the one that was used longer ago.
      const older = layouts[kept[0]!].z < layouts[kept[1]!].z ? 0 : 1;
      kept[older] = front;
    }
  }
  // A free half takes the next most recent window.
  for (let half = 0; half < 2; half++) {
    if (kept[half] !== null) continue;
    kept[half] = shown.find((id) => !kept.includes(id)) ?? null;
  }
  return kept;
}

/** The two windows on show. Re-read on every change to the windows, which is when they can change. */
export function usePanes(): Panes {
  // Subscribes this component to the window layouts, so it redraws when they change.
  useWindows();
  // The Server window draws nothing until there is a connection, so it can't hold a half.
  const desk = useDesk();
  const connected = useWorld((game) => activeConnection(game, desk) !== undefined);
  const next = nextPanes(panes, shownByRecency().filter((id) => id !== 'server' || connected));
  panes = next;
  return next;
}
