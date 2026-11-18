import { useEffect, useState } from 'preact/hooks';
import {
  usedStorageGq,
  activeContract,
  availableContracts,
  canLogIn,
  isLyingLow,
  ownedProgram,
  ringAngle,
  type Action,
  type Connection,
  type EchoPuzzle,
  type GameState,
  type ServerState,
  type TaskTarget,
} from '../../../core';
import { findServer, type ServerDef } from '../../../core/content';
import { formatGameTime, formatMoney } from '../../format';
import { useGame, useWorld } from '../../hooks';
import { content, session } from '../../session';
import { activeConnection, deskStore, useDesk, type Section } from '../deskStore';
import { TaskProgress, findTask } from '../TaskProgress';
import { viewer } from '../viewerStore';
import { Window } from '../Window';
import { windows } from '../windowStore';

const SECTION_LABELS: Record<Section, string> = {
  contracts: 'Contracts',
  market: 'Market',
  files: 'Files',
  logs: 'Logs',
  records: 'Records',
  directory: 'Directory',
};

const KIND_LABELS: Record<ServerDef['kind'], string> = {
  gateway: 'Gateway',
  directory: 'Directory',
  board: 'Board',
  relay: 'Relay',
  company: 'Company',
};

/** Everything a section needs to show one connection. */
interface View {
  game: GameState;
  server: ServerDef;
  state: ServerState;
  connection: Connection;
  /** Starts a program on this connection; any refusal is shown at the bottom of the window. */
  run: (target: TaskTarget) => void;
  /** Does anything else on this connection, with refusals shown the same way. True if it worked. */
  act: (action: Action) => boolean;
}

/** Sections this login can open, in menu order. */
function sectionsFor(server: ServerDef, connection: Connection): Section[] {
  const admin = connection.role === 'admin';
  const sections: Section[] = [];
  if (server.kind === 'directory') sections.push('directory');
  if (server.kind === 'board') sections.push('contracts', 'market');
  sections.push('files');
  if (admin) sections.push('logs');
  if (admin && server.records) sections.push('records');
  return sections;
}

const GLYPHS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** A made-up password for show. Always the same for the same account. */
function fakePassword(seed: string): string {
  let hash = 2166136261;
  let out = '';
  for (let i = 0; i < 8; i++) {
    for (const char of seed) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    hash = Math.imul(hash ^ i, 16777619);
    out += GLYPHS[(hash >>> 0) % GLYPHS.length];
  }
  return out;
}

/** The password being worked out: found characters stay, the rest keep spinning. */
function Cracking({ taskId, secret }: { taskId: string; secret: string }) {
  const shown = useGame((game) => {
    const task = game.tasks.find((item) => item.id === taskId);
    if (!task) return secret;
    const found = Math.floor((secret.length * task.progressMs) / task.durationMs);
    const spin = Math.floor(task.progressMs / 70);
    return [...secret].map((char, i) => (i < found ? char : GLYPHS[(spin * 7 + i * 13) % GLYPHS.length])).join('');
  });
  const percent = useGame((game) => {
    const task = game.tasks.find((item) => item.id === taskId);
    return task ? Math.floor((100 * task.progressMs) / task.durationMs) : 100;
  });
  return (
    <span class="cracking" role="progressbar" aria-label="Breaking password" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
      <span class="data cracking__code" aria-hidden="true">
        {shown}
      </span>
      <span class="data row__dim">{percent}%</span>
    </span>
  );
}

function LoginScreen({ game, server, state, connection, run }: View) {
  const lastLogin = [...state.logs].reverse().find((entry) => entry.text.startsWith('login ') && !entry.byPlayer);

  return (
    <div class="login">
      <pre class="login__banner data">{server.banner.join('\n')}</pre>
      <dl class="readout data">
        <dt>host</dt>
        <dd>{server.hostname}</dd>
        <dt>address</dt>
        <dd>{server.address}</dd>
        {lastLogin && (
          <>
            <dt>last login</dt>
            <dd>
              {formatGameTime(lastLogin.timeMs)} · {lastLogin.text.replace(/^login /, '')}
            </dd>
          </>
        )}
      </dl>
      <h3 class="login__heading">Log in as</h3>
      <ul class="rows">
        {server.accounts.map((account) => {
          const open = canLogIn(game, server, account.user);
          const locked = account.role === 'admin' && server.security.password > 0;
          const task = findTask(game, connection, { kind: 'password', user: account.user });
          const secret = fakePassword(`${server.id}/${account.user}`);
          return (
            <li key={account.user} class="row row--account">
              <span class="data row__main">{account.user}</span>
              <span class="row__dim">
                {account.name}
                {locked && open && (
                  <>
                    {' · password '}
                    <span class="data cracking__code">{secret}</span>
                  </>
                )}
                {locked && !open && !task && ' · password needed'}
              </span>
              {open ? (
                <button
                  type="button"
                  class="btn btn--go"
                  onClick={() => session.dispatch({ type: 'login', connectionId: connection.id, user: account.user })}
                >
                  Log in
                </button>
              ) : task ? (
                <Cracking taskId={task.id} secret={secret} />
              ) : (
                <button type="button" class="btn" onClick={() => run({ kind: 'password', user: account.user })}>
                  Break password
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** The server's defences, and the buttons that get past them. */
function Security({ game, server, connection, run }: View) {
  const { password, proxy, firewall, monitor } = server.security;
  if (password + proxy + firewall + monitor === 0) return null;
  const passwordKnown = server.accounts.some((account) => account.role === 'admin' && canLogIn(game, server, account.user));

  const bypassable = (kind: 'proxy' | 'firewall', level: number, blocks: string) => {
    if (level === 0) return null;
    const task = findTask(game, connection, { kind });
    const done = connection.bypassed[kind];
    return (
      <li class={`layer${done ? ' is-open' : ''}`} title={`${blocks} until it is bypassed.`}>
        <span class="layer__name">{kind === 'proxy' ? 'Proxy' : 'Firewall'}</span>
        <span class="layer__level data">{level}</span>
        {done ? (
          <span class="layer__state">bypassed</span>
        ) : task ? (
          <TaskProgress taskId={task.id} label="Bypassing" />
        ) : (
          <button type="button" class="btn" onClick={() => run({ kind })}>
            Bypass
          </button>
        )}
      </li>
    );
  };

  const lineup = findTask(game, connection, { kind: 'firewall' });
  const blinding = findTask(game, connection, { kind: 'monitor' });
  const blind = connection.monitor.blindMs > 0;

  return (
    <>
    <ul class="layers" aria-label="Security">
      {password > 0 && (
        <li class={`layer${passwordKnown ? ' is-open' : ''}`} title="Protects the administrator account.">
          <span class="layer__name">Password</span>
          <span class="layer__level data">{password}</span>
          <span class="layer__state">{passwordKnown ? 'broken' : 'locked'}</span>
        </li>
      )}
      {bypassable('proxy', proxy, 'Blocks changes to logs and records')}
      {bypassable('firewall', firewall, 'Blocks copying and deleting files')}
      {monitor > 0 && (
        <li
          class={`layer${blind ? ' is-open is-blind' : ''}`}
          title={
            monitor >= content.rules.monitorGraceSeconds.length
              ? 'Watches for intruders. This one traces every connection from the moment it opens.'
              : 'Watches for intruders. A higher level starts its trace sooner.'
          }
        >
          <span class="layer__name">Monitor</span>
          <span class="layer__level data">{monitor}</span>
          {blind ? (
            <BlindTime connectionId={connection.id} />
          ) : blinding ? (
            <TaskProgress taskId={blinding.id} label="Blinding" />
          ) : ownedProgram(game, content, 'bypassMonitor') && !connection.monitor.used ? (
            <button type="button" class="btn" onClick={() => run({ kind: 'monitor' })}>
              Blind
            </button>
          ) : (
            <span class="layer__state" title={connection.monitor.used ? 'It has seen that trick. Reconnect to blind it again.' : undefined}>
              {connection.monitor.used ? 'watching again' : 'watching'}
            </span>
          )}
        </li>
      )}
    </ul>
    {connection.monitor.echo && <Handshake key={connection.id} connectionId={connection.id} echo={connection.monitor.echo} />}
    {lineup?.puzzle && <PortLineup taskId={lineup.id} rings={lineup.puzzle.locked.length} />}
    </>
  );
}

const blindClock = (game: GameState, connectionId: string) => {
  const seconds = Math.ceil((game.connections.find((item) => item.id === connectionId)?.monitor.blindMs ?? 0) / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};

/** How long the monitor stays blind, counting down. */
function BlindTime({ connectionId }: { connectionId: string }) {
  const left = useGame((game) => blindClock(game, connectionId));
  return (
    <span class="layer__state">
      blind <span class="data">{left}</span>
    </span>
  );
}

const ECHO_STEP_MS = 520;

/**
 * The hands-on way to stay hidden longer: the monitor's check-in pattern
 * lights up cell by cell, then the player clicks the same cells in order.
 */
function Handshake({ connectionId, echo }: { connectionId: string; echo: EchoPuzzle }) {
  // Which step of the pattern is lit while it plays; past the end = the player's turn.
  const [step, setStep] = useState(0);
  const [wrong, setWrong] = useState<number | null>(null);
  const playing = step < echo.cells.length;
  const left = useGame((game) => blindClock(game, connectionId));

  useEffect(() => {
    if (!playing) return;
    const timer = setTimeout(() => setStep((value) => value + 1), ECHO_STEP_MS);
    return () => clearTimeout(timer);
  }, [step, playing]);

  const press = (cell: number) => {
    if (playing || echo.result !== 'open') return;
    if (echo.cells[echo.entered] !== cell) setWrong(cell);
    session.dispatch({ type: 'echoCell', connectionId, cell });
  };
  const bonus = Math.round((content.rules.echoBonusFactor - 1) * 100);
  const penalty = Math.round((1 - content.rules.echoPenaltyFactor) * 100);
  const lit = playing ? echo.cells[step] : undefined;
  const last = echo.result !== 'lost' && !playing && echo.entered > 0 ? echo.cells[echo.entered - 1] : undefined;

  return (
    <div class={`lineup echo is-${echo.result}`}>
      <div class="echo__grid" role="group" aria-label="Handshake pattern">
        {Array.from({ length: 9 }, (_, cell) => (
          <button
            key={cell}
            type="button"
            class={`echo__cell${cell === lit ? ' is-lit' : ''}${cell === last ? ' is-right' : ''}${cell === wrong ? ' is-wrong' : ''}`}
            aria-label={`Cell ${cell + 1}`}
            disabled={playing || echo.result !== 'open'}
            onClick={() => press(cell)}
          />
        ))}
      </div>
      <div class="lineup__text">
        <h3 class="map__heading">Echo the handshake</h3>
        {echo.result === 'open' && (
          <p>
            The monitor checks in with a pattern of {echo.cells.length} cells. {playing ? 'Watch it.' : 'Now click the same cells in the same order.'}{' '}
            Get it right and the monitor stays blind {bonus}% longer. One wrong cell costs {penalty}% of the time left. Or leave it
            alone.
          </p>
        )}
        {echo.result === 'won' && <p>Pattern matched. The monitor thinks all is well and stays blind longer.</p>}
        {echo.result === 'lost' && <p>Wrong cell. The monitor is suspicious and will wake sooner.</p>}
        <p class="lineup__status data">
          {echo.result === 'open' ? `${echo.entered} / ${echo.cells.length} repeated` : echo.result === 'won' ? 'matched' : 'missed'} · blind for{' '}
          {left}
        </p>
        {echo.result === 'open' && !playing && echo.entered === 0 && (
          <button type="button" class="btn" onClick={() => setStep(0)}>
            Show it again
          </button>
        )}
      </div>
    </div>
  );
}

const LINEUP_SIZE = 180;
const LINEUP_CENTRE = LINEUP_SIZE / 2;

/**
 * The hands-on shortcut for a firewall bypass: rings turn, each carrying
 * one port. Click a ring as its port crosses the marker at the top.
 */
function PortLineup({ taskId, rings }: { taskId: string; rings: number }) {
  // One short text per frame, so the rings redraw as they turn.
  const frame = useGame((game) => {
    const task = game.tasks.find((item) => item.id === taskId);
    if (!task?.puzzle) return '';
    const angles = task.puzzle.locked.map((locked, ring) => (locked ? 'L' : ringAngle(task, ring).toFixed(1)));
    return `${angles.join(',')}|${Math.max(0, Math.ceil((task.durationMs - task.progressMs) / 1000))}`;
  });
  if (!frame) return null;
  const [anglesText = '', secondsLeft = '0'] = frame.split('|');
  const angles = anglesText.split(',');
  const tolerance = content.rules.ringToleranceDegrees;
  const lockedCount = angles.filter((angle) => angle === 'L').length;
  const lock = (ring: number) => session.dispatch({ type: 'lockRing', taskId, ring });
  const point = (radius: number, degrees: number) => {
    const radians = ((degrees - 90) * Math.PI) / 180;
    return { x: LINEUP_CENTRE + radius * Math.cos(radians), y: LINEUP_CENTRE + radius * Math.sin(radians) };
  };
  const outer = 26 + (rings - 1) * 14 + 12;
  const left = point(outer, -tolerance);
  const right = point(outer, tolerance);

  return (
    <div class="lineup">
      <svg class="lineup__dial" viewBox={`0 0 ${LINEUP_SIZE} ${LINEUP_SIZE}`} role="group" aria-label="Port line-up">
        {/* The window the port has to be in. */}
        <path
          d={`M${LINEUP_CENTRE} ${LINEUP_CENTRE}L${left.x} ${left.y}A${outer} ${outer} 0 0 1 ${right.x} ${right.y}Z`}
          class="lineup__window"
        />
        <path d={`M${LINEUP_CENTRE - 6} ${LINEUP_CENTRE - outer - 12}h12l-6 9z`} class="lineup__marker" />
        {angles.map((angle, ring) => {
          const radius = 26 + ring * 14;
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
              onPointerDown={() => !locked && lock(ring)}
              onKeyDown={(event: KeyboardEvent) => {
                if (!locked && (event.key === 'Enter' || event.key === ' ')) {
                  event.preventDefault();
                  lock(ring);
                }
              }}
            >
              <circle cx={LINEUP_CENTRE} cy={LINEUP_CENTRE} r={radius} class="lineup__track" />
              <circle cx={port.x} cy={port.y} r={5} class="lineup__port" />
            </g>
          );
        })}
      </svg>
      <div class="lineup__text">
        <h3 class="map__heading">Line up the ports</h3>
        <p>
          Click a ring as its port crosses the marker at the top. Each ring you lock shortens the bypass, and locking all {rings}{' '}
          finishes it. A miss costs {content.rules.ringMissSeconds} seconds. Or leave it and the program gets there by itself.
        </p>
        <p class="lineup__status data">
          {lockedCount} / {rings} locked · {secondsLeft}s left
        </p>
      </div>
    </div>
  );
}

function Files({ game, state, connection, run }: View) {
  const admin = connection.role === 'admin';
  const files = state.files.filter((file) => admin || file.access === 'guest');
  if (files.length === 0) return <p class="empty">No files.</p>;
  // A firewall keeps files shut as well as stopping copies.
  const walled = (findServer(content, connection.serverId)?.security.firewall ?? 0) > 0 && !connection.bypassed.firewall;
  return (
    <ul class="rows data">
      {files.map((file) => {
        const copying = findTask(game, connection, { kind: 'copyFile', file: file.name });
        const deleting = findTask(game, connection, { kind: 'deleteFile', file: file.name });
        const owned = game.player.files.some((own) => own.name === file.name);
        return (
          <li key={file.name} class="row row--file">
            <span class="row__main">{file.name}</span>
            <span class="row__dim">{file.sizeGq} GB</span>
            <span class={file.encrypted ? 'sealed' : 'row__dim'} title={file.encrypted ? `Encrypted, level ${file.encrypted}. A copy needs a Decrypter before it can be read.` : undefined}>
              {file.encrypted ? 'encrypted' : file.access === 'admin' ? 'restricted' : 'public'}
            </span>
            <span class="row__actions">
              {copying ? (
                <TaskProgress taskId={copying.id} label="Copying" />
              ) : deleting ? (
                <TaskProgress taskId={deleting.id} label="Deleting" />
              ) : (
                <>
                  <button
                    type="button"
                    class="btn"
                    disabled={walled}
                    title={walled ? 'The firewall is blocking file access' : undefined}
                    onClick={() => viewer.open({ serverId: connection.serverId, name: file.name, sizeGq: file.sizeGq })}
                  >
                    Open
                  </button>
                  {owned ? (
                    <span class="row__done">Copied</span>
                  ) : (
                    <button type="button" class="btn" onClick={() => run({ kind: 'copyFile', file: file.name })}>
                      Copy
                    </button>
                  )}
                  {admin && (
                    <button type="button" class="btn btn--danger" onClick={() => run({ kind: 'deleteFile', file: file.name })}>
                      Delete
                    </button>
                  )}
                </>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function Logs({ game, state, connection, run }: View) {
  // Lines picked for removal. Picking is the hands-on part: knowing which lines are yours.
  const [picked, setPicked] = useState<readonly number[]>([]);
  if (state.logs.length === 0) return <p class="empty">The access log is empty.</p>;

  const running = game.tasks.find((task) => task.connectionId === connection.id && task.target.kind === 'deleteLog');
  const removing = running?.target.kind === 'deleteLog' ? running.target.logIds : [];
  const chosen = picked.filter((id) => state.logs.some((entry) => entry.id === id));
  const toggle = (id: number) => setPicked(chosen.includes(id) ? chosen.filter((other) => other !== id) : [...chosen, id]);

  return (
    <>
      <div class="scrub">
        <span class="scrub__hint">
          {chosen.length === 0 ? 'Pick the lines to scrub.' : `${chosen.length} ${chosen.length === 1 ? 'line' : 'lines'} picked.`}
        </span>
        {running ? (
          <TaskProgress taskId={running.id} label="Scrubbing" />
        ) : (
          <>
            {chosen.length < state.logs.length ? (
              <button type="button" class="btn" onClick={() => setPicked(state.logs.map((entry) => entry.id))}>
                Select all
              </button>
            ) : null}
            {chosen.length > 0 && (
              <button type="button" class="btn" onClick={() => setPicked([])}>
                Clear
              </button>
            )}
            <button
              type="button"
              class="btn btn--danger"
              disabled={chosen.length === 0}
              onClick={() => {
                run({ kind: 'deleteLog', logIds: [...chosen] });
                setPicked([]);
              }}
            >
              Scrub{chosen.length > 0 ? ` ${chosen.length}` : ''}
            </button>
          </>
        )}
      </div>
      <ul class="rows rows--scroll data">
        {[...state.logs].reverse().map((entry) => {
          const isPicked = chosen.includes(entry.id);
          const going = removing.includes(entry.id);
          return (
            <li key={entry.id}>
              <button
                type="button"
                class={`logline${isPicked ? ' is-picked' : ''}${going ? ' is-going' : ''}`}
                aria-pressed={isPicked}
                disabled={going}
                onClick={() => toggle(entry.id)}
              >
                <span class="logline__mark" aria-hidden="true" />
                <span class="row__dim">{formatGameTime(entry.timeMs)}</span>
                <span class="row__main">{entry.text}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function Records({ game, server, state, connection, act }: View) {
  const columns = server.records?.columns ?? [];
  // The change the active contract wants made here, if it hasn't been made yet.
  const contract = activeContract(game, content);
  const goal = contract?.targetId === server.id && contract.objective.kind === 'record' ? contract.objective : null;
  const goalColumn = goal ? columns.indexOf(goal.column) : -1;
  return (
    <table class="records data">
      <caption>{server.records?.title}</caption>
      <thead>
        <tr>
          {columns.map((column) => (
            <th key={column} scope="col">
              {column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {state.records.map((row) => (
          <tr key={row[0]}>
            {row.map((cell, index) => (
              <td key={index}>
                {cell}
                {goal && row[0] === goal.key && index === goalColumn && cell !== goal.value && (
                  <button
                    type="button"
                    class="btn btn--go records__change"
                    onClick={() => act({ type: 'alterRecord', connectionId: connection.id })}
                  >
                    Change to {goal.value}
                  </button>
                )}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Directory({ game, connection }: View) {
  const listed = content.servers.filter((server) => server.listed && server.id !== connection.serverId);
  return (
    <ul class="rows">
      {listed.map((server) => {
        const known = game.knownServers.includes(server.id);
        return (
          <li key={server.id} class="row row--listing">
            <span class="row__main">{server.name}</span>
            <span class="row__dim">{KIND_LABELS[server.kind]}</span>
            <span class="row__dim">{server.city}</span>
            <span class="row__dim data">{server.address}</span>
            {known ? (
              <span class="row__done">In address book</span>
            ) : (
              <button
                type="button"
                class="btn"
                onClick={() => session.dispatch({ type: 'learnServer', connectionId: connection.id, serverId: server.id })}
              >
                Add address
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Contracts({ game, connection, act }: View) {
  const active = activeContract(game, content);
  const offers = availableContracts(game, content);
  const lyingLow = isLyingLow(game);
  return (
    <>
      {lyingLow && (
        <p class="board__warning">
          No work for you until <span class="data">{formatGameTime(game.player.lieLowUntilMs)}</span>. You were traced. Lie low and let
          the clock run.
        </p>
      )}
      {active && (
        <p class="board__note">
          You are working on <strong>{active.title}</strong>. Deliver it or give it up before taking another.
        </p>
      )}
      {offers.length === 0 && <p class="empty">Nothing on the board right now.</p>}
      <ul class="rows">
        {offers.map((contract) => (
          <li key={contract.id} class="row row--contract">
            <span class="row__main">
              <strong>{contract.title}</strong>
              <span class="contract__summary">{contract.summary}</span>
              <span class="row__dim">
                {contract.client} · target {findServer(content, contract.targetId)?.name}
              </span>
            </span>
            <span class="data contract__pay">{formatMoney(contract.pay)}</span>
            <button
              type="button"
              class="btn btn--go"
              disabled={!!active || lyingLow}
              onClick={() => {
                if (act({ type: 'acceptContract', connectionId: connection.id, contractId: contract.id })) windows.focus('contract');
              }}
            >
              Accept
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

function Market({ game, connection, act }: View) {
  // Starting programs only show up here if the player has removed one: the market gives those back.
  const forSale = content.programs.filter(
    (program) => program.price > 0 || (content.startingPrograms.includes(program.id) && !game.player.programs.includes(program.id)),
  );
  const free = content.rules.storageGq - usedStorageGq(game, content);
  return (
    <ul class="rows">
      {forSale.map((program) => {
        const owned = game.player.programs.includes(program.id);
        return (
          <li key={program.id} class="row row--contract row--market">
            <span class="row__main">
              <strong>{program.name}</strong> <span class="data row__dim">v{program.version}</span>
              <span class="contract__summary">{program.blurb}</span>
            </span>
            <span class="data row__dim">{program.sizeGq} GB</span>
            <span class="data contract__pay">{program.price > 0 ? formatMoney(program.price) : 'free'}</span>
            {owned ? (
              <span class="row__done">Owned</span>
            ) : (
              <button
                type="button"
                class="btn btn--go"
                disabled={game.player.balance < program.price || program.sizeGq > free}
                title={program.sizeGq > free ? 'Not enough room on your gateway' : undefined}
                onClick={() => act({ type: 'buyProgram', connectionId: connection.id, programId: program.id })}
              >
                {program.price > 0 ? 'Buy' : 'Install'}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** The server at the far end of the connection whose tab is in front. */
export function ServerWindow() {
  const desk = useDesk();
  const game = useWorld((state) => state);
  // The last refusal, and the connection it belongs to, so it never shows on another server's tab.
  const [notice, setNotice] = useState<{ connectionId: string; text: string } | null>(null);
  const connection = activeConnection(game, desk);
  const server = connection && findServer(content, connection.serverId);
  const state = connection && game.servers[connection.serverId];
  if (!connection || !server || !state) return null;

  const loggedIn = connection.user !== null;
  const sections = loggedIn ? sectionsFor(server, connection) : [];
  const wanted = desk.sections[connection.id];
  const section = wanted && sections.includes(wanted) ? wanted : sections[0];

  const run = (target: TaskTarget) => {
    const result = session.dispatch({ type: 'runProgram', connectionId: connection.id, target });
    setNotice(result.ok ? null : { connectionId: connection.id, text: result.reason });
  };
  const act = (action: Action) => {
    const result = session.dispatch(action);
    setNotice(result.ok ? null : { connectionId: connection.id, text: result.reason });
    return result.ok;
  };
  const view: View = { game, server, state, connection, run, act };

  return (
    <Window
      id="server"
      title={server.name}
      note={loggedIn ? `${connection.user} @ ${server.hostname}` : 'not logged in'}
      actions={
        <>
          {sections.map((name) => (
            <button
              key={name}
              type="button"
              class={`tabbtn${name === section ? ' is-current' : ''}`}
              aria-pressed={name === section}
              onClick={() => deskStore.showSection(connection.id, name)}
            >
              {SECTION_LABELS[name]}
            </button>
          ))}
          {loggedIn && (
            <button type="button" class="tabbtn tabbtn--exit" onClick={() => act({ type: 'logout', connectionId: connection.id })}>
              Log out
            </button>
          )}
        </>
      }
    >
      <Security {...view} />
      {!loggedIn && <LoginScreen {...view} />}
      {section === 'contracts' && <Contracts {...view} />}
      {section === 'market' && <Market {...view} />}
      {section === 'files' && <Files {...view} />}
      {section === 'logs' && <Logs {...view} />}
      {section === 'records' && <Records {...view} />}
      {section === 'directory' && <Directory {...view} />}
      {notice?.connectionId === connection.id && (
        <p class="map__notice" role="status">
          {notice.text}
        </p>
      )}
    </Window>
  );
}
