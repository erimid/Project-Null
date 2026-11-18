/**
 * The whole game in one plain object. It contains only data (no
 * functions, no class instances), so it can be saved as JSON as it is.
 */

/** Increase this when the shape of GameState changes, and add a migration in save.ts. */
export const STATE_VERSION = 1;

/** 0 = paused. */
export const SPEEDS = [0, 1, 2, 4] as const;
export type Speed = (typeof SPEEDS)[number];

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
}

/**
 * One open connection to a server. Each has its own bounce chain and its
 * own trace. The player starts with one slot, but the game supports
 * several from the start. Filled in when connecting is built.
 */
export interface Connection {
  id: string;
  /** Id of the server at the far end. */
  serverId: string;
}

export interface GameState {
  version: typeof STATE_VERSION;
  /** Seed every random stream is derived from. */
  seed: number;
  /** Saved position of each named random stream (see streams.ts). */
  rngStreams: Record<string, number>;
  clock: ClockState;
  player: PlayerState;
  connections: Connection[];
}

/** Settings a new game needs. The UI fills these from the content files. */
export interface NewGameOptions {
  seed: number;
  handle: string;
  startDate: string;
  startingBalance: number;
}

export function createGame(options: NewGameOptions): GameState {
  const gameTimeMs = Date.parse(options.startDate);
  if (Number.isNaN(gameTimeMs)) throw new RangeError(`createGame: bad start date "${options.startDate}"`);
  return {
    version: STATE_VERSION,
    seed: options.seed >>> 0,
    rngStreams: {},
    clock: { gameTimeMs, speed: 1 },
    player: { handle: options.handle, balance: options.startingBalance },
    connections: [],
  };
}

/** True while any connection is open. Time is then locked to real time. */
export function isConnected(state: GameState): boolean {
  return state.connections.length > 0;
}
