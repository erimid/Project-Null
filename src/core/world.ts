/**
 * The link between the fixed data files (content/) and a running game.
 *
 * The core never imports the data files itself. Whoever runs the game
 * hands them in as a `Content` object, so tests can use tiny made-up
 * worlds and the real data can change without touching the rules.
 */
import type { AccountDef, ContractDef, FileContent, MailDef, MailKey, ProgramDef, ProgramKind, ServerDef } from '../content/schema';
import type { CompanyPools } from '../content/companies';
import type { HardwareDef } from '../content/hardware';
import type { ModelDef } from '../content/models';
import type { PeopleDef } from '../content/people';
import type { Connection, GameState, ServerState } from './state';

/** Numbers that tune the rules. The real ones come from content/tuning.json. */
export interface Rules {
  /** Game minutes that pass per real second at 1× speed. */
  readonly gameMinutesPerRealSecond: number;
  /** Seconds between an intrusion and the trace starting, by monitor level. Past the end = on connect. */
  readonly monitorGraceSeconds: readonly number[];
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
  /** Seconds a Monitor Bypass as strong as the monitor keeps it blind. */
  readonly monitorBlindSeconds: number;
  /** Echoing the handshake right multiplies the blind time left by this. */
  readonly echoBonusFactor: number;
  /** One wrong cell multiplies the blind time left by this. */
  readonly echoPenaltyFactor: number;
  /** Delivered contracts before the fixer writes about harder security. */
  readonly harderSecurityAfter: number;
  /** Delivered contracts before the fixer writes about writing to people. */
  readonly phishingAfter: number;
  /** In-game minutes before someone answers a message. */
  readonly phishReplyMinutes: number;
  /** Most details one message can mention. */
  readonly phishMaxDetails: number;
  /** In-game hours someone who saw through a message will not read another. */
  readonly phishWaryHours: number;
  /** Times someone can see through a message before they report it and stop answering. */
  readonly phishStrikes: number;
  /** Delivered contracts before the fixer writes about renting a model. */
  readonly modelsAfter: number;
  /** In-game hours one rental of a model lasts. */
  readonly modelRentHours: number;
  /** A watching model cuts the connection when a trace has this many seconds left. */
  readonly modelWatchSeconds: number;
  /** Delivered contracts before the fixer writes about gateway hardware. */
  readonly hardwareAfter: number;
  /** Being traced by a server with a layer at this level or above costs a hardware tier. */
  readonly hardwareLossLevel: number;
  /** Repeatable jobs the board keeps posted. */
  readonly boardJobs: number;
  /** In-game hours a repeatable job stays on the board. */
  readonly jobHours: number;
  /** What a repeatable job pays, by the tier of the company, tier 1 first. Each job adds a little on top. */
  readonly jobPay: readonly number[];
  /** The lowest rating that is offered work against companies of each tier, tier 1 first. */
  readonly tierRatings: readonly number[];
  /** Rating a delivered job earns, by the tier of the company, tier 1 first. */
  readonly jobRatings: readonly number[];
  /** Delivered contracts before the fixer writes about the standing jobs. */
  readonly jobsAfter: number;
  /** Rating at which the fixer writes about jobs that need a second server. */
  readonly linksAfterRating: number;
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
  /** People who can be written to, and what can be known about them. */
  readonly people: PeopleDef;
  /** Language models for rent on the board. */
  readonly models: readonly ModelDef[];
  /** Parts for the gateway, sold on the board. */
  readonly hardware: readonly HardwareDef[];
  /** Pools the ordinary companies and their jobs are made from (see generate.ts and jobs.ts). */
  readonly companies: CompanyPools;
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

/** Sends the messages that depend on how far the player has got. Safe to call any time. */
export function noteProgress(state: GameState, content: Content): void {
  if (state.contracts.completed.length >= content.rules.harderSecurityAfter) {
    once(state, 'harderSecurity', () => sendMail(state, content, 'harderSecurity'));
  }
  if (state.contracts.completed.length >= content.rules.phishingAfter && content.people.asks.length > 0) {
    once(state, 'phishing', () => sendMail(state, content, 'phishing'));
  }
  if (state.contracts.completed.length >= content.rules.hardwareAfter && content.hardware.some((part) => part.price > 0)) {
    once(state, 'hardware', () => sendMail(state, content, 'hardware'));
  }
  if (state.contracts.completed.length >= content.rules.jobsAfter) {
    once(state, 'jobs', () => sendMail(state, content, 'jobs'));
  }
  if (state.player.rating >= content.rules.linksAfterRating) {
    once(state, 'links', () => sendMail(state, content, 'links'));
  }
  if (state.contracts.completed.length >= content.rules.modelsAfter && content.models.length > 0) {
    once(state, 'models', () => sendMail(state, content, 'models'));
  }
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
    files: server.files.map((file) => ({
      name: file.name,
      sizeGq: file.sizeGq,
      access: file.access,
      ...(file.encrypted ? { encrypted: file.encrypted } : {}),
    })),
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

  // Files that name people or hold details were added after some saves were made; give those saves the files once.
  once(state, 'people-files', () => {
    const sources = [...content.people.people.flatMap((person) => (person.source ? [person.source] : [])), ...content.people.facts.map((fact) => fact.source)];
    for (const source of sources) {
      const files = state.servers[source.serverId]?.files;
      const file = findServer(content, source.serverId)?.files.find((item) => item.name === source.file);
      if (files && file && !files.some((other) => other.name === file.name)) {
        files.push({ name: file.name, sizeGq: file.sizeGq, access: file.access, ...(file.encrypted ? { encrypted: file.encrypted } : {}) });
      }
    }
  });

  once(state, 'welcome', () => sendMail(state, content, 'welcome'));
  noteProgress(state, content);
  // A contract that was removed from the game can't be finished.
  const isContract = (id: string) =>
    content.contracts.some((contract) => contract.id === id) ||
    state.contracts.jobs.some((job) => job.id === id && exists(job.targetId));
  state.contracts.jobs = state.contracts.jobs.filter((job) => exists(job.targetId));
  if (state.contracts.activeId !== null && !isContract(state.contracts.activeId)) state.contracts.activeId = null;

  if (state.player.model && !content.models.some((model) => model.id === state.player.model?.id)) state.player.model = null;

  // Drop anything that points at a server that no longer exists.
  state.knownServers = state.knownServers.filter(exists);
  state.route = state.route.filter(exists);
  state.connections = state.connections.filter(
    (connection) => exists(connection.serverId) && connection.route.every(exists),
  );
  state.tasks = state.tasks.filter(
    (task) =>
      (task.connectionId === null || findConnection(state, task.connectionId)) && findProgram(content, task.programId),
  );
  return state;
}

/** The address the far end sees: the last relay in the route, or the gateway if there is none. */
export function sourceAddress(content: Content, connection: Connection): string {
  const lastHop = connection.route[connection.route.length - 1];
  return (lastHop === undefined ? gatewayOf(content) : (findServer(content, lastHop) ?? gatewayOf(content))).address;
}

export function findConnection(state: GameState, id: string | null): Connection | undefined {
  return state.connections.find((connection) => connection.id === id);
}
