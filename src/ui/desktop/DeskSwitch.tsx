import { isConnected } from '../../core';
import { useGame } from '../hooks';
import { deskLayout, useDeskLayout } from './deskLayout';
import { DESKS, DESK_LABELS, type DeskName } from './desks';
import { useWindows } from './windowStore';

/** A tiny picture of each layout: where its windows sit, the main one filled in. */
const PICTURES: Readonly<Record<DeskName, readonly (readonly [number, number, number, number, boolean])[]>> = {
  plan: [
    [1, 1, 13, 12, true],
    [16, 1, 7, 12, false],
  ],
  run: [
    [1, 1, 12, 12, true],
    [15, 1, 8, 6, false],
    [15, 9, 8, 4, false],
  ],
  home: [
    [1, 1, 10, 12, true],
    [13, 1, 10, 7, false],
    [13, 10, 10, 3, false],
  ],
};

/**
 * The three desk layouts, one press each, at the left of the bottom bar.
 * The one whose windows are still all in their places is lit; pressing a
 * layout again puts everything back where it belongs.
 */
export function DeskSwitch() {
  const { current } = useDeskLayout();
  const layouts = useWindows();
  const connected = useGame(isConnected);
  // Lit only while the desk still looks like the layout: some window is where the layout put it.
  const inUse = Object.values(layouts).some((layout) => layout.desk === current && layout.open && !layout.minimized);
  return (
    <div class="desks" role="group" aria-label="Desk layouts" data-tour="desks">
      {DESKS.map((name) => {
        const blocked = name === 'run' && !connected;
        return (
          <button
            key={name}
            type="button"
            class={`desks__btn${name === current && inUse ? ' is-current' : ''}`}
            aria-pressed={name === current && inUse}
            disabled={blocked}
            data-sfx="tab"
            data-tip={blocked ? 'Run is for working a server. Connect to one first.' : DESK_LABELS[name].tip}
            onClick={() => deskLayout.show(name)}
          >
            <svg class="desks__pic" viewBox="0 0 24 14" width="24" height="14" aria-hidden="true">
              {PICTURES[name].map(([x, y, w, h, main], index) => (
                <rect key={index} x={x} y={y} width={w} height={h} rx="1.5" class={main ? 'is-main' : undefined} />
              ))}
            </svg>
            {DESK_LABELS[name].name}
          </button>
        );
      })}
    </div>
  );
}
