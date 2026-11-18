import {
  HARDWARE_SLOT_LABELS,
  effectiveSpeed,
  gameDate,
  gatewayOf,
  hostedModel,
  installed,
  isConnected,
  isLyingLow,
  maxConnections,
  maxPrograms,
  rentedModel,
  storageGb,
  usedStorageGq,
} from '../../../core';
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
  const uplink = useGame((game) =>
    isConnected(game) ? `${game.connections.length} of ${maxConnections(game, content)} open` : `Idle · ${maxConnections(game, content)} port${maxConnections(game, content) > 1 ? 's' : ''}`,
  );
  const clock = useGame((game) => {
    if (isConnected(game)) return 'Real time (locked while connected)';
    const speed = effectiveSpeed(game);
    return speed === 0 ? 'Paused' : `${speed}×`;
  });

  const rating = useGame((game) => formatRating(game.player.rating));
  const lyingLow = useGame((game) => (isLyingLow(game) ? formatGameTime(game.player.lieLowUntilMs) : ''));
  const usedGb = useGame((game) => usedStorageGq(game, content));
  const capacity = useGame((game) => storageGb(game, content));
  const running = useGame((game) => `${game.tasks.length} of ${maxPrograms(game, content)}`);
  const model = useGame((game) => {
    const rented = rentedModel(game, content);
    const hosted = hostedModel(game, content);
    return [
      hosted ? `${hosted.name} on your rack` : '',
      rented && game.player.model ? `${rented.name} until ${formatGameTime(game.player.model.untilMs)}` : '',
    ]
      .filter(Boolean)
      .join(' · ');
  });
  // Joined into one text so the list only redraws when a part changes.
  const parts = useGame((game) =>
    HARDWARE_SLOT_LABELS.map(([slot, label]) => `${label}\t${installed(game, content, slot)?.name ?? 'empty'}`).join('\n'),
  );
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
          {usedGb} of {capacity} GB used
          <span class="meter" aria-hidden="true">
            <span class="meter__fill" style={{ width: `${Math.min(100, (usedGb / capacity) * 100)}%` }} />
          </span>
        </dd>
        <dt>Model</dt>
        <dd>{model || <span class="row__dim">none</span>}</dd>
        <dt>Hardware</dt>
        <dd>
          <ul class="readout__parts">
            {parts.split('\n').map((line) => {
              const [label, name] = line.split('\t');
              return (
                <li key={label}>
                  <span class="row__dim">{label}</span>
                  <span>{name}</span>
                </li>
              );
            })}
          </ul>
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
