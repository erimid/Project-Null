/**
 * The shapes of the game's data files, and checks that the files match.
 *
 * Data files are plain JSON so they survive an engine change. The checks
 * run when the game starts and in the unit tests, so a typo in a data
 * file fails loudly instead of causing a strange bug in play.
 */

export const SERVER_KINDS = ['gateway', 'directory', 'board', 'relay', 'company'] as const;
export type ServerKind = (typeof SERVER_KINDS)[number];

export interface ServerDef {
  /** Stable id used in saves and other data files. Never shown to the player. */
  readonly id: string;
  readonly name: string;
  readonly kind: ServerKind;
  /** Who runs the server, as the player would see it. */
  readonly owner: string;
  /** Network address shown in the UI. */
  readonly address: string;
  readonly city: string;
  readonly country: string;
  /** Degrees north (negative = south). Used to place the server on the globe. */
  readonly lat: number;
  /** Degrees east (negative = west). */
  readonly lon: number;
  /** One line describing the server. */
  readonly blurb: string;
}

export interface Tuning {
  /** Date and time a new game starts at (ISO 8601, UTC). */
  readonly startDate: string;
  /** How fast the game clock runs at 1× speed. */
  readonly gameMinutesPerRealSecond: number;
  /** Money a new player starts with. */
  readonly startingBalance: number;
  /** How often the game saves itself, in real seconds. */
  readonly autosaveSeconds: number;
}

export interface GameInfo {
  /** Working title shown in the UI. */
  readonly title: string;
  /** Player handle used until the player picks one. */
  readonly defaultHandle: string;
  /** Letter shown after money amounts, e.g. "12,880c". */
  readonly currencySuffix: string;
}

export class ContentError extends Error {
  constructor(file: string, problem: string) {
    super(`${file}: ${problem}`);
    this.name = 'ContentError';
  }
}

type Obj = Record<string, unknown>;

function isObj(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(file: string, where: string, obj: Obj, key: string): string {
  const value = obj[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ContentError(file, `${where} needs a non-empty text "${key}"`);
  }
  return value;
}

function num(file: string, where: string, obj: Obj, key: string, min: number, max: number): number {
  const value = obj[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new ContentError(file, `${where} needs a number "${key}" between ${min} and ${max}`);
  }
  return value;
}

const ADDRESS = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

export function parseServers(data: unknown, file = 'servers.json'): ServerDef[] {
  if (!Array.isArray(data)) throw new ContentError(file, 'must be a list of servers');
  const seenIds = new Set<string>();
  const seenAddresses = new Set<string>();

  const servers = data.map((raw, index): ServerDef => {
    if (!isObj(raw)) throw new ContentError(file, `entry ${index} must be an object`);
    const id = text(file, `entry ${index}`, raw, 'id');
    const where = `server "${id}"`;
    if (!/^[a-z0-9-]+$/.test(id)) throw new ContentError(file, `${where}: id may only use a-z, 0-9 and -`);
    if (seenIds.has(id)) throw new ContentError(file, `${where}: id is used twice`);
    seenIds.add(id);

    const kind = text(file, where, raw, 'kind');
    if (!(SERVER_KINDS as readonly string[]).includes(kind)) {
      throw new ContentError(file, `${where}: kind "${kind}" is not one of ${SERVER_KINDS.join(', ')}`);
    }

    const address = text(file, where, raw, 'address');
    const octets = ADDRESS.exec(address);
    if (!octets || octets.slice(1).some((part) => Number(part) > 255)) {
      throw new ContentError(file, `${where}: address "${address}" is not a valid network address`);
    }
    if (seenAddresses.has(address)) throw new ContentError(file, `${where}: address is used twice`);
    seenAddresses.add(address);

    return {
      id,
      name: text(file, where, raw, 'name'),
      kind: kind as ServerKind,
      owner: text(file, where, raw, 'owner'),
      address,
      city: text(file, where, raw, 'city'),
      country: text(file, where, raw, 'country'),
      lat: num(file, where, raw, 'lat', -90, 90),
      lon: num(file, where, raw, 'lon', -180, 180),
      blurb: text(file, where, raw, 'blurb'),
    };
  });

  const gateways = servers.filter((server) => server.kind === 'gateway');
  if (gateways.length !== 1) {
    throw new ContentError(file, `needs exactly one gateway server, found ${gateways.length}`);
  }
  return servers;
}

export function parseTuning(data: unknown, file = 'tuning.json'): Tuning {
  if (!isObj(data)) throw new ContentError(file, 'must be an object');
  const startDate = text(file, 'tuning', data, 'startDate');
  if (Number.isNaN(Date.parse(startDate))) {
    throw new ContentError(file, `startDate "${startDate}" is not a date`);
  }
  return {
    startDate,
    gameMinutesPerRealSecond: num(file, 'tuning', data, 'gameMinutesPerRealSecond', 0.01, 1440),
    startingBalance: num(file, 'tuning', data, 'startingBalance', 0, 1_000_000_000),
    autosaveSeconds: num(file, 'tuning', data, 'autosaveSeconds', 5, 3600),
  };
}

export function parseGameInfo(data: unknown, file = 'game.json'): GameInfo {
  if (!isObj(data)) throw new ContentError(file, 'must be an object');
  return {
    title: text(file, 'game', data, 'title'),
    defaultHandle: text(file, 'game', data, 'defaultHandle'),
    currencySuffix: text(file, 'game', data, 'currencySuffix'),
  };
}
