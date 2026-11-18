import { findServer, gameDate, isConnected, mostUrgentTrace, ownedProgram, pointsFree, traceHeld, traceReport, tracesByUrgency, type GameState } from '../../core';
import { useEffect, useRef } from 'preact/hooks';
import { formatDay, formatTime, ratingStep } from '../format';
import { useGame, useWorld } from '../hooks';
import { content, session } from '../session';
import { activeConnection, deskStore, useDesk } from './deskStore';
import { GameMenu } from './GameMenu';
import { SpeedControl } from './SpeedControl';
import { WINDOW_DEFS, WINDOW_IDS, useWindows, windows, type WindowId } from './windowStore';

/** Windows that only have a tab on the bar while they are open: Saved games opens from the game menu, the file viewer from a file. */
export const ON_DEMAND: readonly WindowId[] = ['viewer', 'saves'];

const clockText = (ms: number) => {
  const seconds = Math.ceil(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};

/** Without a Trace Tracker you only know that someone is coming, not how close they are. */
const hasTracker = (game: GameState) => ownedProgram(game, content, 'traceTracker') !== undefined;

function showTrace(connectionId?: string): void {
  const connection = connectionId ?? mostUrgentTrace(session.getState(), content)?.id;
  if (connection) deskStore.activate(connection);
  windows.focus('server');
}

/** The other running traces, one line each: where, and how long is left (or that it is held). */
function OtherTraces({ tracker }: { tracker: boolean }) {
  // One text, so the list redraws only when a line changes.
  const lines = useGame((game) =>
    tracesByUrgency(game, content)
      .slice(1)
      .map((connection) => {
        const name = findServer(content, connection.serverId)?.name ?? '';
        const held = traceHeld(game, content, connection);
        const left = tracker ? clockText(traceReport(connection.trace).remainingMs) : '?';
        return [connection.id, name, held ? 'held' : left, held ? 'held' : ''].join('\t');
      })
      .join('\n'),
  );
  if (lines === '') return null;
  return (
    <ul class="alarm__others" aria-label="Other traces">
      {lines.split('\n').map((line) => {
        const [id, name, left, held] = line.split('\t');
        return (
          <li key={id}>
            <button type="button" class={`alarm__other${held ? ' is-held' : ''}`} onClick={() => showTrace(id)}>
              <span>{name}</span>
              <span class="data">{left}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The trace alarm: a red plate that rises out of the middle of the bar
 * while a trace is running, with the time left in large figures. Click
 * it to bring the traced connection to the front. Other traces are
 * listed underneath, most urgent first.
 */
export function TraceAlarm() {
  const server = useGame((game) => {
    const connection = mostUrgentTrace(game, content);
    return connection ? (findServer(content, connection.serverId)?.name ?? '') : null;
  });
  const tracker = useGame(hasTracker);
  const remaining = useGame((game) => {
    const connection = mostUrgentTrace(game, content);
    return connection ? clockText(traceReport(connection.trace).remainingMs) : '';
  });
  // In steps of half a percent, so the bar moves smoothly without redrawing every frame.
  const percent = useGame((game) => {
    const connection = mostUrgentTrace(game, content);
    return connection ? Math.floor(traceReport(connection.trace).progress * 200) / 2 : 0;
  });
  const seconds = useGame((game) => {
    const connection = mostUrgentTrace(game, content);
    return connection ? Math.ceil(traceReport(connection.trace).remainingMs / 1000) : 0;
  });
  const held = useGame((game) => {
    const connection = mostUrgentTrace(game, content);
    if (!connection) return '';
    return connection.monitor.blindMs > 0 ? clockText(connection.monitor.blindMs) : traceHeld(game, content, connection) ? 'busy' : '';
  });
  const isHeld = held !== '';
  const others = useGame((game) => tracesByUrgency(game, content).length - 1);
  if (server === null) return null;

  return (
    <div class={`alarm${isHeld ? ' is-held' : tracker && seconds <= 10 ? ' is-critical' : ''}`}>
      <button
        type="button"
        class="alarm__main"
        title={
          held === 'busy'
            ? 'Its monitor is kept busy from another server. The trace stands still while you hold it.'
            : isHeld
              ? `The monitor is blind for ${held}. The trace stands still until it wakes.`
              : undefined
        }
        onClick={() => showTrace()}
      >
        <span class="alarm__label">
          {isHeld ? (
            <>
              Trace held {held !== 'busy' && <span class="data">{held}</span>}
            </>
          ) : (
            'Trace in progress'
          )}
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
      <OtherTraces tracker={tracker} />
    </div>
  );
}

/**
 * Bottom bar: the game menu, a tab per window, then the trace light,
 * credits, date and time, the speed control and Disconnect.
 */
/** "3 more to Operator", for the rating's tooltip. */
export function ratingTitle(rating: number): string {
  const next = ratingStep(rating).next;
  return next ? `${next.min - rating} more to ${next.title}` : 'Top of the ladder';
}

export function BottomBar() {
  const balance = useGame((game) => Math.floor(game.player.balance).toLocaleString('en-US'));
  // Flash the figure green or red when it changes, but not when the bar first appears.
  const amount = useGame((game) => game.player.balance);
  const lastAmount = useRef(amount);
  const balanceMoved = amount > lastAmount.current ? ' is-up' : amount < lastAmount.current ? ' is-down' : '';
  useEffect(() => {
    const timer = setTimeout(() => (lastAmount.current = amount), 900);
    return () => clearTimeout(timer);
  }, [amount]);
  const rating = useGame((game) => game.player.rating);
  const lastRating = useRef(rating);
  const ratingMoved = rating > lastRating.current ? ' is-up' : rating < lastRating.current ? ' is-down' : '';
  useEffect(() => {
    const timer = setTimeout(() => (lastRating.current = rating), 900);
    return () => clearTimeout(timer);
  }, [rating]);
  const time = useGame((game) => formatTime(gameDate(game)));
  const day = useGame((game) => formatDay(gameDate(game)));
  const connected = useGame(isConnected);
  const tracing = useGame((game) => mostUrgentTrace(game, content) !== undefined);
  const running = useGame((game) => game.tasks.length);
  const unread = useGame((game) => game.messages.filter((message) => !message.read).length);
  const points = useGame((game) => pointsFree(game, content));
  const connections = useGame((game) => game.connections.length);
  const layouts = useWindows();
  const desk = useDesk();
  const active = useWorld((game) => activeConnection(game, desk));
  // The server window only exists while connected.
  const tabs = WINDOW_IDS.filter((id) => (ON_DEMAND.includes(id) ? layouts[id].open : id !== 'server' || connected));

  return (
    <footer class={`dock${tracing ? ' is-tracing' : ''}`}>
      <TraceAlarm />
      <GameMenu />
      <nav class="dock__tabs" aria-label="Windows">
        {tabs.map((id) => (
          <button
            key={id}
            type="button"
            class={`dock__tab${layouts[id].open ? ' is-open' : ''}${layouts[id].minimized ? ' is-minimized' : ''}`}
            title={layouts[id].minimized ? 'Minimized' : undefined}
            aria-pressed={layouts[id].open}
            onClick={() => windows.toggle(id)}
          >
            <span class="dock__name">{WINDOW_DEFS[id].pill}</span>
            {id === 'programs' && running > 0 && <span class="count data" aria-label={`${running} running`}>{running}</span>}
            {id === 'messages' && unread > 0 && <span class="count count--alert data" aria-label={`${unread} unread`}>{unread}</span>}
            {id === 'skills' && points > 0 && <span class="count count--mint data" aria-label={`${points} to spend`}>{points}</span>}
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
        <span key={balance} class={`dock__value data${balanceMoved}`}>
          {balance}
        </span>
      </div>
      <div class="dock__stat" title={ratingTitle(rating)}>
        <span class="dock__label">Rating</span>
        <span key={rating} class={`dock__value${ratingMoved}`}>
          <span class="data">{rating}</span>
          <span class="dock__title">{ratingStep(rating).title}</span>
        </span>
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
