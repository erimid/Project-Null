import { findProgram, findRival, findServer, holdOffMs, untraceable, raidPortAngle, raidReport, raidSetbackMs, ringTolerance, type GameState, type RaidState } from '../../../core';
import { useGame, useWorld } from '../../hooks';
import { content, session } from '../../session';
import { ConfirmButton } from '../ConfirmButton';
import { Window } from '../Window';

const DIAL = 240;
const CENTRE = DIAL / 2;
const RING_INNER = 44;
const RING_GAP = 20;

const act = (action: Parameters<typeof session.dispatch>[0]) => session.dispatch(action);

/** What each kind of intruder is after, for the tag beside their handle. */
const AFTER: Record<string, string> = { thief: 'after your credits', vandal: 'here to wipe files', framer: 'here to frame you' };

/** The attacker's bounce chain, nearest you last, with how far the counter-trace has got. */
function TraceRoute({ raid }: { raid: RaidState }) {
  const traced = raid.traceBack ? raidReport(raid).trace ?? 0 : 0;
  const steps = raid.route.length;
  const done = Math.floor(traced * steps);
  const home = findServer(content, findRival(content, raid.attackerId)?.homeId ?? '');
  const hops = [...raid.route.map((id) => findServer(content, id)?.name ?? id), home?.name ?? 'their server'];
  return (
    <ol class={`raid__route${raid.traceBack ? ' is-running' : ''}`} aria-label="The intruder's route">
      {hops.map((name, index) => {
        const isTraced = !!raid.traceBack && index < done;
        const isNow = !!raid.traceBack && index === done;
        const isHome = index === hops.length - 1;
        return (
          <li key={index} class={`raid__hop${isTraced ? ' is-traced' : ''}${isNow ? ' is-now' : ''}${isHome ? ' is-home' : ''}`}>
            <span class="raid__node" aria-hidden="true">{isTraced ? '✓' : ''}</span>
            <span class="raid__hop-name">{isHome && !isTraced ? (raid.traceBack ? 'their server' : 'their server, unknown') : name}</span>
            {isNow && <span class="raid__hop-note data">tracing</span>}
          </li>
        );
      })}
    </ol>
  );
}

/** The attacker's port line-up: rings turn, click each as its gap crosses the marker to lock it. Also used on guard jobs. */
export function PortDial({ frameAngles, onRing = (ring) => act({ type: 'defendRing', ring }), label = "Attacker's port line-up" }: { frameAngles: string; onRing?: (ring: number) => void; label?: string }) {
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
    <svg class="lineup__dial" viewBox={`0 0 ${DIAL} ${DIAL}`} role="group" aria-label={label}>
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
            onPointerDown={() => !locked && onRing(ring)}
            onKeyDown={(event: KeyboardEvent) => {
              if (!locked && (event.key === 'Enter' || event.key === ' ')) {
                event.preventDefault();
                onRing(ring);
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
      Math.round(report.breach * 1000),
      Math.ceil(report.breachRemainingMs / 1000),
      report.trace === null ? '' : Math.round(report.trace * 100),
      Math.ceil(report.traceRemainingMs / 1000),
      port,
      raid.locked.join(','),
      untraceable(raid) ? Math.ceil((holdOffMs(game, content) ?? 0) / 1000) : '',
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

  const [attackerId = '', barrier = '0', breach = '0', breachLeft = '0', trace = '', traceLeft = '0', port = '', lockedText = '', holdLeft = ''] =
    frame.split('|');
  const rival = findRival(content, attackerId);
  const barriers = raidObj.barriers;
  const locked = lockedText ? lockedText.split(',') : [];
  const items = lockables ? lockables.split('\n').filter(Boolean) : [];
  const canLock = locked.length < content.rules.raidMaxLocks;
  const tracing = trace !== '';
  // Chorus has no route to trace: the player holds it off until it gives up.
  const holding = holdLeft !== '';
  const shut = raidObj.shut ?? 0;
  const lead = Number(breachLeft) - Number(traceLeft);
  const urgent = Number(breachLeft) <= 15;
  // Chorus is not a hacker and does not look like one: it says what it has come for.
  const chorus = content.chorus && rival?.handle === content.chorus.rival.handle ? content.chorus : undefined;
  const wanted = new Set(chorus?.rival.targets ?? []);
  // What it wants comes first in the list.
  const ordered = [...items.filter((name) => wanted.has(name)), ...items.filter((name) => !wanted.has(name))];
  // How full each barrier's block is: the ones behind the intruder are gone, the one in front is going.
  const through = (Number(breach) / 1000) * barriers;

  return (
    <Window id="defence" title="Defence" note={chorus ? 'something is knocking' : 'under attack'}>
      <div class="raid__who">
        <span class="raid__badge" aria-hidden="true">{chorus ? '∴' : '!'}</span>
        <div>
          <p class="raid__name">
            <strong>{rival?.handle ?? 'Someone'}</strong>
            {rival && <span class="row__tag row__tag--danger">{chorus ? 'here to help' : AFTER[rival.style] ?? 'intruder'}</span>}
          </p>
          <p class="raid__blurb">{rival?.blurb ?? 'Someone is on your gateway.'}</p>
        </div>
      </div>

      <div class="raid__gauges">
        <div class={`raid__gauge raid__gauge--breach${urgent ? ' is-urgent' : ''}`}>
          <div class="row__between">
            <span class="raid__label">{chorus ? 'It gets in' : 'They break in'}</span>
            <span class="raid__count data">{breachLeft}s</span>
          </div>
          <div class="raid__barriers" key={shut} role="img" aria-label={`Barrier ${Number(barrier) + 1} of ${barriers}`}>
            {Array.from({ length: barriers }, (_, index) => {
              const fill = Math.max(0, Math.min(1, through - index));
              return (
                <span key={index} class={`raid__barrier${fill >= 1 ? ' is-down' : fill > 0 ? ' is-going' : ''}`}>
                  <span class="raid__barrier-fill" style={{ width: `${fill * 100}%` }} />
                  <span class="raid__barrier-name">{fill >= 1 ? 'down' : `barrier ${index + 1}`}</span>
                </span>
              );
            })}
          </div>
        </div>
        {holding ? (
          <>
            <div class="raid__gauge raid__gauge--trace is-on">
              <div class="row__between">
                <span class="raid__label">It gives up</span>
                <span class="raid__count data">{holdLeft}s</span>
              </div>
              <span class="meter meter--mint" aria-hidden="true">
                <span class="meter__fill" style={{ width: `${Math.max(0, 100 - (Number(holdLeft) / (content.chorus?.rival.holdSeconds ?? 1)) * 100)}%` }} />
              </span>
            </div>
            <p class={`raid__race${Number(breachLeft) >= Number(holdLeft) ? ' is-ahead' : ' is-behind'}`} role="status">
              There is no one at the other end to trace. Keep it out until it gives up, or pull the plug.
            </p>
          </>
        ) : (
        <>
        <div class={`raid__gauge raid__gauge--trace${tracing ? ' is-on' : ''}`}>
          <div class="row__between">
            <span class="raid__label">{tracing ? 'Your trace reaches them' : 'Your trace back'}</span>
            <span class="raid__count data">{tracing ? `${traceLeft}s` : 'not started'}</span>
          </div>
          <span class="meter meter--mint" aria-hidden="true">
            <span class="meter__fill" style={{ width: `${tracing ? trace : 0}%` }} />
          </span>
        </div>
        <p class={`raid__race${!tracing ? '' : lead >= 0 ? ' is-ahead' : ' is-behind'}`} role="status">
          {!tracing
            ? 'Start the trace. It is the only way to win this.'
            : lead >= 0
              ? <>You are ahead by <span class="data">{lead}s</span>. Hold on.</>
              : <>You are behind by <span class="data">{-lead}s</span>. Shut a port to buy time.</>}
        </p>
        </>
        )}
      </div>

      <div class="contract__actions raid__actions">
        {!holding && <button type="button" class="btn btn--go" disabled={tracing} data-tip="Follow their route home. Finish before they break in and their server is yours." onClick={() => act({ type: 'traceBack' })}>
          {tracing ? 'Tracing…' : 'Trace back'}
        </button>}
        <button type="button" class="btn" disabled={!!port} data-tip="A line-up like a firewall bypass. Lock every ring to set the intruder back. Each port you shut buys less time than the last." onClick={() => act({ type: 'defendPort' })}>
          Close a port <span class="data raid__gain">+{Math.round(raidSetbackMs(raidObj, content) / 1000)}s</span>
        </button>
        <ConfirmButton class="btn btn--danger" confirmLabel="Pull the plug?" tip="Ends it at once. Drops your connections. Nothing lost, nothing learned." onConfirm={() => act({ type: 'pullPlug' })}>
          Pull the plug
        </ConfirmButton>
      </div>
      {port ? (
        <div class="lineup lineup--raid">
          <PortDial frameAngles={port} />
          <p class="lineup__status data">Click each ring as its dot crosses the marker. All locked sets {chorus ? 'it' : 'them'} back {Math.round(raidSetbackMs(raidObj, content) / 1000)}s.</p>
        </div>
      ) : holding ? (
        <p class="raid__blurb">No route, no home, no handle. Only the knocking.</p>
      ) : (
        <TraceRoute raid={raidObj} />
      )}

      {shut > 0 && (
        <p class="raid__shut" key={shut}>
          {shut === 1 ? '1 port shut.' : `${shut} ports shut.`} {chorus ? 'It is' : 'They are'} learning: each one buys less.
        </p>
      )}

      <h3 class="map__heading">
        Lock what you cannot lose <span class="heading__note data">{locked.length} of {content.rules.raidMaxLocks}</span>
      </h3>
      <p class="row__dim">{chorus ? 'It takes one thing it thinks is hurting you. A locked file or program is safe.' : 'A locked file or program is safe if they break in.'}</p>
      <ul class="raid__locks">
        {items.length === 0 && <li class="row__dim">Nothing on your gateway to lock.</li>}
        {ordered.map((name) => {
          const isLocked = locked.includes(name);
          const program = findProgram(content, name, session.getState());
          return (
            <li key={name} class={`raid__lock${isLocked ? ' is-locked' : ''}${wanted.has(name) ? ' is-wanted' : ''}`}>
              <span class={`raid__lock-name${program ? '' : ' data'}`}>{program?.name ?? name}</span>
              {wanted.has(name) && !isLocked && <span class="row__tag row__tag--danger raid__want">it wants this</span>}
              {isLocked ? (
                <span class="raid__lock-done">locked</span>
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
