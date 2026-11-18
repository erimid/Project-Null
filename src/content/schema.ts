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
  /** Machine name shown on its login screen, e.g. "HB-REC-02". */
  readonly hostname: string;
  /** True if the Open Relay Registry lists this server's address. */
  readonly listed: boolean;
  /** Lines of text shown on the login screen. */
  readonly banner: readonly string[];
  readonly accounts: readonly AccountDef[];
  /** Files on the server when a new game starts. */
  readonly files: readonly FileDef[];
  /** Access log entries that already exist when a new game starts. */
  readonly logs: readonly LogDef[];
  /** An optional table of records (students, claims, ...) that jobs can change. */
  readonly records?: RecordsDef;
}

export const ROLES = ['guest', 'admin'] as const;
/** guest = public access; admin = full access. */
export type Role = (typeof ROLES)[number];

export interface AccountDef {
  /** Login name, e.g. "admin". */
  readonly user: string;
  readonly role: Role;
  /** Who the account belongs to, as shown on the login screen. */
  readonly name: string;
}

export interface FileDef {
  readonly name: string;
  /** Size in gigaquads, the game's storage unit. */
  readonly sizeGq: number;
  /** Lowest role that can see the file. */
  readonly access: Role;
}

export interface LogDef {
  /** How long before the start of the game the entry was written. */
  readonly minutesAgo: number;
  readonly text: string;
}

export interface RecordsDef {
  readonly title: string;
  readonly columns: readonly string[];
  readonly rows: readonly (readonly string[])[];
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
  /** Ids of the servers a new player already has the address of. */
  readonly startingServers: readonly string[];
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

function list(file: string, where: string, obj: Obj, key: string): unknown[] {
  const value = obj[key];
  if (!Array.isArray(value)) throw new ContentError(file, `${where} needs a list "${key}"`);
  return value;
}

function entry(file: string, where: string, value: unknown): Obj {
  if (!isObj(value)) throw new ContentError(file, `${where} must be an object`);
  return value;
}

function role(file: string, where: string, obj: Obj, key: string): Role {
  const value = text(file, where, obj, key);
  if (!(ROLES as readonly string[]).includes(value)) {
    throw new ContentError(file, `${where}: ${key} "${value}" is not one of ${ROLES.join(', ')}`);
  }
  return value as Role;
}

function unique(file: string, where: string, what: string, values: string[]): void {
  const repeated = values.find((value, index) => values.indexOf(value) !== index);
  if (repeated !== undefined) throw new ContentError(file, `${where}: ${what} "${repeated}" appears twice`);
}

function parseRecords(file: string, where: string, value: unknown): RecordsDef {
  const raw = entry(file, `${where} records`, value);
  const columns = list(file, `${where} records`, raw, 'columns');
  const rows = list(file, `${where} records`, raw, 'rows');
  if (columns.length === 0 || !columns.every((c) => typeof c === 'string')) {
    throw new ContentError(file, `${where}: records need text column names`);
  }
  rows.forEach((row, index) => {
    if (!Array.isArray(row) || row.length !== columns.length || !row.every((c) => typeof c === 'string')) {
      throw new ContentError(file, `${where}: record row ${index} must have ${columns.length} text values`);
    }
  });
  unique(file, where, 'record', (rows as string[][]).map((row) => row[0] ?? ''));
  return { title: text(file, `${where} records`, raw, 'title'), columns: columns as string[], rows: rows as string[][] };
}

const ADDRESS = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function flag(file: string, where: string, obj: Obj, key: string): boolean {
  const value = obj[key];
  if (typeof value !== 'boolean') throw new ContentError(file, `${where} needs true or false for "${key}"`);
  return value;
}

function parseAccounts(file: string, where: string, raw: Obj, kind: ServerKind): AccountDef[] {
  const accounts = list(file, where, raw, 'accounts').map((value, i) => {
    const account = entry(file, `${where} account ${i}`, value);
    return {
      user: text(file, `${where} account ${i}`, account, 'user'),
      role: role(file, `${where} account ${i}`, account, 'role'),
      name: text(file, `${where} account ${i}`, account, 'name'),
    };
  });
  unique(file, where, 'account', accounts.map((account) => account.user));
  if (kind !== 'gateway' && accounts.length === 0) {
    throw new ContentError(file, `${where} needs at least one account to log in with`);
  }
  return accounts;
}

function parseFiles(file: string, where: string, raw: Obj): FileDef[] {
  const files = list(file, where, raw, 'files').map((value, i) => {
    const item = entry(file, `${where} file ${i}`, value);
    return {
      name: text(file, `${where} file ${i}`, item, 'name'),
      sizeGq: num(file, `${where} file ${i}`, item, 'sizeGq', 1, 1000),
      access: role(file, `${where} file ${i}`, item, 'access'),
    };
  });
  unique(file, where, 'file', files.map((item) => item.name));
  return files;
}

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
      hostname: text(file, where, raw, 'hostname'),
      listed: flag(file, where, raw, 'listed'),
      banner: list(file, where, raw, 'banner').map((line) => {
        if (typeof line !== 'string') throw new ContentError(file, `${where}: banner lines must be text`);
        return line;
      }),
      accounts: parseAccounts(file, where, raw, kind as ServerKind),
      files: parseFiles(file, where, raw),
      logs: list(file, where, raw, 'logs').map((value, i) => {
        const log = entry(file, `${where} log ${i}`, value);
        return {
          minutesAgo: num(file, `${where} log ${i}`, log, 'minutesAgo', 0, 1_000_000),
          text: text(file, `${where} log ${i}`, log, 'text'),
        };
      }),
      ...(raw.records === undefined ? {} : { records: parseRecords(file, where, raw.records) }),
    };
  });

  const gateways = servers.filter((server) => server.kind === 'gateway');
  if (gateways.length !== 1) {
    throw new ContentError(file, `needs exactly one gateway server, found ${gateways.length}`);
  }
  return servers;
}

/** Checks that the data files agree with each other. */
export function checkContent(info: GameInfo, servers: readonly ServerDef[]): void {
  for (const id of info.startingServers) {
    if (!servers.some((server) => server.id === id)) {
      throw new ContentError('game.json', `startingServers names "${id}", which is not a server`);
    }
  }
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
  const startingServers = list(file, 'game', data, 'startingServers');
  if (!startingServers.every((id) => typeof id === 'string')) {
    throw new ContentError(file, 'startingServers must be a list of server ids');
  }
  return {
    startingServers: startingServers as string[],
    title: text(file, 'game', data, 'title'),
    defaultHandle: text(file, 'game', data, 'defaultHandle'),
    currencySuffix: text(file, 'game', data, 'currencySuffix'),
  };
}
