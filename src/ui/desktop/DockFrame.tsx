import { isConnected } from '../../core';
import { useGame } from '../hooks';
import { PANES, paneOf, type PaneId } from './dock';
import { setHost, useDock } from './dockStore';
import { WINDOW_HELP } from './help';
import { Icon, type IconName } from './Icon';
import { look } from './lookStore';
import { useCounts } from './PhoneDock';
import { ON_DEMAND, WINDOW_DEFS, WINDOW_IDS, windows, type WindowId } from './windowStore';

const WINDOW_ICONS: Readonly<Record<WindowId, IconName>> = {
  gateway: 'rack',
  map: 'route',
  server: 'terminal',
  programs: 'chip',
  messages: 'send',
  skills: 'sparkle',
  web: 'grid',
  viewer: 'file',
  saves: 'drives',
  defence: 'shield',
};

/**
 * The docked designs' way to every window: an icon rail (A, B, D) or a
 * sidebar with the names written out and the contract underneath (C).
 * Pressing one brings its tab to the front of its pane.
 */
export function DockNav() {
  const dock = useDock();
  const counts = useCounts();
  const connected = useGame(isConnected);
  if (!dock) return null;
  const labelled = dock.design === 'sidebar';
  const ids = WINDOW_IDS.filter((id) => (ON_DEMAND.includes(id) ? dock.state.layouts[id].open : id !== 'server' || connected));
  const lit = (id: WindowId) => dock.state.floating.includes(id) && dock.design === 'hybrid' ? windows.isOnTop(id) : dock.front(paneOf(dock.design, id)) === id;
  const nav = (
    <nav class={labelled ? 'sidebar__nav' : 'rail'} aria-label="Windows" data-tour="tabs">
      {ids.map((id) => {
        const count = counts[id];
        return (
          <button
            key={id}
            type="button"
            data-window={id}
            class={`rail__btn${lit(id) ? ' is-front' : ''}`}
            aria-pressed={lit(id)}
            data-sfx="tab"
            data-tip={WINDOW_HELP[id].summary}
            onClick={() => windows.focus(id)}
          >
            <Icon name={WINDOW_ICONS[id]} size={labelled ? 18 : 22} />
            <span class="rail__name">{labelled ? WINDOW_DEFS[id].title : WINDOW_DEFS[id].pill}</span>
            {count && (
              <span class={`count${count.tone} data`} aria-label={count.label}>
                {count.n}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
  if (!labelled) return nav;
  return (
    <aside class="sidebar">
      {nav}
      <div class="sidebar__contract dockhost" ref={(element) => setHost('contract', element)} />
    </aside>
  );
}

/**
 * What a docked design draws on the desk besides the windows: the side
 * column (the contract over the address book), and a note in any pane
 * whose windows have all been pulled out.
 */
export function DockFrame() {
  const dock = useDock();
  if (!dock) return null;
  const { side, panes } = dock.rects;
  return (
    <>
      {side && (
        <aside class="dockside" style={{ left: `${side.x}px`, top: `${side.y}px`, width: `${side.w}px`, height: `${side.h}px` }}>
          <div class="dockside__contract dockhost" ref={(element) => setHost('contract', element)} />
          <div class="dockside__book dockhost" ref={(element) => setHost('book', element)} />
        </aside>
      )}
      {(Object.entries(panes) as [PaneId, NonNullable<(typeof panes)[PaneId]>][]).map(([pane, rect]) => {
        if (dock.tabs(pane).length > 0) return null;
        const out = (PANES[dock.design][pane] ?? []).filter((id) => dock.state.floating.includes(id) && !ON_DEMAND.includes(id));
        return (
          <div key={pane} class="dockempty" style={{ left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.w}px`, height: `${rect.h}px` }}>
            <p>{out.length > 0 ? 'Pulled out to float.' : 'Nothing here.'}</p>
            {out.map((id) => (
              <button key={id} type="button" class="btn" onClick={() => look.dock(id)}>
                Put {WINDOW_DEFS[id].title} back
              </button>
            ))}
          </div>
        );
      })}
    </>
  );
}
