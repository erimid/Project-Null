import { findRival, findServer, raidPortAngle, raidReport, raidSetbackMs, ringTolerance, type GameState, type RaidState } from '../../../core';
import { useGame, useWorld } from '../../hooks';
import { content, session } from '../../session';
import { ConfirmButton } from '../ConfirmButton';
import { Window } from '../Window';

const DIAL = 240;
const CENTRE = DIAL / 2;
const RING_INNER = 44;
const RING_GAP = 20;

const act = (action: Parameters<typeof session.dispatch>[0]) => session.dispatch(action);

/** The attacker's bounce chain, nearest you last, with how far the counter-trace has got. */
function TraceRoute({ raid }: { raid: RaidState }) {
  const traced = raid.traceBack ? raidReport(raid).trace ?? 0 : 0;
  const steps = raid.route.length;
  const done = Math.floor(traced * steps);
  const home = findServer(content, findRival(content, raid.attackerId)?.homeId ?? '');
  const hops = [...raid.route.map((id) => findServer(content, id)?.name ?? id), home?.name ?? 'their server'];
  return (
    <ol class="raid__route">
      {hops.map((name, index) => (
        <li key={index} class={`raid__hop${raid.traceBack && index < done ? ' is-traced' : ''}${index === hops.length - 1 ? ' is-home' : ''}`}>
          <span class="objective__mark" aria-hidden="true">{raid.traceBack && index < done ? '✓' : '○'}</span>
          {name}
        </li>
      ))}
    </ol>
  );
}

/** The attacker's port line-up: rings turn, click each as its gap crosses the marker to lock it. */
function PortDial({ frameAngles }: { frameAngles: string }) {
  const angles = frameAngles.split(',');
  const tolerance = ringTolerance(session.getState(), content);
  const point = (radius: number, degrees: number) => {
    const radians = ((degrees - 90) * Math.PI) / 180;
    return { x: CENTRE + radius * Math.cos(radians), y: CENTRE + radius * Math.sin(radians) };
  };
  const outer = RING_INNER + (angles.length - 1) * RING_GAP + RING_GAP / 2 + 3;
  const left = point(outer, -tolerance);
  const right = point(outer, tolerance);
  return (
    <svg class="lineup__dial" viewBox={`0 0 ${DIAL} ${DIAL}`} role="group" aria-label="Attacker's port line-up">
      <path d={`M${CENTRE} ${CENTRE}L${left.x} ${left.y}A${outer} ${outer} 0 0 1 ${right.x} ${right.y}Z`} class="lineup__window" />
      <path d={`M${CENTRE - 6} ${CENTRE - outer - 12}h12l-6 9z`} class="lineup__marker" />
      {angles.map((angle, ring) => {
        const radius = RING_INNER + ring * RING_GAP;
        const locked = angle === 'L';
        const port = point(radius, locked ? 0 : Number(angle));
        return (
          <g
            key={ring}
            class={`lineup__ring${locked ? ' is-locked' : ''}`}
            role="button"
            tabIndex={locked ? -1 : 0}
            aria-label={`Ring ${ring + 1}${locked ? ', locked' : ''}`}
            aria-disabled={locked}
            onPointerDown={() => !locked && act({ type: 'defendRing', ring })}
            onKeyDown={(event: KeyboardEvent) => {
              if (!locked && (event.key === 'Enter' || event.key === ' ')) {
                event.preventDefault();
                act({ type: 'defendRing', ring });
              }
            }}
          >
            <circle cx={CENTRE} cy={CENTRE} r={radius} class="lineup__hit" />
            <circle cx={CENTRE} cy={CENTRE} r={radius} class="lineup__track" />
            <circle cx={port.x} cy={port.y} r={6.5} class="lineup__port" />
          </g>
        );
      })}
    </svg>
  );
}

/** Opens by itself under attack: close ports, trace the intruder back, lock what matters, or pull the plug. */
export function DefenceWindow() {
  // One text per frame, so the meters and the rings redraw as the attack runs.
  const frame = useGame((game: GameState) => {
    const raid = game.raid;
    if (!raid) return '';
    const report = raidReport(raid);
    const port = raid.port ? raid.port.locked.map((locked, ring) => (locked ? 'L' : raidPortAngle(raid.port!, ring).toFixed(1))).join(',') : '';
    return [
      raid.attackerId,
      report.barrier,
      Math.round(report.breach * 100),
      Math.ceil(report.breachRemainingMs / 1000),
      report.trace === null ? '' : Math.round(report.trace * 100),
      Math.ceil(report.traceRemainingMs / 1000),
      port,
      raid.locked.join(','),
    ].join('|');
  });
  const raidObj = useWorld((game) => game.raid);
  const lockables = useWorld((game) =>
    [
      ...game.player.files.map((file) => file.name),
      ...game.player.programs.filter((id) => !content.startingPrograms.includes(id)),
    ].join('\n'),
  );

  if (!frame || !raidObj) {
    return (
      <Window id="defence" note="quiet">
        <p class="empty">No one is attacking your gateway. If that changes, this window opens by itself.</p>
      </Window>
    );
  }

  const [attackerId = '', barrier = '0', breach = '0', breachLeft = '0', trace = '', traceLeft = '0', port = '', lockedText = ''] =
    frame.split('|');
  const rival = findRival(content, attackerId);
  const barriers = raidObj.barriers;
  const locked = lockedText ? lockedText.split(',') : [];
  const items = lockables ? lockables.split('\n').filter(Boolean) : [];
  const canLock = locked.length < content.rules.raidMaxLocks;
  const tracing = trace !== '';

  return (
    <Window id="defence" title="Defence — intrusion" note={rival?.handle ?? 'intruder'}>
      <p class="raid__who">
        <strong>{rival?.handle ?? 'Someone'}</strong> is on your gateway. {rival?.blurb}
      </p>

      <div class="raid__gauges">
        <div class="raid__gauge">
          <div class="row__between">
            <span>Break-in · barrier {Number(barrier) + 1} of {barriers}</span>
            <span class="data">{breachLeft}s</span>
          </div>
          <span class="meter meter--over" aria-hidden="true">
            <span class="meter__fill" style={{ width: `${breach}%` }} />
          </span>
        </div>
        <div class="raid__gauge">
          <div class="row__between">
            <span>{tracing ? 'Your trace back' : 'Trace not started'}</span>
            {tracing && <span class="data">{traceLeft}s</span>}
          </div>
          <span class="meter meter--mint" aria-hidden="true">
            <span class="meter__fill" style={{ width: `${tracing ? trace : 0}%` }} />
          </span>
        </div>
      </div>

      {port ? (
        <div class="lineup lineup--raid">
          <PortDial frameAngles={port} />
          <p class="lineup__status data">Lock every ring to shut this port and set them back {Math.round(raidSetbackMs(raidObj, content) / 1000)}s.</p>
        </div>
      ) : (
        <TraceRoute raid={raidObj} />
      )}

      <div class="contract__actions raid__actions">
        <button type="button" class="btn" disabled={!!port} data-tip="A line-up like a firewall bypass. Lock every ring to set the intruder back. Each port you shut buys less time than the last." onClick={() => act({ type: 'defendPort' })}>
          Close a port
        </button>
        <button type="button" class="btn btn--go" disabled={tracing} data-tip="Follow their route home. Finish before they break in and their server is yours." onClick={() => act({ type: 'traceBack' })}>
          {tracing ? 'Tracing…' : 'Trace back'}
        </button>
        <ConfirmButton class="btn btn--danger" confirmLabel="Pull the plug?" tip="Ends it at once. Drops your connections. Nothing lost, nothing learned." onConfirm={() => act({ type: 'pullPlug' })}>
          Pull the plug
        </ConfirmButton>
      </div>

      <h3 class="map__heading">Lock what you cannot lose</h3>
      <p class="row__dim">Up to {content.rules.raidMaxLocks}. A locked file or program is safe if they break in.</p>
      <ul class="raid__locks">
        {items.length === 0 && <li class="row__dim">Nothing on your gateway to lock.</li>}
        {items.map((name) => {
          const isLocked = locked.includes(name);
          return (
            <li key={name} class={`raid__lock${isLocked ? ' is-locked' : ''}`}>
              <span class="raid__lock-name">{name}</span>
              {isLocked ? (
                <span class="data">locked</span>
              ) : (
                <button type="button" class="btn btn--small" disabled={!canLock} onClick={() => act({ type: 'lockFile', name })}>
                  Lock
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </Window>
  );
}
