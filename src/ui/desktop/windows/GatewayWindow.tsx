import { effectiveSpeed, gameDate, isConnected } from '../../../core';
import { gameInfo } from '../../../content';
import { formatDay, formatMoney, formatTime } from '../../format';
import { useGame } from '../../hooks';
import { Window } from '../Window';

/** Status of the player's own machine. The build line shows which version of the game is running. */
export function GatewayWindow() {
  const handle = useGame((game) => game.player.handle);
  const balance = useGame((game) => formatMoney(game.player.balance));
  const localTime = useGame((game) => {
    const date = gameDate(game);
    return `${formatDay(date)} ${formatTime(date)}`;
  });
  const uplink = useGame((game) => (isConnected(game) ? 'connected' : 'idle'));
  const clock = useGame((game) => {
    if (isConnected(game)) return 'real time (locked)';
    const speed = effectiveSpeed(game);
    return speed === 0 ? 'paused' : `${speed}×`;
  });

  return (
    <Window id="gateway" note={gameInfo.title}>
      <dl class="readout data">
        <dt>operator</dt>
        <dd>{handle}</dd>
        <dt>status</dt>
        <dd class="is-ok">online</dd>
        <dt>uplink</dt>
        <dd>{uplink}</dd>
        <dt>balance</dt>
        <dd>{balance}</dd>
        <dt>local time</dt>
        <dd>{localTime}</dd>
        <dt>clock</dt>
        <dd>{clock}</dd>
        <dt>build</dt>
        <dd>
          {__APP_VERSION__} · {__APP_COMMIT__}
        </dd>
      </dl>
    </Window>
  );
}
