import { useEffect, useRef, useState } from 'preact/hooks';
import {
  MOVE_NAMES,
  PATCH_LAYERS,
  knowsMove,
  movesLeft,
  patchModule,
  whyNotMove,
  heldBy,
  holding,
  activeContract,
  canLogIn,
  isEvidence,
  modelWith,
  ownedProgram,
  folderOf,
  securityOf,
  stageView,
  partTaken,
  shopOf,
  sellsOnly,
  type Action,
  type Connection,
  type EchoPuzzle,
  type GameState,
  type TaskTarget,
  REGIONS,
  regionOf,
  type Region,
  relayHeat,
} from '../../../core';
import { findServer, type ServerDef } from '../../../core/content';
import { formatGameTime } from '../../format';
import { useGame, useWorld } from '../../hooks';
import { content, session } from '../../session';
import { activeConnection, deskStore, useDesk, type Section } from '../deskStore';
import { TaskProgress, findTask } from '../TaskProgress';
import { Stage, crackedSoFar, fakePassword, handsOnOpen } from './Stage';
import { viewer } from '../viewerStore';
import { FileName } from '../FileName';
import { lit, useGuide } from '../guide';
import { IconTile, Pips } from '../Gear';
import { Icon, type IconName } from '../Icon';
import { Window } from '../Window';
import { Contracts } from './ContractsSection';
import { Hardware } from './HardwareSection';
import { Market } from './MarketSection';
import { LADDER_BOARD, Ladder } from './LadderSection';
import { JobWatch } from './JobWatch';
import { DATA_BOARD, DataDesk } from './DataSection';
import type { View } from './serverView';

const SECTION_LABELS: Record<Section, string> = {
  contracts: 'Contracts',
  ladder: 'Ladder',
  data: 'Data',
  market: 'Market',
  hardware: 'Hardware',
  files: 'Files',
  logs: 'Logs',
  records: 'Records',
  directory: 'Directory',
};

/** Hover labels for the section tabs. */
const SECTION_TIPS: Record<Section, string> = {
  contracts: 'Jobs on offer. Take one, do it, deliver it for credits and rating.',
  ladder: 'Who is climbing, who took what, and what to do about the rivals you beat.',
  data: 'Sell stolen files. Prices move by the day; fresh data pays best.',
  market: 'Buy programs, modules, and rent a model to help you.',
  hardware: 'Faster parts for your gateway.',
  files: 'Files on this server. Copy them home, read them, or delete them.',
  logs: 'What this server noted down, including you. Scrub your lines before you leave.',
  records: 'The records this server keeps. Some jobs ask you to change one.',
  directory: 'People and addresses this server lists.',
};

const KIND_LABELS: Record<ServerDef['kind'], string> = {
  gateway: 'Gateway',
  directory: 'Directory',
  board: 'Board',
  relay: 'Relay',
  company: 'Company',
};

/** Sections this login can open, in menu order. */
function sectionsFor(server: ServerDef, connection: Connection): Section[] {
  const admin = connection.role === 'admin';
  const sections: Section[] = [];
  if (server.kind === 'directory') sections.push('directory');
  if (server.kind === 'board') {
    // A shop only shows the counters it has: no empty Hardware shelf at a program seller.
    const shop = shopOf(server);
    const rare = (kind: string) => (shop.rare ?? []).some((line) => line.kind === kind);
    const market = shop.programs || shop.modules || shop.models || rare('program') || rare('module');
    const hardware = shop.hardware || rare('hardware');
    sections.push(...(sellsOnly(server) ? [] : ['contracts' as const]), ...(server.id === LADDER_BOARD ? ['ladder' as const] : []), ...(server.id === DATA_BOARD && content.data ? ['data' as const] : []), ...(market ? ['market' as const] : []), ...(hardware ? ['hardware' as const] : []));
  }
  sections.push('files');
  if (admin) sections.push('logs');
  if (admin && server.records) sections.push('records');
  return sections;
}

/** The password being worked out: found characters stay, the rest keep spinning. */
function Cracking({ taskId, secret }: { taskId: string; secret: string }) {
  const shown = useGame((game) => {
    const task = game.tasks.find((item) => item.id === taskId);
    return task ? crackedSoFar(task, secret) : secret;
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
  const guide = useGuide();
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
      <ul class="door">
        {server.accounts.map((account) => {
          const open = canLogIn(game, server, account.user);
          const locked = account.role === 'admin' && server.security.password > 0;
          const task = findTask(game, connection, { kind: 'password', user: account.user });
          const secret = fakePassword(`${server.id}/${account.user}`);
          const admin = account.role === 'admin';
          return (
            <li key={account.user} class={`door__card${open ? ' is-open' : ''}${admin ? ' is-admin' : ''}`}>
              <IconTile icon={admin ? 'key' : 'unlock'} tone={open ? 'good' : undefined} />
              <span class="door__who">
                <span class="data door__user">{account.user}</span>
                <span class="door__name">{account.name}</span>
              </span>
              <span class="door__state">
                {admin ? 'Administrator: files, logs and records.' : 'Sees only what the public sees.'}
                {locked && open && (
                  <>
                    {' Password '}
                    <span class="data cracking__code">{secret}</span>
                  </>
                )}
                {locked && !open && !task && ' Password needed.'}
              </span>
              <span class="door__go">
                {open ? (
                  <button
                    type="button"
                    class={`btn btn--go${lit(guide, 'login') || (admin ? lit(guide, 'enter') : '')}`}
                    data-tip="Log in with this account. An admin login can do everything on the server."
                    onClick={() => session.dispatch({ type: 'login', connectionId: connection.id, user: account.user })}
                  >
                    Log in
                  </button>
                ) : task ? (
                  <Cracking taskId={task.id} secret={secret} />
                ) : (
                  <button
                    type="button"
                    class={`btn${admin ? lit(guide, 'break') : ''}`}
                    data-tip="Run your password breaker on this account. Breaking in gets noticed by the monitor."
                    onClick={() => run({ kind: 'password', user: account.user })}
                  >
                    Break password
                  </button>
                )}
              </span>
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
  const running = game.tasks.filter((task) => task.connectionId === connection.id);
  // The stage and the handshake stay in the order they turned up, so a new one never pushes aside the one being played.
  const order = useRef<{ connectionId: string; games: ('echo' | 'stage')[] }>({ connectionId: connection.id, games: [] });
  if (order.current.connectionId !== connection.id) order.current = { connectionId: connection.id, games: [] };
  const showing = [connection.monitor.echo ? ('echo' as const) : null, running.length > 0 ? ('stage' as const) : null].filter((game) => game !== null);
  order.current.games = [...order.current.games.filter((game) => showing.includes(game)), ...showing.filter((game) => !order.current.games.includes(game))];
  const games = order.current.games;
  const played = games.map((game) =>
    game === 'echo' ? (
      connection.monitor.echo && (
        <Handshake key={`echo-${connection.id}`} connectionId={connection.id} echo={connection.monitor.echo} waits={games[0] !== 'echo' && running.some(handsOnOpen)} />
      )
    ) : (
      <Stage key={`stage-${connection.id}`} connectionId={connection.id} />
    ),
  );
  const holds = holding(game, content, connection);
  const holdNote = holds.length > 0 && (
    <p class="board__note link-note">
      {holds.map(({ serverId, layer }) => (
        <span key={serverId}>
          This login holds <strong>{findServer(content, serverId)?.name}</strong>'s {layer}
          {layer === 'firewall' ? ' open' : ' busy'}. Stay logged in here while you work there.
        </span>
      ))}
    </p>
  );
  if (password + proxy + firewall + monitor === 0) {
    return (
      <>
        {holdNote}
        {played}
      </>
    );
  }
  const link = server.link;
  const linkedFrom = link && findServer(content, link.serverId)?.name;
  const firewallHeld = !!heldBy(game, content, server.id, 'firewall');
  const monitorBusy = !!heldBy(game, content, server.id, 'monitor');
  const passwordKnown = server.accounts.some((account) => account.role === 'admin' && canLogIn(game, server, account.user));

  const bypassable = (kind: 'proxy' | 'firewall', level: number, blocks: string) => {
    if (level === 0) return null;
    const task = findTask(game, connection, { kind });
    const done = connection.bypassed[kind];
    const held = kind === 'firewall' && firewallHeld;
    const remote = kind === 'firewall' && link?.layer === 'firewall';
    return (
      <li
        class={`layer${done || held ? ' is-open' : ''}${remote ? ' is-linked' : ''}`}
        title={remote ? `${blocks}. Run from ${linkedFrom}: an admin login there holds it open.` : `${blocks} until it is bypassed.`}
      >
        <span class="layer__name">{kind === 'proxy' ? 'Proxy' : 'Firewall'}</span>
        <span class="layer__level data">{level}</span>
        {held ? (
          <span class="layer__state">held open</span>
        ) : done ? (
          <span class="layer__state">bypassed</span>
        ) : task ? (
          <TaskProgress taskId={task.id} label="Bypassing" />
        ) : (
          <button
            type="button"
            class="btn"
            data-tip={`Run your ${kind} bypass program. ${blocks} until it is done.`}
            onClick={() => run({ kind })}
          >
            Bypass
          </button>
        )}
      </li>
    );
  };

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
          class={`layer${blind || monitorBusy ? ' is-open is-blind' : ''}${link?.layer === 'monitor' ? ' is-linked' : ''}`}
          title={
            link?.layer === 'monitor'
              ? `Reports to ${linkedFrom}. While you hold an admin login there, it notices nothing and its trace stands still.`
              : monitor >= content.rules.monitorGraceSeconds.length
              ? 'Watches for intruders. This one traces every connection from the moment it opens.'
              : 'Watches for intruders. A higher level starts its trace sooner.'
          }
        >
          <span class="layer__name">Monitor</span>
          <span class="layer__level data">{monitor}</span>
          {monitorBusy && !blind ? (
            <span class="layer__state">kept busy</span>
          ) : blind ? (
            <BlindTime connectionId={connection.id} />
          ) : blinding ? (
            <TaskProgress taskId={blinding.id} label="Blinding" />
          ) : ownedProgram(game, content, 'bypassMonitor') && !connection.monitor.used ? (
            <button
              type="button"
              class="btn"
              data-tip="Blind the monitor for a while. Its trace stands still until it wakes."
              onClick={() => run({ kind: 'monitor' })}
            >
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
    <Moves game={game} connection={connection} />
    {link && !firewallHeld && !monitorBusy && (
      <p class="board__note link-note">
        This server's {link.layer} is run from <strong>{linkedFrom}</strong>.
      </p>
    )}
    {holdNote}
    {played}
    </>
  );
}

/**
 * The skills that are a button: Overclock and Hot patch, each good once
 * on a connection. (False trail sits on the trace alarm, where the trace is.)
 * Nothing shows until one of them has been learned.
 */
function Moves({ game, connection }: { game: GameState; connection: Connection }) {
  const overclock = knowsMove(game, content, 'overclock');
  const hotPatch = knowsMove(game, content, 'hotPatch');
  const surge = useGame((state) => Math.ceil((state.connections.find((item) => item.id === connection.id)?.surgeMs ?? 0) / 1000));
  const [notice, setNotice] = useState('');
  if (!overclock && !hotPatch) return null;
  const use = (action: Action) => {
    const result = session.dispatch(action);
    setNotice(result.ok ? '' : result.reason);
  };
  const overclockWhy = overclock ? whyNotMove(game, content, connection.id, 'overclock') : null;
  const patchable = PATCH_LAYERS.filter((layer) => whyNotMove(game, content, connection.id, 'hotPatch', layer) === null);
  const patchLeft = movesLeft(game, content, connection, 'hotPatch');
  const module = patchModule(game);
  return (
    <div class="moves" aria-label="Skills you can use here">
      {overclock && (
        <button
          type="button"
          class={`btn move move--overclock${surge > 0 ? ' is-live' : ''}`}
          data-sfx="move"
          disabled={overclockWhy !== null}
          data-tip={overclockWhy ?? 'Every program running here goes twice as fast for ten seconds. The monitor notices at once. Once per connection.'}
          onClick={() => use({ type: 'useMove', connectionId: connection.id, move: 'overclock' })}
        >
          {MOVE_NAMES.overclock}
          {surge > 0 ? <span class="data move__count">{surge}s</span> : <span class="data move__count">×{movesLeft(game, content, connection, 'overclock')}</span>}
        </button>
      )}
      {hotPatch &&
        (patchable.length > 0 ? (
          patchable.map((layer) => (
            <button
              key={layer}
              type="button"
              class="btn move move--patch"
              data-sfx="move"
              data-tip={`Rebuild your program on the spot to match this ${layer}. Uses up the cheapest module on your shelf. Once per connection.`}
              onClick={() => use({ type: 'useMove', connectionId: connection.id, move: 'hotPatch', layer })}
            >
              {MOVE_NAMES.hotPatch}: {layer}
              <span class="data move__count">×{patchLeft}</span>
            </button>
          ))
        ) : (
          <button
            type="button"
            class="btn move move--patch"
            disabled
            data-tip={
              connection.patched
                ? `Your program is patched for this ${connection.patched} until you disconnect.`
                : patchLeft <= 0
                  ? 'Hot patch is spent on this connection. Reconnect to use it again.'
                  : !module
                    ? 'A Hot patch uses up a module, and your shelf is empty.'
                    : 'Nothing here outclasses the programs you have loaded.'
            }
          >
            {MOVE_NAMES.hotPatch}
            <span class="data move__count">{connection.patched ? 'on' : `×${patchLeft}`}</span>
          </button>
        ))}
      {notice && (
        <span class="moves__notice" role="status">
          {notice}
        </span>
      )}
    </div>
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
function Handshake({ connectionId, echo, waits }: { connectionId: string; echo: EchoPuzzle; waits: boolean }) {
  // Which step of the pattern is lit while it plays; past the end = the player's turn. Below zero = not shown yet:
  // it turned up while another hands-on game was being played, so it waits to be asked for.
  const [step, setStep] = useState(() => (waits && echo.entered === 0 && echo.result === 'open' ? -1 : 0));
  const [wrong, setWrong] = useState<number | null>(null);
  const waiting = step < 0;
  const playing = !waiting && step < echo.cells.length;
  const left = useGame((game) => blindClock(game, connectionId));

  useEffect(() => {
    if (!playing) return;
    const timer = setTimeout(() => setStep((value) => value + 1), ECHO_STEP_MS);
    return () => clearTimeout(timer);
  }, [step, playing]);

  const press = (cell: number) => {
    if (playing || waiting || echo.result !== 'open') return;
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
            disabled={playing || waiting || echo.result !== 'open'}
            onClick={() => press(cell)}
          />
        ))}
      </div>
      <div class="lineup__text">
        <h3 class="map__heading">Echo the handshake</h3>
        {echo.result === 'open' && (
          <p>
            The monitor checks in with a pattern of {echo.cells.length} cells. {waiting ? 'It waits until you ask for it.' : playing ? 'Watch it.' : 'Now click the same cells in the same order.'}{' '}
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
        {echo.result === 'open' && waiting && (
          <button type="button" class="btn btn--go" onClick={() => setStep(0)}>
            Show the pattern
          </button>
        )}
        {echo.result === 'open' && !playing && !waiting && echo.entered === 0 && (
          <button type="button" class="btn" onClick={() => setStep(0)}>
            Show it again
          </button>
        )}
      </div>
    </div>
  );
}

function Files({ game, state, connection, run, act }: View) {
  const guide = useGuide();
  const [read, setRead] = useState('');
  const [path, setPath] = useState('');
  const admin = connection.role === 'admin';
  const visible = state.files.filter((file) => admin || file.access === 'guest');
  // A firewall keeps files shut as well as stopping copies.
  const walled = (securityOf(game, findServer(content, connection.serverId)!).firewall ?? 0) > 0 && !connection.bypassed.firewall;
  const reader = modelWith(game, content, 'read');
  const readAll = () => {
    const before = game.player.contacts.length + game.player.facts.length;
    if (!act({ type: 'modelRead', connectionId: connection.id })) return;
    const after = session.getState().player.contacts.length + session.getState().player.facts.length;
    setRead(after === before ? 'Nothing new in these files.' : `Noted ${after - before} new ${after - before === 1 ? 'thing' : 'things'}. See Write to someone in Messages.`);
  };

  // A job that wants a file planted here: offer the client's file to place.
  const active = activeContract(game, content);
  const stage = active ? stageView(game, active) : undefined;
  const plant = stage && stage.targetId === connection.serverId && stage.objective.kind === 'plant' ? stage.objective : undefined;
  const toPlant = plant && game.player.files.find((file) => file.name === plant.file);

  // Files live in folders. Show the current folder's own files, and the subfolders below it as rows to open.
  const here = visible.filter((file) => folderOf(content, connection.serverId, file) === path);
  const subFolders = new Set<string>();
  for (const file of visible) {
    const folder = folderOf(content, connection.serverId, file);
    if (folder === path || (path !== '' && !folder.startsWith(`${path}/`)) || (path === '' && folder === '')) continue;
    const rest = path === '' ? folder : folder.slice(path.length + 1);
    subFolders.add(rest.split('/')[0]!);
  }
  // How many files sit under each subfolder, at any depth.
  const inFolder = (name: string) => {
    const full = path === '' ? name : `${path}/${name}`;
    return visible.filter((file) => {
      const folder = folderOf(content, connection.serverId, file);
      return folder === full || folder.startsWith(`${full}/`);
    }).length;
  };
  const crumbs = path === '' ? [] : path.split('/');
  const up = (depth: number) => setPath(crumbs.slice(0, depth).join('/'));

  if (visible.length === 0 && !toPlant) return <p class="empty">No files.</p>;
  return (
    <>
    {reader && (
      <div class="scrub">
        <span class="scrub__hint">{read || `${reader.name} can read every file you can open here and note the people and details.`}</span>
        <button type="button" class="btn" disabled={walled} title={walled ? 'The firewall is blocking file access' : undefined} onClick={readAll}>
          Have {reader.name} read them
        </button>
      </div>
    )}
    {toPlant && (
      <div class="scrub">
        <span class="scrub__hint">The job wants <span class="data">{toPlant.name}</span> left on this server.</span>
        <button type="button" class="btn btn--go" disabled={walled} title={walled ? 'The firewall is blocking file access' : undefined} onClick={() => run({ kind: 'uploadFile', file: toPlant.name })}>
          Place {toPlant.name}
        </button>
      </div>
    )}
    {(path !== '' || subFolders.size > 0) && (
      <nav class="files__crumbs" aria-label="Folder path">
        <button type="button" class="files__crumb" onClick={() => up(0)}>root</button>
        {crumbs.map((name, i) => (
          <span key={i}>
            <span class="files__sep" aria-hidden="true"> / </span>
            <button type="button" class="files__crumb" disabled={i === crumbs.length - 1} onClick={() => up(i + 1)}>{name}</button>
          </span>
        ))}
      </nav>
    )}
    <ul class="rows data" key={path}>
      {path !== '' && (
        <li class="row row--folder">
          <button type="button" class="files__folder files__folder--up" onClick={() => up(crumbs.length - 1)}>
            <span class="files__folder-go" aria-hidden="true">‹</span>
            <span class="files__folder-name">back</span>
          </button>
        </li>
      )}
      {[...subFolders].sort().map((name) => (
        <li key={`dir:${name}`} class="row row--folder">
          <button type="button" class="files__folder" onClick={() => setPath(path === '' ? name : `${path}/${name}`)}>
            <span class="files__folder-icon" aria-hidden="true" />
            <span class="files__folder-name">{name}/</span>
            <span class="files__folder-count">
              {inFolder(name)} {inFolder(name) === 1 ? 'file' : 'files'}
            </span>
            <span class="files__folder-go" aria-hidden="true">›</span>
          </button>
        </li>
      ))}
      {here.map((file) => {
        const copying = findTask(game, connection, { kind: 'copyFile', file: file.name });
        const deleting = findTask(game, connection, { kind: 'deleteFile', file: file.name });
        const taken = partTaken(game, connection.serverId, file.name);
        const owned = taken || game.player.files.some((own) => own.name === file.name);
        return (
          <li key={file.name} class="row row--file">
            <span class="row__main">
              <FileName name={file.name} />
            </span>
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
                    data-tip="Read the file here, without copying it"
                    onClick={() => viewer.open({ serverId: connection.serverId, name: file.name, sizeGq: file.sizeGq })}
                  >
                    Open
                  </button>
                  {owned ? (
                    <span class="row__done">{taken ? 'Taken' : 'Copied'}</span>
                  ) : (
                    <button
                      type="button"
                      class={`btn${guide?.id === 'copy' && file.name === guide.file ? ' is-guided' : ''}`}
                      data-tip="Copy this file to your gateway's storage"
                      onClick={() => run({ kind: 'copyFile', file: file.name })}
                    >
                      Copy
                    </button>
                  )}
                  {admin && (
                    <button
                      type="button"
                      class="btn btn--danger"
                      data-tip="Delete this file from the server"
                      onClick={() => run({ kind: 'deleteFile', file: file.name })}
                    >
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
    </>
  );
}

function Logs({ game, state, connection, run, act }: View) {
  const guide = useGuide();
  // Lines picked for removal. Picking is the hands-on part: knowing which lines are yours.
  const [picked, setPicked] = useState<readonly number[]>([]);
  const scrubber = modelWith(game, content, 'scrub');
  // A job that wants a false trail left here.
  const active = activeContract(game, content);
  const stage = active ? stageView(game, active) : undefined;
  const frame = stage && stage.targetId === connection.serverId && stage.objective.kind === 'frame' ? stage.objective : undefined;
  const framed = frame && state.logs.some((entry) => entry.framed === frame.who);
  if (state.logs.length === 0 && !frame) return <p class="empty">The access log is empty.</p>;

  const running = game.tasks.find((task) => task.connectionId === connection.id && task.target.kind === 'deleteLog');
  const removing = running?.target.kind === 'deleteLog' ? running.target.logIds : [];
  const chosen = picked.filter((id) => state.logs.some((entry) => entry.id === id));
  const toggle = (id: number) => setPicked(chosen.includes(id) ? chosen.filter((other) => other !== id) : [...chosen, id]);

  return (
    <>
      {frame && (
        <div class="scrub">
          <span class="scrub__hint">
            {framed ? `The log now points at ${frame.who}. Scrub any of your own lines to finish.` : `The job wants this log to blame ${frame.who}.`}
          </span>
          <button
            type="button"
            class="btn btn--go"
            disabled={!!framed}
            data-tip="Slip a false login into the log, timed before you arrived. Needs an administrator past the proxy."
            onClick={() => act({ type: 'frameLog', connectionId: connection.id })}
          >
            Leave false trail
          </button>
        </div>
      )}
      <div class="scrub">
        <span class="scrub__hint">
          {chosen.length === 0 ? 'Pick the lines to scrub.' : `${chosen.length} ${chosen.length === 1 ? 'line' : 'lines'} picked.`}
        </span>
        {running ? (
          <TaskProgress taskId={running.id} label="Scrubbing" />
        ) : (
          <>
            {scrubber && (
                <button
                  type="button"
                  class="btn btn--go"
                  title="Picks the lines that would give you away in a log review"
                  onClick={() => setPicked(state.logs.filter(isEvidence).map((entry) => entry.id))}
                >
                  Have {scrubber.name} pick
                </button>
              )}
            {chosen.length < state.logs.length ? (
              <button
                type="button"
                class={`btn${lit(guide, 'scrub')}`}
                data-tip="Pick every line in the log"
                onClick={() => setPicked(state.logs.map((entry) => entry.id))}
              >
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
              class={`btn btn--danger${chosen.length > 0 ? lit(guide, 'scrub') : ''}`}
              disabled={chosen.length === 0}
              title={chosen.length === 0 ? 'Pick the log lines to scrub first' : undefined}
              data-tip="Delete the picked lines. A proxy has to be bypassed first."
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
              {entry.points && !game.knownServers.includes(entry.points) && (
                <button
                  type="button"
                  class="btn btn--small btn--go logline__follow"
                  data-tip="This line points at another server. Put it in your address book."
                  onClick={() => act({ type: 'followTrail', connectionId: connection.id, logId: entry.id })}
                >
                  Follow
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}

function Records({ game, server, state, connection, act }: View) {
  const columns = server.records?.columns ?? [];
  // The change the active contract's current step wants made here, if it hasn't been made yet.
  const active = activeContract(game, content);
  const contract = active ? stageView(game, active) : undefined;
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
                    data-tip="Change this record to what the contract asks for"
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

const PAGE_SIZE = 8;

/** The registry's listing: by region, a page at a time. */
function Directory({ game, connection }: View) {
  const listed = content.servers.filter((server) => server.listed && server.id !== connection.serverId);
  const [region, setRegion] = useState<Region>(REGIONS[1]);
  const [page, setPage] = useState(0);
  const inRegion = listed.filter((server) => regionOf(server) === region);
  const pages = Math.max(1, Math.ceil(inRegion.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const shown = inRegion.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);
  return (
    <>
      <div class="pager" role="tablist" aria-label="Regions">
        {REGIONS.map((name) => {
          const count = listed.filter((server) => regionOf(server) === name).length;
          return (
            <button
              key={name}
              type="button"
              role="tab"
              class={`tabbtn${name === region ? ' is-current' : ''}`}
              aria-selected={name === region}
              onClick={() => {
                setRegion(name);
                setPage(0);
              }}
            >
              {name} <span class="data row__dim">{count}</span>
            </button>
          );
        })}
      </div>
      {shown.length === 0 && <p class="empty">Nothing listed in this region.</p>}
      <ul class="rows">
        {shown.map((server) => {
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
      {pages > 1 && (
        <div class="pager pager--pages">
          <button type="button" class="btn" disabled={current === 0} onClick={() => setPage(current - 1)}>
            Previous
          </button>
          <span class="data row__dim">
            page {current + 1} of {pages}
          </span>
          <button type="button" class="btn" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>
            Next
          </button>
        </div>
      )}
    </>
  );
}

const KIND_ICONS: Record<ServerDef['kind'], IconName> = { gateway: 'chip', directory: 'book', board: 'rack', relay: 'route', company: 'rack' };
const KIND_NAMES: Record<ServerDef['kind'], string> = {
  gateway: 'Your gateway',
  directory: 'Public directory',
  board: 'Contracts board',
  relay: 'Open relay',
  company: 'Company server',
};

/** Sections that are a plain list: beside these a wide window has room for the server's sheet. */
const LIST_SECTIONS: readonly Section[] = ['files', 'logs', 'records', 'directory'];

/**
 * What the player knows about the server, in a column of its own when the
 * window is wide enough: where it is, how far in they are, each defence
 * and what stands on the other side of it. It only shows what the rest of
 * the window and the Route map already tell.
 */
function ServerSheet({ game, server, state, connection, sections, section }: View & { sections: readonly Section[]; section: Section | undefined }) {
  const { password, proxy, firewall, monitor } = securityOf(game, server);
  const admin = connection.role === 'admin';
  const loggedIn = connection.user !== null;
  const passwordKnown = server.accounts.some((account) => account.role === 'admin' && canLogIn(game, server, account.user));
  const heat = relayHeat(game, content, server.id);
  const top = Math.max(1, ...content.servers.map((other) => Math.max(other.security.password, other.security.proxy, other.security.firewall, other.security.monitor)));
  const defences: { name: string; level: number; open: boolean; state: string; guards: string }[] = [
    { name: 'Password', level: password ?? 0, open: passwordKnown, state: passwordKnown ? 'broken' : 'locked', guards: 'the administrator account' },
    { name: 'Proxy', level: proxy ?? 0, open: connection.bypassed.proxy, state: connection.bypassed.proxy ? 'bypassed' : 'in the way', guards: 'logs and records' },
    {
      name: 'Firewall',
      level: firewall ?? 0,
      open: connection.bypassed.firewall || !!heldBy(game, content, server.id, 'firewall'),
      state: connection.bypassed.firewall ? 'bypassed' : heldBy(game, content, server.id, 'firewall') ? 'held open' : 'in the way',
      guards: 'copying and deleting files',
    },
    {
      name: 'Monitor',
      level: monitor ?? 0,
      open: connection.monitor.blindMs > 0 || !!heldBy(game, content, server.id, 'monitor'),
      state: connection.monitor.blindMs > 0 ? 'blind' : heldBy(game, content, server.id, 'monitor') ? 'kept busy' : 'watching',
      guards: 'traces you while you work',
    },
  ].filter((defence) => defence.level > 0);
  const visibleFiles = state.files.filter((file) => admin || file.access === 'guest');
  const sizeGb = visibleFiles.reduce((sum, file) => sum + file.sizeGq, 0);
  const counts: Partial<Record<Section, string>> = {
    files: `${visibleFiles.length} ${visibleFiles.length === 1 ? 'file' : 'files'} · ${sizeGb} GB`,
    logs: `${state.logs.length} ${state.logs.length === 1 ? 'line' : 'lines'}`,
    records: `${state.records.length} ${state.records.length === 1 ? 'row' : 'rows'}`,
  };
  const active = activeContract(game, content);
  const stage = active ? stageView(game, active) : undefined;
  const isTarget = stage?.targetId === server.id;

  return (
    <aside class="sheet" aria-label={`About ${server.name}`}>
      <header class="sheet__head">
        <IconTile icon={KIND_ICONS[server.kind]} size="lg" />
        <div class="sheet__title">
          <h3 class="sheet__name">{server.name}</h3>
          <p class="sheet__where">
            {KIND_NAMES[server.kind]} · {server.city}, {server.country}
          </p>
          <p class="sheet__address data">
            {server.hostname} · {server.address}
          </p>
        </div>
      </header>
      {server.blurb && <p class="sheet__blurb">{server.blurb}</p>}
      {isTarget && (
        <p class="sheet__job">
          <Icon name="radar" size={16} /> Your contract points here.
        </p>
      )}

      <section class="sheet__part">
        <h4 class="sheet__label">Your access</h4>
        <p class={`sheet__access${loggedIn ? ' is-in' : ''}`}>
          {loggedIn ? (
            <>
              Logged in as <span class="data">{connection.user}</span>
              <span class="sheet__dim">{admin ? 'Administrator: everything here is open to you.' : 'Guest: public files only. Logs and records need the administrator.'}</span>
            </>
          ) : (
            <>
              At the door
              <span class="sheet__dim">Connected, not logged in. Nothing inside can be touched yet.</span>
            </>
          )}
        </p>
      </section>

      {defences.length > 0 && (
        <section class="sheet__part">
          <h4 class="sheet__label">Defences</h4>
          <ul class="sheet__defences">
            {defences.map((defence) => (
              <li key={defence.name} class={`sheet__defence${defence.open ? ' is-open' : ''}`}>
                <span class="sheet__defence-name">{defence.name}</span>
                <Pips on={defence.level} of={top} label={`Level ${defence.level}`} />
                <span class="sheet__defence-state">{defence.state}</span>
                <span class="sheet__dim">{defence.guards}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {server.kind !== 'gateway' && (
        <section class="sheet__part">
          <h4 class="sheet__label">Heat</h4>
          <div class={`sheet__heat${heat >= 1.5 ? ' is-hot' : ''}`} style={{ '--heat': Math.min(1, heat / 2).toFixed(2) }}>
            <span class="sheet__heat-bar" aria-hidden="true" />
            <span class="sheet__heat-word">{heat >= 1.5 ? 'Hot' : heat >= 0.05 ? 'Warm' : 'Cold'}</span>
          </div>
          <p class="sheet__dim">{heat >= 0.05 ? 'This server has seen you lately. As a relay it would hold a trace up for less time until it cools.' : 'This server has not noticed you lately.'}</p>
        </section>
      )}

      {loggedIn && sections.some((name) => name in counts) && (
        <section class="sheet__part">
          <h4 class="sheet__label">Inside</h4>
          <div class="sheet__inside">
            {sections
              .filter((name) => name in counts)
              .map((name) => (
                <button
                  key={name}
                  type="button"
                  class={`sheet__tile${name === section ? ' is-current' : ''}`}
                  aria-pressed={name === section}
                  data-sfx="tab"
                  onClick={() => deskStore.showSection(connection.id, name)}
                >
                  <span class="sheet__tile-name">{SECTION_LABELS[name]}</span>
                  <span class="sheet__tile-count data">{counts[name]}</span>
                </button>
              ))}
          </div>
        </section>
      )}
    </aside>
  );
}

/** The server at the far end of the connection whose tab is in front. */
export function ServerWindow() {
  const guide = useGuide();
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
  // Beside the door and the plain lists a wide window shows the server's sheet. The shops and boards fill their own width.
  const withSheet = !loggedIn || (section !== undefined && LIST_SECTIONS.includes(section));

  return (
    <Window
      id="server"
      title={server.name}
      note={loggedIn ? `${connection.user} @ ${server.hostname}` : 'not logged in'}
      actions={
        loggedIn && (
          <button
            type="button"
            class={`tabbtn tabbtn--exit${lit(guide, 'relog')}`}
            data-tip="Log out but stay connected"
            onClick={() => act({ type: 'logout', connectionId: connection.id })}
          >
            Log out
          </button>
        )
      }
      tabs={
        sections.length > 0 &&
        sections.map((name) => (
          <button
            key={name}
            type="button"
            class={`tabbtn${name === section ? ' is-current' : ''}${name !== section && guide && ((guide.id === 'accept' && name === 'contracts') || (guide.id === 'copy' && name === 'files') || (guide.id === 'scrub' && name === 'logs')) ? ' is-guided' : ''}`}
            aria-pressed={name === section}
            data-tip={SECTION_TIPS[name]}
            onClick={() => deskStore.showSection(connection.id, name)}
          >
            {SECTION_LABELS[name]}
          </button>
        ))
      }
    >
      <Security {...view} />
      <JobWatch {...view} />
      <div class={`srv${withSheet ? ' srv--sheet' : ''}`}>
        <div class="srv__main">
          {!loggedIn && <LoginScreen {...view} />}
          {section === 'contracts' && <Contracts {...view} />}
          {section === 'ladder' && <Ladder {...view} />}
          {section === 'data' && <DataDesk {...view} />}
          {section === 'market' && <Market {...view} />}
          {section === 'hardware' && <Hardware {...view} />}
          {section === 'files' && <Files {...view} />}
          {section === 'logs' && <Logs {...view} />}
          {section === 'records' && <Records {...view} />}
          {section === 'directory' && <Directory {...view} />}
          {notice?.connectionId === connection.id && (
            <p class="map__notice" role="status">
              {notice.text}
            </p>
          )}
        </div>
        {withSheet && <ServerSheet {...view} sections={sections} section={section} />}
      </div>
    </Window>
  );
}
