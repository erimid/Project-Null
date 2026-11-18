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
  /** Strength of each security layer; 0 means the server doesn't have it. */
  readonly security: SecurityDef;
  /** How long this server's trace needs to get past one average relay, in seconds. */
  readonly traceSecondsPerHop: number;
  /** As a relay: how much it slows a trace passing through it (1 = average, 2 = twice as slow). */
  readonly relayDelay: number;
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

export const MAX_LAYER_LEVEL = 5;

export interface SecurityDef {
  /** Protects accounts with the admin role. */
  readonly password: number;
  /** Blocks changes to records and logs. */
  readonly proxy: number;
  /** Blocks copying and deleting files. */
  readonly firewall: number;
  /** How quickly an intrusion is noticed. See monitorGraceSeconds in tuning.json. */
  readonly monitor: number;
}

export const PROGRAM_KINDS = [
  'breakPassword',
  'bypassProxy',
  'bypassFirewall',
  'copyFile',
  'deleteFile',
  'deleteLog',
  'traceTracker',
] as const;
export type ProgramKind = (typeof PROGRAM_KINDS)[number];

export interface ProgramDef {
  readonly id: string;
  readonly name: string;
  /** Short name for the bottom-bar pill. */
  readonly short: string;
  /** What the program does. */
  readonly kind: ProgramKind;
  /** Strength. A higher version is faster and can take on stronger layers. */
  readonly version: number;
  /** Seconds one run takes against a level 1 layer (or, for file programs, before the per-size time). */
  readonly baseSeconds: number;
  /** Extra seconds per gigaquad of file size. 0 for programs that don't handle files. */
  readonly secondsPerGq: number;
  /** What it costs on the market. 0 = not for sale. */
  readonly price: number;
  readonly blurb: string;
}

/** What a contract asks for. */
export type ObjectiveDef =
  /** Copy a file from the target to your gateway. */
  | { readonly kind: 'steal'; readonly file: string }
  /** Delete a file on the target. */
  | { readonly kind: 'destroy'; readonly file: string }
  /** Change one value in the target's records: the row whose first column is `key`. */
  | { readonly kind: 'record'; readonly key: string; readonly column: string; readonly value: string };

export const OBJECTIVE_KINDS = ['steal', 'destroy', 'record'] as const;

export interface ContractDef {
  readonly id: string;
  readonly title: string;
  /** Who is paying, as shown on the board. */
  readonly client: string;
  /** Id of the server the job is on. */
  readonly targetId: string;
  readonly pay: number;
  /** Rating gained for finishing it. */
  readonly rating: number;
  /** Rating needed before the board offers it. */
  readonly minRating: number;
  /** One line for the board. */
  readonly summary: string;
  /** The full brief, in the client's voice. Blank lines separate paragraphs. */
  readonly brief: string;
  readonly objective: ObjectiveDef;
}

/** A message the game sends the player. Text in {braces} is filled in when it is sent. */
export interface MailDef {
  readonly from: string;
  readonly subject: string;
  readonly body: string;
}

/** Messages the rules send by name. Every one must exist in mail.json. */
export const MAIL_KEYS = ['welcome', 'firstAccept', 'firstDelivery', 'paid', 'contractFailed', 'caught', 'review'] as const;
export type MailKey = (typeof MAIL_KEYS)[number];

export interface RatingDef {
  /** Rating points needed for this title. */
  readonly min: number;
  readonly title: string;
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
  /**
   * Seconds between an intrusion and the trace starting, by monitor level
   * (first number = level 0). A monitor level past the end of the list
   * starts the trace the moment you connect.
   */
  readonly monitorGraceSeconds: readonly number[];
  /** How many programs can run at once. */
  readonly maxRunningPrograms: number;
  /** How much the gateway can store, in gigaquads. */
  readonly storageGq: number;
  /** With no relays, the trace takes this fraction of the server's per-hop time. */
  readonly directTraceFactor: number;
  /** In-game hours you can't take contracts after being traced. */
  readonly lieLowHours: number;
  /** Fine for being traced, per level of security on the server that caught you. */
  readonly finePerSecurityLevel: number;
  /** Rating lost for being traced. */
  readonly caughtRatingLoss: number;
  /** How many times one connection can be rerouted around a trace. */
  readonly maxReroutes: number;
  /** In-game hours after an intrusion before the target reads its logs. */
  readonly reviewHours: number;
  /** A fine from a log review is this fraction of the fine for being traced. */
  readonly reviewFineFactor: number;
  /** Port line-up: how close (in degrees) a ring's port must be to the marker to lock. */
  readonly ringToleranceDegrees: number;
  /** Port line-up: seconds a missed lock adds to the bypass. */
  readonly ringMissSeconds: number;
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
  /** Ids of the programs a new player owns. */
  readonly startingPrograms: readonly string[];
  /** Titles for rating levels, lowest first. The first must start at 0. */
  readonly ratings: readonly RatingDef[];
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

function parseSecurity(file: string, where: string, value: unknown): SecurityDef {
  const raw = entry(file, `${where} security`, value);
  const level = (key: string) => {
    const n = num(file, `${where} security`, raw, key, 0, MAX_LAYER_LEVEL);
    if (!Number.isInteger(n)) throw new ContentError(file, `${where} security: ${key} must be a whole number`);
    return n;
  };
  return { password: level('password'), proxy: level('proxy'), firewall: level('firewall'), monitor: level('monitor') };
}

export function parsePrograms(data: unknown, file = 'programs.json'): ProgramDef[] {
  if (!Array.isArray(data)) throw new ContentError(file, 'must be a list of programs');
  const programs = data.map((value, index): ProgramDef => {
    const raw = entry(file, `entry ${index}`, value);
    const id = text(file, `entry ${index}`, raw, 'id');
    const where = `program "${id}"`;
    const kind = text(file, where, raw, 'kind');
    if (!(PROGRAM_KINDS as readonly string[]).includes(kind)) {
      throw new ContentError(file, `${where}: kind "${kind}" is not one of ${PROGRAM_KINDS.join(', ')}`);
    }
    return {
      id,
      name: text(file, where, raw, 'name'),
      short: text(file, where, raw, 'short'),
      kind: kind as ProgramKind,
      version: num(file, where, raw, 'version', 1, 20),
      baseSeconds: num(file, where, raw, 'baseSeconds', 0, 3600),
      secondsPerGq: num(file, where, raw, 'secondsPerGq', 0, 600),
      price: num(file, where, raw, 'price', 0, 1_000_000),
      blurb: text(file, where, raw, 'blurb'),
    };
  });
  unique(file, 'programs', 'id', programs.map((program) => program.id));
  return programs;
}

export function parseContracts(data: unknown, file = 'contracts.json'): ContractDef[] {
  if (!Array.isArray(data)) throw new ContentError(file, 'must be a list of contracts');
  const contracts = data.map((value, index): ContractDef => {
    const raw = entry(file, `entry ${index}`, value);
    const id = text(file, `entry ${index}`, raw, 'id');
    const where = `contract "${id}"`;
    const goal = entry(file, `${where} objective`, raw.objective);
    const kind = text(file, `${where} objective`, goal, 'kind');
    let objective: ObjectiveDef;
    if (kind === 'steal' || kind === 'destroy') {
      objective = { kind, file: text(file, `${where} objective`, goal, 'file') };
    } else if (kind === 'record') {
      objective = {
        kind,
        key: text(file, `${where} objective`, goal, 'key'),
        column: text(file, `${where} objective`, goal, 'column'),
        value: text(file, `${where} objective`, goal, 'value'),
      };
    } else {
      throw new ContentError(file, `${where}: objective kind "${kind}" is not one of ${OBJECTIVE_KINDS.join(', ')}`);
    }
    return {
      id,
      title: text(file, where, raw, 'title'),
      client: text(file, where, raw, 'client'),
      targetId: text(file, where, raw, 'targetId'),
      pay: num(file, where, raw, 'pay', 1, 10_000_000),
      rating: num(file, where, raw, 'rating', 0, 100),
      minRating: num(file, where, raw, 'minRating', 0, 1000),
      summary: text(file, where, raw, 'summary'),
      brief: text(file, where, raw, 'brief'),
      objective,
    };
  });
  unique(file, 'contracts', 'id', contracts.map((contract) => contract.id));
  return contracts;
}

export function parseMail(data: unknown, file = 'mail.json'): Record<MailKey, MailDef> {
  if (!isObj(data)) throw new ContentError(file, 'must be an object');
  const mail = {} as Record<MailKey, MailDef>;
  for (const key of MAIL_KEYS) {
    const raw = entry(file, `message "${key}"`, data[key]);
    mail[key] = {
      from: text(file, `message "${key}"`, raw, 'from'),
      subject: text(file, `message "${key}"`, raw, 'subject'),
      body: text(file, `message "${key}"`, raw, 'body'),
    };
  }
  return mail;
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
      security: parseSecurity(file, where, raw.security),
      traceSecondsPerHop: num(file, where, raw, 'traceSecondsPerHop', 1, 600),
      relayDelay: num(file, where, raw, 'relayDelay', 0.1, 10),
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
export function checkContent(
  info: GameInfo,
  servers: readonly ServerDef[],
  programs: readonly ProgramDef[],
  contracts: readonly ContractDef[] = [],
): void {
  for (const contract of contracts) {
    const where = `contract "${contract.id}"`;
    const target = servers.find((server) => server.id === contract.targetId);
    if (!target) throw new ContentError('contracts.json', `${where}: target "${contract.targetId}" is not a server`);
    const goal = contract.objective;
    if (goal.kind === 'record') {
      if (!target.records?.columns.includes(goal.column) || goal.column === target.records.columns[0]) {
        throw new ContentError('contracts.json', `${where}: ${target.id} has no changeable records column "${goal.column}"`);
      }
      if (!target.records.rows.some((row) => row[0] === goal.key)) {
        throw new ContentError('contracts.json', `${where}: ${target.id} has no record "${goal.key}"`);
      }
    } else if (!target.files.some((item) => item.name === goal.file)) {
      throw new ContentError('contracts.json', `${where}: ${target.id} has no file "${goal.file}"`);
    }
  }
  if (contracts.length > 0 && !servers.some((server) => server.kind === 'board')) {
    throw new ContentError('servers/', 'there are contracts but no board server to post them on');
  }
  for (const id of info.startingServers) {
    if (!servers.some((server) => server.id === id)) {
      throw new ContentError('game.json', `startingServers names "${id}", which is not a server`);
    }
  }
  for (const id of info.startingPrograms) {
    if (!programs.some((program) => program.id === id)) {
      throw new ContentError('game.json', `startingPrograms names "${id}", which is not a program`);
    }
  }
  for (const server of servers) {
    const hasAdmin = server.accounts.some((account) => account.role === 'admin');
    if (server.security.password > 0 && !hasAdmin) {
      throw new ContentError('servers/', `server "${server.id}" has a password layer but no admin account to protect`);
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
    monitorGraceSeconds: list(file, 'tuning', data, 'monitorGraceSeconds').map((value) => {
      if (typeof value !== 'number' || !(value >= 0)) {
        throw new ContentError(file, 'monitorGraceSeconds must be a list of numbers of seconds');
      }
      return value;
    }),
    maxRunningPrograms: num(file, 'tuning', data, 'maxRunningPrograms', 1, 20),
    storageGq: num(file, 'tuning', data, 'storageGq', 1, 100_000),
    directTraceFactor: num(file, 'tuning', data, 'directTraceFactor', 0.05, 5),
    lieLowHours: num(file, 'tuning', data, 'lieLowHours', 0, 24 * 365),
    finePerSecurityLevel: num(file, 'tuning', data, 'finePerSecurityLevel', 0, 1_000_000),
    caughtRatingLoss: num(file, 'tuning', data, 'caughtRatingLoss', 0, 100),
    maxReroutes: num(file, 'tuning', data, 'maxReroutes', 0, 20),
    reviewHours: num(file, 'tuning', data, 'reviewHours', 0, 24 * 365),
    reviewFineFactor: num(file, 'tuning', data, 'reviewFineFactor', 0, 10),
    ringToleranceDegrees: num(file, 'tuning', data, 'ringToleranceDegrees', 1, 90),
    ringMissSeconds: num(file, 'tuning', data, 'ringMissSeconds', 0, 60),
  };
}

export function parseGameInfo(data: unknown, file = 'game.json'): GameInfo {
  if (!isObj(data)) throw new ContentError(file, 'must be an object');
  const startingServers = list(file, 'game', data, 'startingServers');
  if (!startingServers.every((id) => typeof id === 'string')) {
    throw new ContentError(file, 'startingServers must be a list of server ids');
  }
  const startingPrograms = list(file, 'game', data, 'startingPrograms');
  if (!startingPrograms.every((id) => typeof id === 'string')) {
    throw new ContentError(file, 'startingPrograms must be a list of program ids');
  }
  const ratings = list(file, 'game', data, 'ratings').map((value, index) => {
    const raw = entry(file, `rating ${index}`, value);
    return { min: num(file, `rating ${index}`, raw, 'min', 0, 100_000), title: text(file, `rating ${index}`, raw, 'title') };
  });
  if (ratings[0]?.min !== 0 || ratings.some((rating, index) => index > 0 && rating.min <= ratings[index - 1]!.min)) {
    throw new ContentError(file, 'ratings must start at 0 and go up');
  }
  return {
    ratings,
    startingServers: startingServers as string[],
    startingPrograms: startingPrograms as string[],
    title: text(file, 'game', data, 'title'),
    defaultHandle: text(file, 'game', data, 'defaultHandle'),
    currencySuffix: text(file, 'game', data, 'currencySuffix'),
  };
}
