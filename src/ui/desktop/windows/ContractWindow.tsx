import { activeContract, objectiveMet, objectivePossible } from '../../../core';
import { findServer, type ContractDef } from '../../../core/content';
import { formatMoney } from '../../format';
import { useWorld } from '../../hooks';
import { content, session } from '../../session';
import { ConfirmButton } from '../ConfirmButton';
import { Window } from '../Window';
import { windows } from '../windowStore';

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
  }
}

/** The contract being worked on: the brief, whether it is done, and the Deliver button. */
export function ContractWindow() {
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
  const finish = (action: { type: 'abandonContract' } | { type: 'deliverContract' }) => {
    if (session.dispatch(action).ok) windows.close('contract');
  };
  const done = objectiveMet(game, content, contract);
  const possible = objectivePossible(game, content, contract);
  const target = findServer(content, contract.targetId);
  const goal = contract.objective;
  const sealed = goal.kind === 'steal' && game.player.files.some((file) => file.name === goal.file && file.encrypted);

  return (
    <Window id="contract" note={done ? 'ready to deliver' : 'in progress'}>
      <h3 class="contract__title">{contract.title}</h3>
      <dl class="readout">
        <dt>client</dt>
        <dd>{contract.client}</dd>
        <dt>target</dt>
        <dd>
          {target?.name} <span class="data row__dim">{target?.address}</span>
        </dd>
        <dt>pays</dt>
        <dd>
          <span class="data">{formatMoney(contract.pay)}</span>{' '}
          <span class="contract__rating">
            +<span class="data">{contract.rating}</span> rating
          </span>
        </dd>
      </dl>
      <div class="contract__brief">
        {contract.brief.split('\n\n').map((paragraph, index) => (
          <p key={index}>{paragraph}</p>
        ))}
      </div>
      <p class={`objective${done ? ' is-done' : ''}`}>
        <span class="objective__mark" aria-hidden="true">
          {done ? '✓' : '○'}
        </span>
        <span>
          {objectiveText(contract)}
          <span class="visually-hidden">{done ? ' Done.' : ' Not done yet.'}</span>
        </span>
      </p>
      {sealed && <p class="board__warning">You have the file, but it is still encrypted. Run a Decrypter on it from Programs.</p>}
      {!possible && <p class="board__warning">This can no longer be done. Give the contract up.</p>}
      <div class="contract__actions">
        <ConfirmButton class="btn btn--danger" confirmLabel="Really give up?" onConfirm={() => finish({ type: 'abandonContract' })}>
          Give up
        </ConfirmButton>
        <button type="button" class="btn btn--go" disabled={!done} onClick={() => finish({ type: 'deliverContract' })}>
          Deliver
        </button>
      </div>
    </Window>
  );
}
