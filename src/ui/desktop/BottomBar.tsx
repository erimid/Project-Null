import { gameDate, isConnected, mostUrgentTrace, ownedProgram, traceReport, type GameState } from '../../core';
import { formatDay, formatMoney, formatTime } from '../format';
import { useGame, useWorld } from '../hooks';
import { content, session } from '../session';
import { activeConnection, deskStore, useDesk } from './deskStore';
import { SpeedControl } from './SpeedControl';
import { WINDOW_DEFS, WINDOW_IDS, useWindows, windows } from './windowStore';

const clockText = (ms: number) => {
  const seconds = Math.ceil(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};

/** What the trace pill says: "" when all is quiet, otherwise the warning text. */
function traceText(game: GameState): string {
  const connection = mostUrgentTrace(game);
  if (!connection) return '';
  // Without a Trace Tracker you only know that someone is coming.
  if (!ownedProgram(game, content, 'traceTracker')) return 'active';
  const report = traceReport(connection.trace);
  return `${Math.floor(report.progress * 100)}% · ${clockText(report.remainingMs)}`;
}

/** The trace that will finish first. Click it to bring that connection to the front. */
function TracePill() {
  const text = useGame(traceText);
  const count = useGame((game) => game.connections.filter((c) => c.trace.status === 'active').length);
  if (!text) {
    return (
      <span class="pill pill--quiet">
        <span class="pill__dot" aria-hidden="true" />
        No trace
      </span>
    );
  }
  return (
    <button
      type="button"
      class="pill pill--trace"
      onClick={() => {
        const connection = mostUrgentTrace(session.getState());
        if (connection) deskStore.activate(connection.id);
        windows.focus('server');
      }}
    >
      <span class="pill__dot" aria-hidden="true" />
      Trace {text === 'active' ? text : <span class="data">{text}</span>}
      {count > 1 && <span class="pill__count pill__count--alert data">+{count - 1}</span>}
    </button>
  );
}

/**
 * Bottom bar: player handle, a pill per window, trace status, balance
 * and clock, the speed control, and the Disconnect pill.
 */
export function BottomBar() {
  const handle = useGame((game) => game.player.handle);
  const balance = useGame((game) => formatMoney(game.player.balance));
  const time = useGame((game) => formatTime(gameDate(game)));
  const day = useGame((game) => formatDay(gameDate(game)));
  const connected = useGame(isConnected);
  const running = useGame((game) => game.tasks.length);
  const unread = useGame((game) => game.messages.filter((message) => !message.read).length);
  const connections = useGame((game) => game.connections.length);
  const layouts = useWindows();
  const desk = useDesk();
  const active = useWorld((game) => activeConnection(game, desk));
  // The server window only exists while connected.
  const pills = WINDOW_IDS.filter((id) => id !== 'server' || connected);

  return (
    <footer class="bottombar">
      <span class="bottombar__handle">{handle}</span>
      {pills.map((id) => (
        <button
          key={id}
          type="button"
          class={`pill${layouts[id].open ? ' pill--open' : ''}`}
          aria-pressed={layouts[id].open}
          onClick={() => windows.toggle(id)}
        >
          {WINDOW_DEFS[id].pill}
          {id === 'programs' && running > 0 && <span class="pill__count data">{running}</span>}
          {id === 'messages' && unread > 0 && <span class="pill__count pill__count--alert data">{unread}</span>}
        </button>
      ))}
      <span class="bottombar__spacer" />
      <TracePill />
      <span class="bottombar__status data" title={day}>
        {balance} · {time}
      </span>
      <SpeedControl />
      <button
        class="pill pill--danger"
        type="button"
        disabled={!active}
        title="Shift+Esc drops every connection"
        onClick={() => active && session.dispatch({ type: 'disconnect', connectionId: active.id })}
      >
        Disconnect
      </button>
      {connections > 1 && (
        <button
          class="pill pill--danger"
          type="button"
          title="Shift+Esc"
          onClick={() => session.dispatch({ type: 'disconnectAll' })}
        >
          All
        </button>
      )}
    </footer>
  );
}
