/**
 * Turning a game into save-file text and back.
 *
 * A save is JSON with a small header (so the slot list can show who and
 * when without loading the game) and the full GameState. Where the text
 * is stored (browser storage, a downloaded file) is the UI's business.
 */
import { ROLES } from '../content/schema';
import { SPEEDS, STATE_VERSION, type GameState } from './state';

export const SAVE_FORMAT = 'project-null-save';

export interface SaveSummary {
  readonly handle: string;
  readonly balance: number;
  /** In-game date and time of the save (ms since 1970, UTC). */
  readonly gameTimeMs: number;
  /** Real date and time of the save (ISO 8601). */
  readonly savedAt: string;
}

export interface SaveFile {
  readonly format: typeof SAVE_FORMAT;
  /** Version of the state inside. */
  readonly version: number;
  readonly summary: SaveSummary;
  readonly state: unknown;
}

/** Thrown when a save can't be read. The message is safe to show the player. */
export class SaveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SaveError';
  }
}

/**
 * One step that upgrades a saved state from the version in its key to the
 * next version. Add one each time STATE_VERSION goes up, and never remove
 * old ones, so old saves keep loading.
 */
export type Migration = (old: Record<string, unknown>) => Record<string, unknown>;

export const MIGRATIONS: Readonly<Record<number, Migration>> = {
  // 1 -> 2: connecting was added. Version 1 never had an open connection.
  1: (old) => ({
    ...old,
    nextId: 1,
    player: { ...(old.player as Record<string, unknown>), maxConnections: 1 },
    knownServers: [],
    route: [],
    connections: [],
    servers: {},
  }),
};

export function summarize(state: GameState, savedAt: string): SaveSummary {
  return {
    handle: state.player.handle,
    balance: state.player.balance,
    gameTimeMs: state.clock.gameTimeMs,
    savedAt,
  };
}

/** `savedAt` is the real date and time as ISO text; the caller supplies it. */
export function serializeGame(state: GameState, savedAt: string): string {
  const file: SaveFile = {
    format: SAVE_FORMAT,
    version: state.version,
    summary: summarize(state, savedAt),
    state,
  };
  return JSON.stringify(file);
}

export interface LoadedGame {
  readonly state: GameState;
  readonly summary: SaveSummary;
}

export function deserializeGame(
  text: string,
  migrations: Readonly<Record<number, Migration>> = MIGRATIONS,
  currentVersion: number = STATE_VERSION,
): LoadedGame {
  let file: unknown;
  try {
    file = JSON.parse(text);
  } catch {
    throw new SaveError('This file is not a Project Null save.');
  }
  if (!isObj(file) || file.format !== SAVE_FORMAT || !isObj(file.state)) {
    throw new SaveError('This file is not a Project Null save.');
  }
  const version = file.version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 0) {
    throw new SaveError('This save is damaged (no version).');
  }
  if (version > currentVersion) {
    throw new SaveError('This save is from a newer version of the game.');
  }

  let raw = file.state;
  for (let v = version; v < currentVersion; v++) {
    const migrate = migrations[v];
    if (!migrate) throw new SaveError('This save is too old to load.');
    raw = migrate(raw);
  }
  raw.version = currentVersion;

  const state = checkState(raw);
  const savedAt = isObj(file.summary) && typeof file.summary.savedAt === 'string' ? file.summary.savedAt : '';
  return { state, summary: summarize(state, savedAt) };
}

/** Reads only the header of a save, for the slot list. Null if unreadable. */
export function readSummary(text: string): SaveSummary | null {
  try {
    return deserializeGame(text).summary;
  } catch {
    return null;
  }
}

type Obj = Record<string, unknown>;

function isObj(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const isNum = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

const isText = (value: unknown): value is string => typeof value === 'string';
const isList = <T,>(value: unknown, item: (entry: unknown) => entry is T): value is T[] =>
  Array.isArray(value) && value.every(item);
const isRole = (value: unknown) => (ROLES as readonly unknown[]).includes(value);

const isConnection = (c: unknown): c is Obj =>
  isObj(c) &&
  isText(c.id) &&
  isText(c.serverId) &&
  isList(c.route, isText) &&
  isNum(c.openedAtMs) &&
  ((c.user === null && c.role === null) || (isText(c.user) && isRole(c.role)));

const isServerState = (s: unknown): s is Obj =>
  isObj(s) &&
  isList(s.files, (f): f is Obj => isObj(f) && isText(f.name) && isNum(f.sizeGq) && isRole(f.access)) &&
  isList(s.logs, (l): l is Obj => isObj(l) && isNum(l.timeMs) && isText(l.text) && typeof l.byPlayer === 'boolean') &&
  isList(s.records, (row): row is string[] => isList(row, isText));

function checkState(raw: Obj): GameState {
  const damaged = new SaveError('This save is damaged.');
  const { clock, player, rngStreams, servers } = raw;

  if (!isNum(raw.seed) || !isNum(raw.nextId)) throw damaged;
  if (!isObj(clock) || !isNum(clock.gameTimeMs) || !(SPEEDS as readonly unknown[]).includes(clock.speed)) {
    throw damaged;
  }
  if (!isObj(player) || !isText(player.handle) || !isNum(player.balance) || !isNum(player.maxConnections)) {
    throw damaged;
  }
  if (!isObj(rngStreams) || !Object.values(rngStreams).every(isNum)) throw damaged;
  if (!isList(raw.knownServers, isText) || !isList(raw.route, isText)) throw damaged;
  if (!isList(raw.connections, isConnection)) throw damaged;
  if (!isObj(servers) || !Object.values(servers).every(isServerState)) throw damaged;
  return raw as unknown as GameState;
}
