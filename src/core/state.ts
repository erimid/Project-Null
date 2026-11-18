/**
 * The whole game in one plain object. It contains only data (no
 * functions, no class instances), so it can be saved as JSON as it is.
 */
import type { Role } from '../content/schema';

/** Increase this when the shape of GameState changes, and add a migration in save.ts. */
export const STATE_VERSION = 5;

/** 0 = paused. */
export const SPEEDS = [0, 1, 2, 4] as const;
export type Speed = (typeof SPEEDS)[number];

/** Most relay servers one route may pass through. */
export const MAX_HOPS = 8;

export interface ClockState {
  /** The in-game date and time, as milliseconds since 1970 (UTC). */
  gameTimeMs: number;
  /** The speed the player chose. Ignored while any connection is open. */
  speed: Speed;
}

export interface PlayerState {
  handle: string;
  /** Money, in credits. */
  balance: number;
  /** How many connections can be open at once. Starts at 1; upgrades raise it. */
  maxConnections: number;
  /** Ids of the programs the player owns. */
  programs: string[];
  /** Files copied to the gateway. */
  files: StoredFile[];
  /** Passwords the player has broken: server id -> the account names they open. */
  passwords: Record<string, string[]>;
  /** Standing on the contracts board. Finished contracts raise it; being traced lowers it. */
  rating: number;
  /** Game time until which the board gives the player no work. 0 = never traced. */
  lieLowUntilMs: number;
}

export interface ContractsState {
  /** Id of the contract being worked on, if any. One at a time. */
  activeId: string | null;
  /** Ids of contracts delivered and paid. */
  completed: string[];
}

export interface StoredFile {
  name: string;
  sizeGq: number;
  /** Id of the server it was copied from. */
  from: string;
}

/**
 * A trace working its way back along a connection's route.
 * - none: nobody has noticed.
 * - pending: an intrusion was noticed; the trace starts when graceMs runs out.
 * - active: the trace is running. It works through `hopMs` in order (the
 *   last relay first); when all are done, the gateway is found.
 */
export interface TraceState {
  status: 'none' | 'pending' | 'active';
  /** Time left before a pending trace starts. */
  graceMs: number;
  /** How long an active trace has been running. */
  elapsedMs: number;
  /** How long the trace needs for each step back along the route. Fixed when the connection opens. */
  hopMs: number[];
}

/**
 * One open connection to a server. Each has its own bounce chain (and,
 * later, its own trace).
 */
export interface Connection {
  id: string;
  /** Id of the server at the far end. */
  serverId: string;
  /** Ids of the relay servers the connection passes through, in order from the gateway. */
  route: string[];
  /** Account logged in as on the target, or null while still at the login screen. */
  user: string | null;
  /** Access that account gives. */
  role: Role | null;
  /** Game time the connection was opened. */
  openedAtMs: number;
  /** Layers bypassed for as long as this connection stays open. */
  bypassed: { proxy: boolean; firewall: boolean };
  trace: TraceState;
  /** How many times this connection has been rerouted around a trace. */
  reroutes: number;
}

/** What a running program is working on. */
export type TaskTarget =
  | { kind: 'password'; user: string }
  | { kind: 'proxy' }
  | { kind: 'firewall' }
  | { kind: 'copyFile'; file: string }
  | { kind: 'deleteFile'; file: string }
  /** Remove one or more lines from the access log in a single run. */
  | { kind: 'deleteLog'; logIds: number[] };

/** A program that is running against a connection. */
export interface Task {
  id: string;
  programId: string;
  connectionId: string;
  target: TaskTarget;
  /** Simulated time it has run so far. */
  progressMs: number;
  /** Simulated time it needs in total. */
  durationMs: number;
  /** The hands-on shortcut for this task, if it has one. */
  puzzle?: RingPuzzle;
}

/**
 * The port line-up: rings that turn, each with one port on it. Locking a
 * ring while its port is under the marker (0 degrees) shortens the task;
 * locking them all finishes it. Where a ring is depends only on how long
 * the task has run, so it needs no state of its own.
 */
export interface RingPuzzle {
  /** Where each ring's port was when the task started, in degrees. */
  startAngles: number[];
  /** Degrees per second; negative turns the other way. */
  speeds: number[];
  locked: boolean[];
}

/** A look through a server's logs that will happen some time after the player left. */
export interface Review {
  serverId: string;
  /** Game time it happens. */
  dueMs: number;
}

/** A message in the player's inbox. */
export interface Message {
  id: string;
  from: string;
  subject: string;
  body: string;
  /** Game time it arrived. */
  timeMs: number;
  read: boolean;
}

export interface FileState {
  name: string;
  sizeGq: number;
  access: Role;
}

export interface LogEntry {
  /** Unique within the game, so a program can point at one entry. */
  id: number;
  /** Game time the entry was written. */
  timeMs: number;
  text: string;
  /** True if the player caused this entry. Never shown; cleanup and forensics use it. */
  byPlayer: boolean;
}

/** The changeable parts of one server. The fixed parts live in content/servers/. */
export interface ServerState {
  files: FileState[];
  logs: LogEntry[];
  /** Rows of the server's records table, if it has one. */
  records: string[][];
}

export interface GameState {
  version: typeof STATE_VERSION;
  /** Seed every random stream is derived from. */
  seed: number;
  /** Saved position of each named random stream (see streams.ts). */
  rngStreams: Record<string, number>;
  /** Next number to use when something needs a unique id. */
  nextId: number;
  clock: ClockState;
  player: PlayerState;
  /** Ids of servers the player has the address of. */
  knownServers: string[];
  /** The bounce chain being planned for the next connection: relay server ids in order. */
  route: string[];
  connections: Connection[];
  /** Programs that are running right now. */
  tasks: Task[];
  /** The player's inbox, oldest first. */
  messages: Message[];
  contracts: ContractsState;
  /** Log reviews still to come, in no particular order. */
  reviews: Review[];
  /** Names of one-off things that have already happened (e.g. the welcome message was sent). */
  flags: string[];
  /** Changeable state of each server, by server id. */
  servers: Record<string, ServerState>;
}

/** Settings a new game needs. The UI fills these from the content files. */
export interface NewGameOptions {
  seed: number;
  handle: string;
  startDate: string;
  startingBalance: number;
}

/**
 * A new game without any world in it yet. Call syncWithContent (world.ts)
 * on the result before using it.
 */
export function createGame(options: NewGameOptions): GameState {
  const gameTimeMs = Date.parse(options.startDate);
  if (Number.isNaN(gameTimeMs)) throw new RangeError(`createGame: bad start date "${options.startDate}"`);
  return {
    version: STATE_VERSION,
    seed: options.seed >>> 0,
    rngStreams: {},
    nextId: 1,
    clock: { gameTimeMs, speed: 1 },
    player: {
      handle: options.handle,
      balance: options.startingBalance,
      maxConnections: 1,
      programs: [],
      files: [],
      passwords: {},
      rating: 0,
      lieLowUntilMs: 0,
    },
    knownServers: [],
    route: [],
    connections: [],
    tasks: [],
    messages: [],
    contracts: { activeId: null, completed: [] },
    reviews: [],
    flags: [],
    servers: {},
  };
}

/** True while any connection is open. Time is then locked to real time. */
export function isConnected(state: GameState): boolean {
  return state.connections.length > 0;
}
