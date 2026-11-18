import { gameDate, isConnected } from '../../core';
import { formatDay, formatMoney, formatTime } from '../format';
import { useGame, useWorld } from '../hooks';
import { session } from '../session';
import { activeConnection, useDesk } from './deskStore';
import { SpeedControl } from './SpeedControl';
import { WINDOW_DEFS, WINDOW_IDS, useWindows, windows } from './windowStore';

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
        </button>
      ))}
      <span class="bottombar__spacer" />
      <span class="pill pill--quiet">
        <span class="pill__dot" aria-hidden="true" />
        No trace
      </span>
      <span class="bottombar__status data" title={day}>
        {balance} · {time}
      </span>
      <SpeedControl />
      <button
        class="pill pill--danger"
        type="button"
        disabled={!active}
        onClick={() => active && session.dispatch({ type: 'disconnect', connectionId: active.id })}
      >
        Disconnect
      </button>
    </footer>
  );
}
