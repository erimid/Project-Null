/**
 * The whole game in one plain object. It contains only data (no
 * functions, no class instances), so it can be saved as JSON as it is.
 */
import type { ContractDef, Role } from '../content/schema';

/** Increase this when the shape of GameState changes, and add a migration in save.ts. */
export const STATE_VERSION = 14;

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
  /** Tier of the part in each hardware slot (see content/hardware.json). 0 = empty. */
  hardware: HardwareState;
  /** Ids of the programs the player owns. */
  programs: string[];
  /** Files copied to the gateway. */
  files: StoredFile[];
  /** Passwords the player has broken: server id -> the account names they open. */
  passwords: Record<string, string[]>;
  /** Standing on the contracts board. Finished contracts raise it; being traced lowers it. */
  rating: number;
  /** The highest rating the player has ever had. Skill points come from it, so losing rating doesn't take skills away. */
  bestRating: number;
  /** Rank learned in each skill, by skill id (see content/skills.json). Missing = not learned. */
  skills: Record<string, number>;
  /** Times the player has paid to unlearn every skill. Each time costs more. */
  unlearns: number;
  /** Modules on hand, by `module:grade` (see partKey in crafting.ts) -> how many. */
  parts: Record<string, number>;
  /** Programs the player built at the Workbench. Their ids are in `programs` while installed. */
  builds: Build[];
  /** Which installed program runs for each kind, by program kind. Missing = the strongest. */
  preferred: Record<string, string>;
  /** Game time until which the board gives the player no work. 0 = never traced. */
  lieLowUntilMs: number;
  /** Ids of people the player has come across in files. */
  contacts: string[];
  /** Ids of details the player has read in files. */
  facts: string[];
  /** The language model being rented, and the game time the rental runs out. */
  model: { id: string; untilMs: number } | null;
}

/** One module fitted to a crafted program. */
export interface Fitted {
  /** Module id (content/modules.json). */
  id: string;
  grade: number;
}

/** A program built at the Workbench: a program from the market with modules fitted. */
export interface Build {
  /** Its program id, made when it was built (b + a number). */
  id: string;
  /** Id of the market program it was built from. */
  base: string;
  modules: Fitted[];
}

/** Tier installed in each slot of the gateway. */
export interface HardwareState {
  cpu: number;
  storage: number;
  modem: number;
  ports: number;
  /** 0 = no model hosted at home. */
  rack: number;
}

/** A message sent to someone under a borrowed name, waiting for its answer. */
export interface PhishAttempt {
  askId: string;
  /** Game time the answer arrives. */
  dueMs: number;
  /** Whether it will be believed. Decided when it is sent. */
  ok: boolean;
}

export interface PhishState {
  sent: PhishAttempt[];
  /** Times each person has seen through a message, by person id. */
  strikes: Record<string, number>;
  /** Game time until which a person who saw through a message will not read another, by person id. */
  waryUntilMs: Record<string, number>;
  /** Ids of the asks that worked. */
  done: string[];
}

export interface ContractsState {
  /** Id of the contract being worked on, if any. One at a time. */
  activeId: string | null;
  /** Ids of contracts delivered and paid. */
  completed: string[];
  /** Repeatable jobs on the board right now, made for this game (see jobs.ts). */
  jobs: Job[];
}

/** A job the board made up against a generated company. Taken down at `expiresMs` unless it is being worked on. */
export interface Job extends ContractDef {
  /** Game time it comes off the board. */
  readonly expiresMs: number;
}

export interface StoredFile {
  name: string;
  sizeGq: number;
  /** Id of the server it was copied from. */
  from: string;
  /** Level of the encryption on it. Missing = readable. */
  encrypted?: number;
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
  monitor: MonitorState;
}

/**
 * What a Monitor Bypass has done to the far end's monitor on one
 * connection. While `blindMs` is above 0 the monitor notices nothing and
 * a trace that is already running stands still.
 */
export interface MonitorState {
  /** Time the monitor stays blind for. */
  blindMs: number;
  /** True once a bypass has finished on this connection. It works once per connection. */
  used: boolean;
  /** The hands-on way to stretch the blind time, while it is on offer. */
  echo: EchoPuzzle | null;
}

/**
 * Echo the handshake: the monitor's check-in pattern is shown once on a
 * 3 by 3 grid, and the player repeats it. Getting it all right stretches
 * the blind time; one wrong cell shortens it.
 */
export interface EchoPuzzle {
  /** The pattern, as cell numbers 0 to 8, in order. */
  cells: number[];
  /** How many cells the player has repeated correctly so far. */
  entered: number;
  result: 'open' | 'won' | 'lost';
}

/** How many slots there are for saved routes. */
export const ROUTE_SLOTS = 3;

/** A relay's heat as it stood at one moment. One use adds 1. */
export interface RelayHeat {
  heat: number;
  /** Game time `heat` was true. */
  atMs: number;
}

/** What a running program is working on. */
export type TaskTarget =
  | { kind: 'password'; user: string }
  | { kind: 'proxy' }
  | { kind: 'firewall' }
  /** Blind the monitor for a while. */
  | { kind: 'monitor' }
  /** Decrypt a file stored on the gateway. Runs at home, not over a connection. */
  | { kind: 'decrypt'; file: string }
  | { kind: 'copyFile'; file: string }
  | { kind: 'deleteFile'; file: string }
  /** Remove one or more lines from the access log in a single run. */
  | { kind: 'deleteLog'; logIds: number[] }
  /** Take a program file stored on the gateway apart into modules. Runs at home. */
  | { kind: 'decompile'; file: string }
  /** Build a crafted program at the Workbench. Runs at home. Its modules are taken when it starts. */
  | { kind: 'build'; base: string; modules: Fitted[] };

/** A program that is running, against a connection or (connectionId null) on the gateway itself. */
export interface Task {
  id: string;
  programId: string;
  connectionId: string | null;
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
 * locking them all finishes it. Left alone, the program locks them one
 * at a time as their ports come round, so it too ends on the marker. Where a ring is depends only on how long
 * the task has run, so it needs no state of its own.
 */
export interface RingPuzzle {
  /** Where each ring's port was when the task started, in degrees. */
  startAngles: number[];
  /** Degrees per second; negative turns the other way. */
  speeds: number[];
  locked: boolean[];
  /**
   * When (in the task's own running time) the program will lock the next
   * ring by itself. Always a moment that ring's port is under the marker.
   */
  autoAtMs?: number;
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
  /** Level of the encryption on it. Missing = readable. */
  encrypted?: number;
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
  /** Servers the player has starred in the address book, in the order they were starred. */
  bookmarks: string[];
  /** The bounce chain being planned for the next connection: relay server ids in order. */
  route: string[];
  /** Routes the player has kept to load again, one per slot. An empty list is an empty slot. */
  savedRoutes: string[][];
  /** How warm each relay is from recent use, by server id. Cools with game time. */
  relayHeat: Record<string, RelayHeat>;
  connections: Connection[];
  /** Programs that are running right now. */
  tasks: Task[];
  /** The player's inbox, oldest first. */
  messages: Message[];
  contracts: ContractsState;
  phish: PhishState;
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
      hardware: { cpu: 1, storage: 1, modem: 1, ports: 1, rack: 0 },
      programs: [],
      files: [],
      passwords: {},
      rating: 0,
      bestRating: 0,
      skills: {},
      unlearns: 0,
      parts: {},
      builds: [],
      preferred: {},
      lieLowUntilMs: 0,
      contacts: [],
      facts: [],
      model: null,
    },
    knownServers: [],
    bookmarks: [],
    savedRoutes: Array.from({ length: ROUTE_SLOTS }, () => []),
    relayHeat: {},
    route: [],
    connections: [],
    tasks: [],
    messages: [],
    contracts: { activeId: null, completed: [], jobs: [] },
    phish: { sent: [], strikes: {}, waryUntilMs: {}, done: [] },
    reviews: [],
    flags: [],
    servers: {},
  };
}

/** True while any connection is open. Time is then locked to real time. */
export function isConnected(state: GameState): boolean {
  return state.connections.length > 0;
}
