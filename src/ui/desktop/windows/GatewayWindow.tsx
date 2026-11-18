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
import { formatDay, formatGameTime, formatRating, formatTime, ratingStep } from '../../format';
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
    if (isConnected(game)) return 'Real time, locked';
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

  const step = useGame((game) => {
    const { next, share } = ratingStep(game.player.rating);
    return `${Math.round(share * 100)}\t${next ? `${next.title} at ${next.min}` : 'top of the ladder'}`;
  });
  const [stepShare, stepNext] = step.split('\t');

  return (
    <Window id="gateway" note={gateway.address}>
      <dl class="tiles">
        <div class="tile">
          <dt>Operator</dt>
          <dd>{handle}</dd>
        </div>
        <div class="tile">
          <dt>Connection</dt>
          <dd class={uplink.startsWith('Idle') ? undefined : 'is-ok'}>{uplink}</dd>
        </div>
        <div class="tile">
          <dt>Programs</dt>
          <dd>{running} running</dd>
        </div>
        <div class="tile">
          <dt>Clock</dt>
          <dd>{clock}</dd>
          <span class="tile__sub">{localTime}</span>
        </div>
        <div class="tile">
          <dt>Credits</dt>
          <dd class="data">{balance}</dd>
        </div>
        <div class="tile">
          <dt>Rating</dt>
          <dd>{rating}</dd>
          <span class="meter meter--mint" aria-hidden="true">
            <span class="meter__fill" style={{ width: `${stepShare}%` }} />
          </span>
          <span class="tile__sub">{lyingLow ? <span class="is-warn">lying low until {lyingLow}</span> : `next: ${stepNext}`}</span>
        </div>
        <div class="tile">
          <dt>Storage</dt>
          <dd>
            {usedGb} of {capacity} GB
          </dd>
          <span class={`meter${usedGb > capacity ? ' meter--over' : ''}`} aria-hidden="true">
            <span class="meter__fill" style={{ width: `${Math.min(100, (usedGb / capacity) * 100)}%` }} />
          </span>
        </div>
        <div class="tile">
          <dt>Model</dt>
          <dd>{model || <span class="row__dim">none</span>}</dd>
        </div>
      </dl>
      <h3 class="map__heading tiles__heading">
        Hardware
        <span class="heading__note data readout__build">
          build {__APP_VERSION__} · {__APP_COMMIT__}
        </span>
      </h3>
      <ul class="parts">
        {parts.split('\n').map((line) => {
          const [label, name] = line.split('\t');
          return (
            <li key={label} class={`parts__item${name === 'empty' ? ' is-empty' : ''}`}>
              <span class="parts__slot">{label}</span>
              <span class="parts__name">{name}</span>
            </li>
          );
        })}
      </ul>
    </Window>
  );
}
