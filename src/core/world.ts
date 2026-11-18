/**
 * The link between the fixed data files (content/) and a running game.
 *
 * The core never imports the data files itself. Whoever runs the game
 * hands them in as a `Content` object, so tests can use tiny made-up
 * worlds and the real data can change without touching the rules.
 */
import type { AccountDef, ContractDef, FileContent, MailDef, MailKey, ProgramDef, ProgramKind, ServerDef } from '../content/schema';
import type { Connection, GameState, ServerState } from './state';

/** Numbers that tune the rules. The real ones come from content/tuning.json. */
export interface Rules {
  /** Game minutes that pass per real second at 1× speed. */
  readonly gameMinutesPerRealSecond: number;
  /** Seconds between an intrusion and the trace starting, by monitor level. Past the end = on connect. */
  readonly monitorGraceSeconds: readonly number[];
  readonly maxRunningPrograms: number;
  readonly storageGq: number;
  /** With no relays, the trace takes this fraction of the server's per-hop time. */
  readonly directTraceFactor: number;
  /** In-game hours without contracts after being traced. */
  readonly lieLowHours: number;
  readonly finePerSecurityLevel: number;
  readonly caughtRatingLoss: number;
  /** How many times one connection can be rerouted around a trace. */
  readonly maxReroutes: number;
  /** In-game hours after an intrusion before the target reads its logs. */
  readonly reviewHours: number;
  /** A fine from a log review is this fraction of the fine for being traced. */
  readonly reviewFineFactor: number;
  /** How close (in degrees) a ring's port must be to the marker to lock. */
  readonly ringToleranceDegrees: number;
  /** Seconds a missed lock adds to the task. */
  readonly ringMissSeconds: number;
}

export interface Content {
  readonly servers: readonly ServerDef[];
  /** Ids of servers every player knows from the start. */
  readonly startingServers: readonly string[];
  readonly programs: readonly ProgramDef[];
  /** Ids of programs every player owns from the start. */
  readonly startingPrograms: readonly string[];
  readonly contracts: readonly ContractDef[];
  /** Messages the rules send, by name. */
  readonly mail: Readonly<Record<MailKey, MailDef>>;
  readonly rules: Rules;
}

/**
 * Sends the player one of the written messages. Text in {braces} is
 * replaced from `fill`; {handle} is always available.
 */
export function sendMail(state: GameState, content: Content, key: MailKey, fill: Record<string, string> = {}): void {
  const values: Record<string, string> = { handle: state.player.handle, ...fill };
  const write = (text: string) => text.replace(/\{(\w+)\}/g, (whole, name: string) => values[name] ?? whole);
  const mail = content.mail[key];
  state.messages.push({
    id: `m${state.nextId++}`,
    from: write(mail.from),
    subject: write(mail.subject),
    body: write(mail.body),
    timeMs: state.clock.gameTimeMs,
    read: false,
  });
}

/** Does `name` the first time it is called for this game, and nothing after that. */
export function once(state: GameState, name: string, action: () => void): void {
  if (state.flags.includes(name)) return;
  state.flags.push(name);
  action();
}

export function findProgram(content: Content, id: string): ProgramDef | undefined {
  return content.programs.find((program) => program.id === id);
}

/** The best program of a kind that the player owns, if any. */
export function ownedProgram(state: GameState, content: Content, kind: ProgramKind): ProgramDef | undefined {
  return state.player.programs
    .map((id) => findProgram(content, id))
    .filter((program): program is ProgramDef => program?.kind === kind)
    .sort((a, b) => b.version - a.version)[0];
}

/** What opening a file shows, if anything was written for it. `serverId` is where the file is, or came from. */
export function fileContent(content: Content, serverId: string, name: string): FileContent | undefined {
  return findServer(content, serverId)?.files.find((file) => file.name === name)?.content;
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

function initialServerState(server: ServerDef, state: GameState): ServerState {
  return {
    // What is inside a file stays in the data files; the game only tracks which files exist.
    files: server.files.map((file) => ({ name: file.name, sizeGq: file.sizeGq, access: file.access })),
    logs: server.logs
      .map((log) => ({ timeMs: state.clock.gameTimeMs - log.minutesAgo * 60_000, text: log.text }))
      .sort((a, b) => a.timeMs - b.timeMs)
      .map((log) => ({ id: state.nextId++, ...log, byPlayer: false })),
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
    state.servers[server.id] ??= initialServerState(server, state);
  }
  const exists = (id: string) => findServer(content, id) !== undefined;
  for (const id of [gatewayOf(content).id, ...content.startingServers]) {
    if (!state.knownServers.includes(id)) state.knownServers.push(id);
  }
  // A player always owns something; an empty list means a new game or a save from before programs existed.
  if (state.player.programs.length === 0) state.player.programs = [...content.startingPrograms];
  state.player.programs = state.player.programs.filter((id) => findProgram(content, id) !== undefined);

  // Recordings were added to servers after some saves were made; give those saves the files once.
  once(state, 'recordings-added', () => {
    for (const server of content.servers) {
      const files = state.servers[server.id]?.files;
      for (const file of server.files) {
        if (!files || file.content === undefined || file.content.kind === 'text') continue;
        if (!files.some((other) => other.name === file.name)) {
          files.push({ name: file.name, sizeGq: file.sizeGq, access: file.access });
        }
      }
    }
  });

  once(state, 'welcome', () => sendMail(state, content, 'welcome'));
  // A contract that was removed from the game can't be finished.
  const isContract = (id: string) => content.contracts.some((contract) => contract.id === id);
  if (state.contracts.activeId !== null && !isContract(state.contracts.activeId)) state.contracts.activeId = null;

  // Drop anything that points at a server that no longer exists.
  state.knownServers = state.knownServers.filter(exists);
  state.route = state.route.filter(exists);
  state.connections = state.connections.filter(
    (connection) => exists(connection.serverId) && connection.route.every(exists),
  );
  state.tasks = state.tasks.filter(
    (task) => findConnection(state, task.connectionId) && findProgram(content, task.programId),
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
