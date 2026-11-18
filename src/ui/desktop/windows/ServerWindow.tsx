import { useState } from 'preact/hooks';
import type { Connection, GameState, ServerState } from '../../../core';
import { findServer, type ServerDef } from '../../../core/content';
import { formatGameTime } from '../../format';
import { useWorld } from '../../hooks';
import { content, session } from '../../session';
import { activeConnection, deskStore, useDesk, type Section } from '../deskStore';
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

function LoginScreen({ server, connection, state }: { server: ServerDef; connection: Connection; state: ServerState }) {
  const [notice, setNotice] = useState('');
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
        {server.accounts.map((account) => (
          <li key={account.user} class="row row--account">
            <span class="data row__main">{account.user}</span>
            <span class="row__dim">{account.name}</span>
            <button
              type="button"
              class="btn"
              onClick={() => {
                const result = session.dispatch({ type: 'login', connectionId: connection.id, user: account.user });
                setNotice(result.ok ? '' : result.reason);
              }}
            >
              Log in
            </button>
          </li>
        ))}
      </ul>
      {notice && (
        <p class="map__notice" role="status">
          {notice}
        </p>
      )}
    </div>
  );
}

function Files({ state, connection }: { state: ServerState; connection: Connection }) {
  const files = state.files.filter((file) => connection.role === 'admin' || file.access === 'guest');
  if (files.length === 0) return <p class="empty">No files.</p>;
  return (
    <ul class="rows data">
      {files.map((file) => (
        <li key={file.name} class="row row--file">
          <span class="row__main">{file.name}</span>
          <span class="row__dim">{file.sizeGq} Gq</span>
          <span class="row__dim">{file.access === 'admin' ? 'restricted' : 'public'}</span>
        </li>
      ))}
    </ul>
  );
}

function Logs({ state }: { state: ServerState }) {
  if (state.logs.length === 0) return <p class="empty">The access log is empty.</p>;
  return (
    <ul class="rows rows--scroll data">
      {[...state.logs].reverse().map((entry, index) => (
        <li key={index} class="row row--log">
          <span class="row__dim">{formatGameTime(entry.timeMs)}</span>
          <span class="row__main">{entry.text}</span>
        </li>
      ))}
    </ul>
  );
}

function Records({ server, state }: { server: ServerDef; state: ServerState }) {
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

function Directory({ game, connection }: { game: GameState; connection: Connection }) {
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
  const connection = activeConnection(game, desk);
  const server = connection && findServer(content, connection.serverId);
  const state = connection && game.servers[connection.serverId];
  if (!connection || !server || !state) return null;

  const loggedIn = connection.user !== null;
  const sections = loggedIn ? sectionsFor(server, connection) : [];
  const wanted = desk.sections[connection.id];
  const section = wanted && sections.includes(wanted) ? wanted : sections[0];

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
      {!loggedIn && <LoginScreen server={server} connection={connection} state={state} />}
      {section === 'files' && <Files state={state} connection={connection} />}
      {section === 'logs' && <Logs state={state} />}
      {section === 'records' && <Records server={server} state={state} />}
      {section === 'directory' && <Directory game={game} connection={connection} />}
    </Window>
  );
}
