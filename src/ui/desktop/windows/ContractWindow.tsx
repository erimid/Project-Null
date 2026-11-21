import { activeContract, contractRisk, findModule, objectiveMet, objectivePossible, stageDeadline, stageIndex, stagesOf, stageView } from '../../../core';
import { findServer, type ContractDef } from '../../../core/content';
import { formatMoney } from '../../format';
import { useWorld } from '../../hooks';
import type { ComponentChildren } from 'preact';
import { content, session } from '../../session';
import { ConfirmButton } from '../ConfirmButton';
import { IconTile, ModulePlate } from '../Gear';
import { Icon, objectiveIcon } from '../Icon';
import { lit, useGuide } from '../guide';
import { Window } from '../Window';
import { windows } from '../windowStore';
import { OBJECTIVE_WORDS, Place, RiskMeter, showOnMap } from './Place';

/** What has to happen, in one line. */
function objectiveText(contract: ContractDef): string {
  const target = findServer(content, contract.targetId)?.name ?? contract.targetId;
  const goal = contract.objective;
  switch (goal.kind) {
    case 'steal':
      return findServer(content, contract.targetId)?.files.find((file) => file.name === goal.file)?.encrypted
        ? `Copy ${goal.file} from ${target} to your gateway and decrypt it.`
        : `Copy ${goal.file} from ${target} to your gateway.`;
    case 'destroy':
      return `Delete ${goal.file} on ${target}.`;
    case 'record':
      return `In ${target}'s records, set ${goal.column} to "${goal.value}" for ${goal.key}.`;
    case 'read':
      return `Open and read ${goal.file} on ${target}.`;
    case 'plant':
      return `Put ${goal.file} onto ${target}.`;
    case 'frame':
      return `On ${target}, leave a false trail pointing at ${goal.who}, and clear your own.`;
  }
}

/** Text with every server the player knows by name turned into a link to the map. */
function WithPlaces({ text, known }: { text: string; known: readonly string[] }) {
  const places = known
    .map((id) => findServer(content, id))
    .filter((server): server is NonNullable<typeof server> => !!server && server.kind !== 'gateway' && server.name.length >= 4)
    .sort((a, b) => b.name.length - a.name.length);
  const parts: ComponentChildren[] = [];
  let rest = text;
  while (rest.length > 0) {
    let first: { at: number; id: string; name: string } | undefined;
    for (const server of places) {
      const at = rest.indexOf(server.name);
      if (at >= 0 && (!first || at < first.at)) first = { at, id: server.id, name: server.name };
    }
    if (!first) break;
    if (first.at > 0) parts.push(rest.slice(0, first.at));
    parts.push(
      <Place key={parts.length} id={first.id}>
        {first.name}
      </Place>,
    );
    rest = rest.slice(first.at + first.name.length);
  }
  if (rest) parts.push(rest);
  return <>{parts}</>;
}

/** The contract being worked on: the brief, whether it is done, and the Deliver button. */
export function ContractWindow() {
  const guide = useGuide();
  const game = useWorld((state) => state);
  const contract = activeContract(game, content);

  if (!contract) {
    return (
      <Window id="contract" note="none">
        <p class="empty">You have no contract. Connect to The Backroom and look at Contracts.</p>
      </Window>
    );
  }

  // Once the contract is handed in or given up there is nothing left to show.
  const finish = (action: { type: 'abandonContract' } | { type: 'deliverContract'; choiceId?: string }) => {
    if (session.dispatch(action).ok) windows.close('contract');
  };
  const steps = stagesOf(contract);
  const current = stageIndex(game, contract);
  const stage = stageView(game, contract);
  const done = objectiveMet(game, content, contract);
  const possible = objectivePossible(game, content, contract);
  const target = findServer(content, stage.targetId);
  const goal = stage.objective;
  const part = contract.part && findModule(content, contract.part.id);
  // The target can always be opened, even before it is in the address book list.
  const places = [...new Set([stage.targetId, ...steps.map((step) => step.targetId), ...game.knownServers])];
  const sealed = goal.kind === 'steal' && game.player.files.some((file) => file.name === goal.file && file.encrypted);
  const deadlineMs = stageDeadline(game, contract);
  const minutesLeft = deadlineMs === undefined ? undefined : Math.max(0, Math.round((deadlineMs - game.clock.gameTimeMs) / 60_000));
  // The brief for the step being worked on: the stage's own, or the contract's for the first.
  const brief = current === 0 ? contract.brief : steps[current]!.brief ?? contract.brief;

  return (
    <Window id="contract" note={done ? 'ready to deliver' : steps.length > 1 ? `step ${current + 1} of ${steps.length}` : 'in progress'}>
      <header class={`jobhead${contract.story ? ' is-story' : ''}`}>
        <div class="jobhead__top">
          <IconTile icon={contract.story ? 'star' : objectiveIcon(goal.kind)} size="lg" tone={contract.story ? 'rare' : undefined} />
          <div class="jobhead__main">
            <h3 class="contract__title">{contract.title}</h3>
            <span class="jobhead__client">
              <Icon name="person" size={14} /> {contract.client}
              <span class="jobhead__kind">
                <Icon name={objectiveIcon(goal.kind)} size={14} /> {OBJECTIVE_WORDS[goal.kind]}
              </span>
            </span>
          </div>
          <div class="jobhead__reward">
            <span class="data jobhead__pay">{formatMoney(contract.pay)}</span>
            {contract.rating > 0 && (
              <span class="contract__rating">
                +<span class="data">{contract.rating}</span> rating
              </span>
            )}
            {part && contract.part && <ModulePlate module={part} grade={contract.part.grade} />}
          </div>
        </div>
        <div class="jobhead__target">
          <Icon name="pin" size={18} />
          <div class="jobhead__place">
            <span class="jobhead__label">Target</span>
            <strong>{target ? <Place id={target.id}>{target.name}</Place> : stage.targetId}</strong>
            {target && (
              <span class="jobhead__where">
                <span class="data">{target.address}</span> · {target.city}
              </span>
            )}
          </div>
          <RiskMeter risk={contractRisk(game, content, contract)} />
          {target && (
            <button type="button" class="btn jobhead__map" data-tip="Open the route map with this server picked" onClick={() => showOnMap(target.id)}>
              <Icon name="route" size={16} /> Show on map
            </button>
          )}
        </div>
      </header>
      {steps.length > 1 && (
        <ol class="contract__steps" aria-label={`Step ${current + 1} of ${steps.length}`}>
          {steps.map((step, index) => {
            const state = index < current || (index === current && done) ? 'done' : index === current ? 'now' : 'next';
            return (
              <li key={index} class={`contract__step is-${state}`} aria-current={state === 'now' ? 'step' : undefined}>
                <span class="contract__step-node" aria-hidden="true">{state === 'done' ? '✓' : index + 1}</span>
                <span class="contract__step-text">
                  <span class="contract__step-label">
                    {state === 'done' ? 'Done' : state === 'now' ? 'Now' : 'Next'}
                  </span>
                  <span>
                    <WithPlaces text={objectiveText({ ...contract, targetId: step.targetId, objective: step.objective })} known={places} />
                  </span>
                </span>
              </li>
            );
          })}
        </ol>
      )}
      <div class="contract__brief">
        {brief.split('\n\n').map((paragraph, index) => (
          <p key={index}>
            <WithPlaces text={paragraph} known={places} />
          </p>
        ))}
      </div>
      {steps.length === 1 && (
        <p class={`objective${done ? ' is-done' : ''}`}>
          <span class="objective__mark" aria-hidden="true">{done ? '✓' : '○'}</span>
          <span>
            <WithPlaces text={objectiveText(stage)} known={places} />
            <span class="visually-hidden">{done ? ' Done.' : ' Not done yet.'}</span>
          </span>
        </p>
      )}
      {minutesLeft !== undefined && !done && (
        <p class="board__warning">This step must be finished within <span class="data">{minutesLeft}</span> game {minutesLeft === 1 ? 'minute' : 'minutes'}.</p>
      )}
      {sealed && <p class="board__warning">You have the file, but it is still encrypted. Run a Decrypter on it from Programs.</p>}
      {!possible && <p class="board__warning">This can no longer be done. Give the contract up.</p>}
      <div class="contract__actions">
        <ConfirmButton class="btn btn--danger" confirmLabel="Really give up?" tip="Drop this job. You are not paid for it." onConfirm={() => finish({ type: 'abandonContract' })}>
          Give up
        </ConfirmButton>
        <button
          type="button"
          class={`btn btn--go${lit(guide, 'deliver')}`}
          disabled={!done}
          title={done ? undefined : 'The goal is not done yet'}
          data-tip="Hand the job in and get paid the usual way"
          onClick={() => finish({ type: 'deliverContract' })}
        >
          Deliver{contract.choices && contract.choices.length > 0 ? ` for ${formatMoney(contract.pay)}` : ''}
        </button>
        {done &&
          (contract.choices ?? []).map((choice) => (
            <button
              key={choice.id}
              type="button"
              class="btn"
              data-tip={choice.note}
              onClick={() => finish({ type: 'deliverContract', choiceId: choice.id })}
            >
              {choice.label} ({formatMoney(choice.pay)})
            </button>
          ))}
      </div>
    </Window>
  );
}
