/**
 * The link between the fixed data files (content/) and a running game.
 *
 * The core never imports the data files itself. Whoever runs the game
 * hands them in as a `Content` object, so tests can use tiny made-up
 * worlds and the real data can change without touching the rules.
 */
import type { AccountDef, ServerDef } from '../content/schema';
import type { Connection, GameState, ServerState } from './state';

export interface Content {
  readonly servers: readonly ServerDef[];
  /** Ids of servers every player knows from the start. */
  readonly startingServers: readonly string[];
}

export function findServer(content: Content, id: string): ServerDef | undefined {
  return content.servers.find((server) => server.id === id);
}

export function gatewayOf(content: Content): ServerDef {
  const gateway = content.servers.find((server) => server.kind === 'gateway');
  if (!gateway) throw new Error('Content has no gateway server.');
  return gateway;
}

export function findAccount(server: ServerDef, user: string): AccountDef | undefined {
  return server.accounts.find((account) => account.user === user);
}

function initialServerState(server: ServerDef, gameStartMs: number): ServerState {
  return {
    files: server.files.map((file) => ({ ...file })),
    logs: server.logs
      .map((log) => ({ timeMs: gameStartMs - log.minutesAgo * 60_000, text: log.text, byPlayer: false }))
      .sort((a, b) => a.timeMs - b.timeMs),
    records: server.records ? server.records.rows.map((row) => [...row]) : [],
  };
}

/**
 * Brings a game up to date with the data files: gives every server its
 * starting state if it has none yet, and makes sure the player knows the
 * starting servers. Safe to call any number of times. Call it on every
 * new game and every loaded save, so servers added in a later version of
 * the game show up in old saves too.
 */
export function syncWithContent(state: GameState, content: Content): GameState {
  for (const server of content.servers) {
    state.servers[server.id] ??= initialServerState(server, state.clock.gameTimeMs);
  }
  const exists = (id: string) => findServer(content, id) !== undefined;
  for (const id of [gatewayOf(content).id, ...content.startingServers]) {
    if (!state.knownServers.includes(id)) state.knownServers.push(id);
  }
  // Drop anything that points at a server that no longer exists.
  state.knownServers = state.knownServers.filter(exists);
  state.route = state.route.filter(exists);
  state.connections = state.connections.filter(
    (connection) => exists(connection.serverId) && connection.route.every(exists),
  );
  return state;
}

/** The address the far end sees: the last relay in the route, or the gateway if there is none. */
export function sourceAddress(content: Content, connection: Connection): string {
  const lastHop = connection.route[connection.route.length - 1];
  return (lastHop === undefined ? gatewayOf(content) : (findServer(content, lastHop) ?? gatewayOf(content))).address;
}

export function findConnection(state: GameState, id: string): Connection | undefined {
  return state.connections.find((connection) => connection.id === id);
}
