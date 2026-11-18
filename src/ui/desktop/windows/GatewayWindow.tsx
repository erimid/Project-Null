import { effectiveSpeed, gameDate, gatewayOf, isConnected, isLyingLow, usedStorageGq } from '../../../core';
import { formatDay, formatGameTime, formatRating, formatTime } from '../../format';
import { useGame } from '../../hooks';
import { content } from '../../session';
import { Window } from '../Window';

/** Status of the player's own machine. The build line shows which version of the game is running. */
export function GatewayWindow() {
  const handle = useGame((game) => game.player.handle);
  const balance = useGame((game) => Math.floor(game.player.balance).toLocaleString('en-US'));
  const localTime = useGame((game) => {
    const date = gameDate(game);
    return `${formatDay(date)} ${formatTime(date)}`;
  });
  const uplink = useGame((game) => (isConnected(game) ? 'Connected' : 'Idle'));
  const clock = useGame((game) => {
    if (isConnected(game)) return 'Real time (locked while connected)';
    const speed = effectiveSpeed(game);
    return speed === 0 ? 'Paused' : `${speed}×`;
  });

  const rating = useGame((game) => formatRating(game.player.rating));
  const lyingLow = useGame((game) => (isLyingLow(game) ? formatGameTime(game.player.lieLowUntilMs) : ''));
  const usedGb = useGame(usedStorageGq);
  const running = useGame((game) => `${game.tasks.length} of ${content.rules.maxRunningPrograms}`);
  const gateway = gatewayOf(content);

  return (
    <Window id="gateway" note={gateway.address}>
      <dl class="readout">
        <dt>Operator</dt>
        <dd>{handle}</dd>
        <dt>Status</dt>
        <dd class="is-ok">Online</dd>
        <dt>Connection</dt>
        <dd>{uplink}</dd>
        <dt>Credits</dt>
        <dd>{balance}</dd>
        <dt>Rating</dt>
        <dd>{rating}</dd>
        {lyingLow && (
          <>
            <dt>Lying low</dt>
            <dd class="is-warn">until {lyingLow}</dd>
          </>
        )}
        <dt>Storage</dt>
        <dd>
          {usedGb} of {content.rules.storageGq} GB used
          <span class="meter" aria-hidden="true">
            <span class="meter__fill" style={{ width: `${Math.min(100, (usedGb / content.rules.storageGq) * 100)}%` }} />
          </span>
        </dd>
        <dt>Programs</dt>
        <dd>{running} running</dd>
        <dt>Date</dt>
        <dd>{localTime}</dd>
        <dt>Clock</dt>
        <dd>{clock}</dd>
      </dl>
      <p class="readout__build data">
        build {__APP_VERSION__} · {__APP_COMMIT__}
      </p>
    </Window>
  );
}
