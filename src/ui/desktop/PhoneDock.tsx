import { useEffect, useState } from 'preact/hooks';
import { gameDate, isConnected, mostUrgentTrace, pointsFree } from '../../core';
import { formatTime, ratingStep } from '../format';
import { useGame, useWorld } from '../hooks';
import { content, session } from '../session';
import { ON_DEMAND, TraceAlarm } from './BottomBar';
import { activeConnection, useDesk } from './deskStore';
import { GameMenu } from './GameMenu';
import { lit, useGuide } from './guide';
import { WINDOW_HELP } from './help';
import { useLayout } from './layout';
import { usePanes } from './panes';
import { SpeedControl } from './SpeedControl';
import { WINDOW_DEFS, WINDOW_IDS, useWindows, windows, type WindowId } from './windowStore';

/** The four windows that get a tab of their own on a phone. Everything else is under More. */
const MAIN: readonly WindowId[] = ['server', 'map', 'gateway', 'messages'];

/** Little numbers on a tab: programs running, unread mail, skill points to spend. */
function useCounts(): Partial<Record<WindowId, { n: number; tone: string; label: string }>> {
  const running = useGame((game) => game.tasks.length);
  const unread = useGame((game) => game.messages.filter((message) => !message.read).length);
  const points = useGame((game) => pointsFree(game, content));
  return {
    ...(running > 0 && { programs: { n: running, tone: '', label: `${running} running` } }),
    ...(unread > 0 && { messages: { n: unread, tone: ' count--alert', label: `${unread} unread` } }),
    ...(points > 0 && { skills: { n: points, tone: ' count--mint', label: `${points} to spend` } }),
  };
}

/**
 * The phone's bottom bar: a slim status row (menu, credits, clock, and
 * the speed control or Disconnect, whichever can be used right now),
 * then four big tabs and More. More slides up a sheet with every other
 * window.
 */
export function PhoneDock() {
  const [sheet, setSheet] = useState(false);
  const layouts = useWindows();
  const counts = useCounts();
  const balance = useGame((game) => Math.floor(game.player.balance).toLocaleString('en-US'));
  const time = useGame((game) => formatTime(gameDate(game)));
  const rating = useGame((game) => game.player.rating);
  const connected = useGame(isConnected);
  const connections = useGame((game) => game.connections.length);
  const tracing = useGame((game) => mostUrgentTrace(game, content) !== undefined);
  const desk = useDesk();
  const guide = useGuide();
  const active = useWorld((game) => activeConnection(game, desk));

  // On a tablet two windows are on show, and the dock lights both.
  const panes = usePanes();
  const tablet = useLayout() === 'tablet';
  const frontId = WINDOW_IDS.find((id) => windows.isOnTop(id));
  const onShow = (id: WindowId) => (tablet ? panes.includes(id) : frontId === id);
  const others = WINDOW_IDS.filter((id) => !MAIN.includes(id) && (!ON_DEMAND.includes(id) || layouts[id].open));
  const moreCount = others.reduce((sum, id) => sum + (counts[id]?.n ?? 0), 0);

  // Esc closes the sheet, for a phone with a keyboard.
  useEffect(() => {
    if (!sheet) return;
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setSheet(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sheet]);

  const open = (id: WindowId) => {
    windows.focus(id);
    setSheet(false);
  };

  return (
    <footer class={`pdock${tracing ? ' is-tracing' : ''}`}>
      <TraceAlarm />
      {sheet && (
        <>
          <button type="button" class="pdock__scrim" aria-label="Close" onClick={() => setSheet(false)} />
          <div class="pdock__sheet" role="dialog" aria-label="More windows">
            <div class="pdock__grid">
              {others.map((id) => {
                const count = counts[id];
                return (
                  <button
                    key={id}
                    type="button"
                    class={`pdock__item${onShow(id) ? ' is-front' : ''}${layouts[id].open ? ' is-open' : ''}`}
                    onClick={() => open(id)}
                  >
                    {WINDOW_DEFS[id].title}
                    {count && (
                      <span class={`count${count.tone} data`} aria-label={count.label}>
                        {count.n}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <div class="pdock__facts">
              <span>
                Rating <span class="data">{rating}</span> · {ratingStep(rating).title}
              </span>
              {connections > 1 && (
                <button
                  type="button"
                  class="dock__cut"
                  onClick={() => {
                    session.dispatch({ type: 'disconnectAll' });
                    setSheet(false);
                  }}
                >
                  Disconnect all
                </button>
              )}
            </div>
          </div>
        </>
      )}
      <div class="pdock__status">
        <GameMenu />
        <span class="pdock__stat data" data-tip="Your credits">{balance} c</span>
        <span class="pdock__stat data" data-tip="Game time">{time}</span>
        <span class="dock__spacer" />
        {connected ? (
          <button
            class={`dock__cut${lit(guide, ['leave-board', 'leave-target'])}`}
            type="button"
            disabled={!active}
            onClick={() => active && session.dispatch({ type: 'disconnect', connectionId: active.id })}
          >
            Disconnect
          </button>
        ) : (
          <SpeedControl />
        )}
      </div>
      <nav class="pdock__tabs" aria-label="Windows" data-tour="tabs">
        {MAIN.map((id) => {
          const count = counts[id];
          return (
            <button
              key={id}
              type="button"
              class={`pdock__tab${onShow(id) ? ' is-front' : ''}`}
              aria-pressed={onShow(id)}
              disabled={id === 'server' && !connected}
              data-tip={id === 'server' && !connected ? 'Connect to a server from the Route map first.' : WINDOW_HELP[id].summary}
              onClick={() => open(id)}
            >
              {WINDOW_DEFS[id].pill}
              {count && (
                <span class={`count${count.tone} data`} aria-label={count.label}>
                  {count.n}
                </span>
              )}
            </button>
          );
        })}
        <button
          type="button"
          class={`pdock__tab${sheet || others.some(onShow) ? ' is-front' : ''}`}
          aria-expanded={sheet}
          onClick={() => setSheet(!sheet)}
        >
          More
          {moreCount > 0 && <span class="count count--mint data">{moreCount}</span>}
        </button>
      </nav>
    </footer>
  );
}
