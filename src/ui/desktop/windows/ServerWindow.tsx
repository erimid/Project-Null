import { useState } from 'preact/hooks';
import { canLogIn, type Connection, type GameState, type ServerState, type TaskTarget } from '../../../core';
import { findServer, type ServerDef } from '../../../core/content';
import { formatGameTime } from '../../format';
import { useGame, useWorld } from '../../hooks';
import { content, session } from '../../session';
import { activeConnection, deskStore, useDesk, type Section } from '../deskStore';
import { TaskProgress, findTask } from '../TaskProgress';
import { Window } from '../Window';

const SECTION_LABELS: Record<Section, string> = {
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
}

/** Sections this login can open, in menu order. */
function sectionsFor(server: ServerDef, connection: Connection): Section[] {
  const admin = connection.role === 'admin';
  const sections: Section[] = [];
  if (server.kind === 'directory') sections.push('directory');
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

  return (
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
        <li class="layer" title="Watches for intruders. A higher level starts its trace sooner.">
          <span class="layer__name">Monitor</span>
          <span class="layer__level data">{monitor}</span>
          <span class="layer__state">watching</span>
        </li>
      )}
    </ul>
  );
}

function Files({ game, state, connection, run }: View) {
  const admin = connection.role === 'admin';
  const files = state.files.filter((file) => admin || file.access === 'guest');
  if (files.length === 0) return <p class="empty">No files.</p>;
  return (
    <ul class="rows data">
      {files.map((file) => {
        const copying = findTask(game, connection, { kind: 'copyFile', file: file.name });
        const deleting = findTask(game, connection, { kind: 'deleteFile', file: file.name });
        const owned = game.player.files.some((own) => own.name === file.name);
        return (
          <li key={file.name} class="row row--file">
            <span class="row__main">{file.name}</span>
            <span class="row__dim">{file.sizeGq} Gq</span>
            <span class="row__dim">{file.access === 'admin' ? 'restricted' : 'public'}</span>
            <span class="row__actions">
              {copying ? (
                <TaskProgress taskId={copying.id} label="Copying" />
              ) : deleting ? (
                <TaskProgress taskId={deleting.id} label="Deleting" />
              ) : (
                <>
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
  if (state.logs.length === 0) return <p class="empty">The access log is empty.</p>;
  return (
    <ul class="rows rows--scroll data">
      {[...state.logs].reverse().map((entry) => {
        const task = findTask(game, connection, { kind: 'deleteLog', logId: entry.id });
        return (
          <li key={entry.id} class="row row--log">
            <span class="row__dim">{formatGameTime(entry.timeMs)}</span>
            <span class="row__main">{entry.text}</span>
            <span class="row__actions">
              {task ? (
                <TaskProgress taskId={task.id} label="Removing" />
              ) : (
                <button type="button" class="btn btn--danger" onClick={() => run({ kind: 'deleteLog', logId: entry.id })}>
                  Delete
                </button>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function Records({ server, state }: View) {
  const columns = server.records?.columns ?? [];
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
              <td key={index}>{cell}</td>
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
  const view: View = { game, server, state, connection, run };

  return (
    <Window
      id="server"
      title={server.name}
      note={loggedIn ? `${connection.user} @ ${server.hostname}` : 'not logged in'}
      actions={sections.map((name) => (
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
    >
      <Security {...view} />
      {!loggedIn && <LoginScreen {...view} />}
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
