import { activeContract, objectiveMet, stageIndex, stagesOf } from '../../core';
import { findServer } from '../../core/content';
import { useWorld } from '../hooks';
import { content, session } from '../session';
import { activeConnection, deskStore, useDesk } from './deskStore';
import { lit, useGuide } from './guide';
import { GuideCard } from './GuideCard';
import { useLayout } from './layout';
import { windows } from './windowStore';
import { useDockDesign } from './dockStore';

/**
 * Top bar: one tab per connected server (each is its own connection),
 * a + to open another, and the active contract on the right. Pressing
 * the contract drops its goal and steps down (ContractPanel).
 */
export function TopBar() {
  const guide = useGuide();
  const onDesk = useLayout() === 'desk';
  const desk = useDesk();
  const game = useWorld((state) => state);
  const active = activeConnection(game, desk);
  const contract = activeContract(game, content);
  const done = contract !== undefined && objectiveMet(game, content, contract);
  const steps = contract ? stagesOf(contract) : [];
  // A docked design keeps the contract on show in its side column, so the bar has no button for it.
  const docked = useDockDesign() !== null;

  return (
    <header class="tabbar">
      {game.connections.length === 0 && <span class="tabbar__hint">No connections</span>}
      {game.connections.map((connection) => {
        const name = findServer(content, connection.serverId)?.name ?? connection.serverId;
        const isActive = connection.id === active?.id;
        const traced = connection.trace.status === 'active';
        return (
          <div key={connection.id} class={`tab${isActive ? ' is-active' : ''}${traced ? ' is-traced' : ''}`}>
            <button
              type="button"
              class="tab__main"
              aria-pressed={isActive}
              data-tip="Show this connection in the Server window"
              onClick={() => {
                deskStore.activate(connection.id);
                windows.focus('server');
              }}
            >
              <span class="tab__dot" aria-hidden="true" />
              {name}
              {traced && <span class="visually-hidden"> (being traced)</span>}
            </button>
            <button
              type="button"
              class={`tab__close${lit(guide, ['leave-board', 'leave-target'])}`}
              aria-label={`Disconnect from ${name}`}
              data-tip="Disconnect"
              onClick={() => session.dispatch({ type: 'disconnect', connectionId: connection.id })}
            >
              ×
            </button>
          </div>
        );
      })}
      <button class="tabbar__add" type="button" aria-label="New connection" data-tip="Open another connection from the Route map" onClick={() => windows.focus('map')}>
        +
      </button>
      {onDesk && <GuideCard bar />}
      {docked ? null : contract ? (
        <button
          type="button"
          class={`tabbar__contract tabbar__contract--live${done ? ' is-done' : ''}${desk.contractOpen ? ' is-open' : ''}${lit(guide, 'deliver')}`}
          data-tour="contract"
          data-tip={desk.contractOpen ? 'Put your contract away' : 'Your contract. Press to see the goal and deliver.'}
          aria-expanded={desk.contractOpen}
          onClick={() => deskStore.showContract(!desk.contractOpen)}
        >
          <span class="tabbar__contract-label">{done ? 'Ready to deliver' : steps.length > 1 ? `Contract · step ${stageIndex(game, contract) + 1} of ${steps.length}` : 'Contract'}</span>
          <span class="tabbar__contract-name">{contract.title}</span>
          <span class="tabbar__contract-chevron" aria-hidden="true" />
        </button>
      ) : (
        <span class="tabbar__contract" data-tour="contract" data-tip="Take a job from the Contracts board at the Backroom.">
          No active contract
        </span>
      )}
    </header>
  );
}
