import { activeContract, guardRingAngle, guardSetbackMs, holdNeedMs, readFlag, stageView } from '../../../core';
import { findServer } from '../../../core/content';
import { content, session } from '../../session';
import { PortDial } from './DefenceWindow';
import type { View } from './serverView';

/**
 * The part of the Server window for the newer kinds of job: how long the
 * player has held on (stay in, guard), the intruder's progress and the port
 * line-up on a guard job, and what a swap or a hunt wants done here.
 */
export function JobWatch({ game, connection }: View) {
  const active = activeContract(game, content);
  const stage = active ? stageView(game, active) : undefined;
  if (!stage) return null;
  const goal = stage.objective;
  if (goal.kind === 'hunt') {
    const chain = [stage.targetId, ...goal.trail];
    const here = chain.indexOf(connection.serverId);
    if (here < 0) return null;
    if (here === chain.length - 1) return <p class="watch watch__hint">This is where the trail ends. You found them: deliver the job.</p>;
    const next = findServer(content, chain[here + 1]!);
    return (
      <p class="watch watch__hint">
        {next && game.knownServers.includes(next.id)
          ? `The trail leads on to ${next.name}. Connect to it.`
          : connection.role === 'admin'
            ? 'Open Logs. One line points at the next server on the trail: press Follow beside it.'
            : 'Log in as an administrator and read the log. One line points at the next server on the trail: follow it.'}
      </p>
    );
  }
  if (stage.targetId !== connection.serverId || connection.user === null) return null;

  if (goal.kind === 'hold' || goal.kind === 'guard') {
    const need = holdNeedMs(goal);
    const held = Math.min(1, game.contracts.heldMs / need);
    const left = Math.ceil((need - game.contracts.heldMs) / 1000);
    const done = held >= 1;
    const asAdmin = goal.kind === 'guard' && connection.role !== 'admin';
    const guard = goal.kind === 'guard' ? game.contracts.guard : null;
    const breach = guard ? Math.min(1, guard.breachMs / guard.totalMs) : 0;
    const breachLeft = guard ? Math.ceil((guard.totalMs - guard.breachMs) / 1000) : 0;
    const port = guard?.port ? guard.port.locked.map((locked, ring) => (locked ? 'L' : guardRingAngle(guard.port!, ring).toFixed(1))).join(',') : '';
    return (
      <div class="watch" role="group" aria-label={goal.kind === 'guard' ? 'Guarding the server' : 'Staying in'}>
        <div class="watch__gauge">
          <div class="row__between">
            <span class="watch__label">{done ? 'Held long enough' : asAdmin ? 'Log in as the administrator to guard' : goal.kind === 'guard' ? 'Hold out' : 'Stay logged in'}</span>
            <span class="watch__count data">{done ? 'done' : `${left}s`}</span>
          </div>
          <span class="meter meter--mint" aria-hidden="true">
            <span class="meter__fill" style={{ width: `${held * 100}%` }} />
          </span>
        </div>
        {goal.kind === 'guard' && !done && (
          <>
            <div class={`watch__gauge${breach > 0.8 ? ' is-urgent' : ''}`}>
              <div class="row__between">
                <span class="watch__label">{goal.rival ?? 'The intruder'} breaks in</span>
                <span class="watch__count data">{guard ? `${breachLeft}s` : 'waiting'}</span>
              </div>
              <span class="meter meter--over" aria-hidden="true">
                <span class="meter__fill" style={{ width: `${breach * 100}%` }} />
              </span>
            </div>
            <div class="contract__actions">
              <button
                type="button"
                class="btn btn--go"
                disabled={!guard || !!guard.port || asAdmin}
                data-tip="A line-up like a firewall bypass. Lock every ring to set the intruder back. Each port you shut buys less time than the last."
                onClick={() => session.dispatch({ type: 'guardPort' })}
              >
                Close a port {guard && <span class="data raid__gain">+{Math.round(guardSetbackMs(guard) / 1000)}s</span>}
              </button>
            </div>
            {port && (
              <div class="lineup lineup--raid">
                <PortDial frameAngles={port} label="Intruder's port line-up" onRing={(ring) => session.dispatch({ type: 'guardRing', ring })} />
                <p class="lineup__status data">Click each ring as its dot crosses the marker.</p>
              </div>
            )}
          </>
        )}
        {goal.kind === 'hold' && !done && <p class="watch__hint">The trace runs while you sit here. Leaving starts the count again.</p>}
      </div>
    );
  }

  if (goal.kind === 'leak') {
    const left = goal.files.filter((name) => !game.flags.includes(readFlag(connection.serverId, name)));
    return (
      <p class="watch watch__hint">
        <span>
          {left.length === 0 ? (
            'You have read every note. Name the leak on the contract.'
          ) : (
            <>
              Still to read here: <span class="data">{left.join(', ')}</span>. Open each one from Files.
            </>
          )}
        </span>
      </p>
    );
  }

  if (goal.kind === 'wipe') {
    const left = game.servers[connection.serverId]?.logs.filter((entry) => entry.left === goal.who).length ?? 0;
    return (
      <p class="watch watch__hint">
        <span>
          {left === 0
            ? `Nothing of ${goal.who}'s is left in this log.`
            : `${left} ${left === 1 ? 'line' : 'lines'} in the log ${left === 1 ? 'names' : 'name'} ${goal.who}. Open Logs, pick ${left === 1 ? 'it' : 'them'} and delete ${left === 1 ? 'it' : 'them'}.`}
        </span>
      </p>
    );
  }

  if (goal.kind === 'swap') {
    const swapped = game.servers[connection.serverId]?.files.some((file) => file.name === goal.file && file.doctored);
    return (
      <p class="watch watch__hint">
        <span>{swapped ? 'The copy is in place.' : <>Delete <span class="data">{goal.file}</span> here, then upload the client's copy from your gateway in its place.</>}</span>
      </p>
    );
  }

  return null;
}
