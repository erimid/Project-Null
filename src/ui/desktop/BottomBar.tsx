import { findServer, gameDate, isConnected, mostUrgentTrace, ownedProgram, traceReport, type GameState } from '../../core';
import { formatDay, formatTime } from '../format';
import { useGame, useWorld } from '../hooks';
import { content, session } from '../session';
import { activeConnection, deskStore, useDesk } from './deskStore';
import { GameMenu } from './GameMenu';
import { SpeedControl } from './SpeedControl';
import { WINDOW_DEFS, WINDOW_IDS, useWindows, windows, type WindowId } from './windowStore';

/** Windows that have a tab on the bar. Saved games opens from the game menu instead. */
const TABS: readonly WindowId[] = WINDOW_IDS.filter((id) => id !== 'saves');

const clockText = (ms: number) => {
  const seconds = Math.ceil(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};

/** Without a Trace Tracker you only know that someone is coming, not how close they are. */
const hasTracker = (game: GameState) => ownedProgram(game, content, 'traceTracker') !== undefined;

function showTrace(): void {
  const connection = mostUrgentTrace(session.getState());
  if (connection) deskStore.activate(connection.id);
  windows.focus('server');
}

/**
 * The trace alarm: a red plate that rises out of the middle of the bar
 * while a trace is running, with the time left in large figures. Click
 * it to bring the traced connection to the front.
 */
function TraceAlarm() {
  const server = useGame((game) => {
    const connection = mostUrgentTrace(game);
    return connection ? (findServer(content, connection.serverId)?.name ?? '') : null;
  });
  const tracker = useGame(hasTracker);
  const remaining = useGame((game) => {
    const connection = mostUrgentTrace(game);
    return connection ? clockText(traceReport(connection.trace).remainingMs) : '';
  });
  // In steps of half a percent, so the bar moves smoothly without redrawing every frame.
  const percent = useGame((game) => {
    const connection = mostUrgentTrace(game);
    return connection ? Math.floor(traceReport(connection.trace).progress * 200) / 2 : 0;
  });
  const seconds = useGame((game) => {
    const connection = mostUrgentTrace(game);
    return connection ? Math.ceil(traceReport(connection.trace).remainingMs / 1000) : 0;
  });
  const others = useGame((game) => game.connections.filter((c) => c.trace.status === 'active').length - 1);
  if (server === null) return null;

  return (
    <button type="button" class={`alarm${tracker && seconds <= 10 ? ' is-critical' : ''}`} onClick={showTrace}>
      <span class="alarm__label">
        Trace in progress
        {others > 0 && <span class="alarm__more data">+{others}</span>}
      </span>
      {tracker ? (
        <span class="alarm__time data" aria-label={`${seconds} seconds left`}>
          {remaining}
        </span>
      ) : (
        <span class="alarm__time alarm__time--unknown">Time unknown</span>
      )}
      <span class="alarm__server">{server}</span>
      {tracker && (
        <span class="alarm__bar" aria-hidden="true">
          <span class="alarm__fill" style={{ width: `${percent}%` }} />
        </span>
      )}
    </button>
  );
}

/**
 * Bottom bar: the game menu, a tab per window, then the trace light,
 * credits, date and time, the speed control and Disconnect.
 */
export function BottomBar() {
  const balance = useGame((game) => Math.floor(game.player.balance).toLocaleString('en-US'));
  const time = useGame((game) => formatTime(gameDate(game)));
  const day = useGame((game) => formatDay(gameDate(game)));
  const connected = useGame(isConnected);
  const tracing = useGame((game) => mostUrgentTrace(game) !== undefined);
  const running = useGame((game) => game.tasks.length);
  const unread = useGame((game) => game.messages.filter((message) => !message.read).length);
  const connections = useGame((game) => game.connections.length);
  const layouts = useWindows();
  const desk = useDesk();
  const active = useWorld((game) => activeConnection(game, desk));
  // The server window only exists while connected.
  const tabs = TABS.filter((id) => id !== 'server' || connected);

  return (
    <footer class={`dock${tracing ? ' is-tracing' : ''}`}>
      <TraceAlarm />
      <GameMenu />
      <nav class="dock__tabs" aria-label="Windows">
        {tabs.map((id) => (
          <button
            key={id}
            type="button"
            class={`dock__tab${layouts[id].open ? ' is-open' : ''}`}
            aria-pressed={layouts[id].open}
            onClick={() => windows.toggle(id)}
          >
            {WINDOW_DEFS[id].pill}
            {id === 'programs' && running > 0 && <span class="count data">{running}</span>}
            {id === 'messages' && unread > 0 && <span class="count count--alert data">{unread}</span>}
          </button>
        ))}
      </nav>
      <span class="dock__spacer" />
      <div class={`dock__stat dock__stat--trace${tracing ? ' is-tracing' : ''}`}>
        <span class="dock__label">Trace</span>
        <span class="dock__value">
          <span class="dock__light" aria-hidden="true" />
          {tracing ? 'Active' : 'None'}
        </span>
      </div>
      <div class="dock__stat">
        <span class="dock__label">Credits</span>
        <span class="dock__value data">{balance}</span>
      </div>
      <div class="dock__stat">
        <span class="dock__label">{day}</span>
        <span class="dock__value data">{time}</span>
      </div>
      <SpeedControl />
      <button
        class="dock__cut"
        type="button"
        disabled={!active}
        title="Shift+Esc drops every connection"
        onClick={() => active && session.dispatch({ type: 'disconnect', connectionId: active.id })}
      >
        Disconnect
      </button>
      {connections > 1 && (
        <button class="dock__cut" type="button" title="Shift+Esc" onClick={() => session.dispatch({ type: 'disconnectAll' })}>
          All
        </button>
      )}
    </footer>
  );
}
