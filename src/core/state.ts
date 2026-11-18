/**
 * The whole game in one plain object. It contains only data (no
 * functions, no class instances), so it can be saved as JSON as it is.
 */
import type { Role } from '../content/schema';

/** Increase this when the shape of GameState changes, and add a migration in save.ts. */
export const STATE_VERSION = 2;

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
}

export interface FileState {
  name: string;
  sizeGq: number;
  access: Role;
}

export interface LogEntry {
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
    player: { handle: options.handle, balance: options.startingBalance, maxConnections: 1 },
    knownServers: [],
    route: [],
    connections: [],
    servers: {},
  };
}

/** True while any connection is open. Time is then locked to real time. */
export function isConnected(state: GameState): boolean {
  return state.connections.length > 0;
}
