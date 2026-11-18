import { findServer } from '../../core/content';
import { useWorld } from '../hooks';
import { content, session } from '../session';
import { activeConnection, deskStore, useDesk } from './deskStore';
import { windows } from './windowStore';

/**
 * Top bar: one tab per connected server (each is its own connection),
 * a + to open another, and the active contract on the right.
 */
export function TopBar() {
  const desk = useDesk();
  const game = useWorld((state) => state);
  const active = activeConnection(game, desk);

  return (
    <header class="tabbar">
      {game.connections.length === 0 && <span class="tabbar__hint">No connections</span>}
      {game.connections.map((connection) => {
        const name = findServer(content, connection.serverId)?.name ?? connection.serverId;
        const isActive = connection.id === active?.id;
        return (
          <div key={connection.id} class={`tab${isActive ? ' is-active' : ''}`}>
            <button
              type="button"
              class="tab__main"
              aria-pressed={isActive}
              onClick={() => {
                deskStore.activate(connection.id);
                windows.focus('server');
              }}
            >
              <span class="tab__dot" aria-hidden="true" />
              {name}
            </button>
            <button
              type="button"
              class="tab__close"
              aria-label={`Disconnect from ${name}`}
              onClick={() => session.dispatch({ type: 'disconnect', connectionId: connection.id })}
            >
              ×
            </button>
          </div>
        );
      })}
      <button class="tabbar__add" type="button" aria-label="New connection" onClick={() => windows.focus('map')}>
        +
      </button>
      <span class="tabbar__contract">No active contract</span>
    </header>
  );
}
