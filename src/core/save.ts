/**
 * Turning a game into save-file text and back.
 *
 * A save is JSON with a small header (so the slot list can show who and
 * when without loading the game) and the full GameState. Where the text
 * is stored (browser storage, a downloaded file) is the UI's business.
 */
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

export const MIGRATIONS: Readonly<Record<number, Migration>> = {};

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

function checkState(raw: Obj): GameState {
  const damaged = new SaveError('This save is damaged.');
  const { clock, player, rngStreams, connections } = raw;

  if (!isNum(raw.seed)) throw damaged;
  if (!isObj(clock) || !isNum(clock.gameTimeMs) || !(SPEEDS as readonly unknown[]).includes(clock.speed)) {
    throw damaged;
  }
  if (!isObj(player) || typeof player.handle !== 'string' || !isNum(player.balance)) throw damaged;
  if (!isObj(rngStreams) || !Object.values(rngStreams).every(isNum)) throw damaged;
  if (
    !Array.isArray(connections) ||
    !connections.every((c) => isObj(c) && typeof c.id === 'string' && typeof c.serverId === 'string')
  ) {
    throw damaged;
  }
  return raw as unknown as GameState;
}
