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
  /** A layer of this server that is run from another server. See ServerLinkDef. */
  readonly link?: ServerLinkDef;
  /** Set only on companies generated for one game: how strong they are (1 to 5) and their line of business. */
  readonly generated?: { readonly tier: number; readonly sector: string };
  /** What this server sells, if it is a shop. A board with no shop is a general store (see shopOf). */
  readonly shop?: ShopDef;
}

/** One line of rare stock a shop may put out for a day at a time. */
export interface RareStockDef {
  readonly kind: 'program' | 'hardware' | 'module';
  readonly id: string;
  /** Grade of a rare module. */
  readonly grade?: number;
  /** Chance (0 to 1) it is on the shelf on any given day. */
  readonly chance: number;
}

/** What a shop stocks. Staples are always in stock; rare lines come and go by the day. */
export interface ShopDef {
  readonly programs: boolean;
  readonly hardware: boolean;
  readonly modules: boolean;
  readonly models: boolean;
  /** If set, only staple programs of these kinds are stocked. Left out, every program is. */
  readonly programKinds?: readonly ProgramKind[];
  /** Program ids this shop never stocks as staples (rare lines can still bring them in). */
  readonly excludePrograms?: readonly string[];
  /** If set, staple programs above this version are not stocked (the best ones are elsewhere). */
  readonly maxVersion?: number;
  /** If set, staple hardware above this tier is not stocked. */
  readonly maxTier?: number;
  /** If set, staple hardware is only stocked for these slots. */
  readonly hardwareSlots?: readonly string[];
  /** If set, staple modules above this grade are not stocked. */
  readonly maxGrade?: number;
  /** False if this shop posts no contracts: it only sells. Left out, a board posts them. */
  readonly contracts?: boolean;
  /** Multiplies every price here. 1 = the list price. */
  readonly priceFactor: number;
  /** Lines that may appear for one day at a time. */
  readonly rare?: readonly RareStockDef[];
}

export const LINK_LAYERS = ['firewall', 'monitor'] as const;
export type LinkLayer = (typeof LINK_LAYERS)[number];

/**
 * One of a server's layers is run from somewhere else. While the player
 * holds an administrator login on that other server, the layer is out of
 * action here: a firewall passes everything, a monitor notices nothing
 * and its trace stands still. It takes two connections at once.
 */
export interface ServerLinkDef {
  /** Id of the server the layer is run from. */
  readonly serverId: string;
  readonly layer: LinkLayer;
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
  'bypassMonitor',
  'decrypt',
  'copyFile',
  'deleteFile',
  'deleteLog',
  'traceTracker',
  'decompile',
  'planRoute',
  'scan',
  'jamTrace',
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
  /** Extra seconds per gigabyte of file size ("Gq" in field names is the old name of the unit). 0 for programs that don't handle files. */
  readonly secondsPerGq: number;
  /** What it costs on the market. 0 = free: a starting program, which the market gives back if you removed it. */
  readonly price: number;
  /** Room it takes on the gateway, in gigabytes. */
  readonly sizeGq: number;
  readonly blurb: string;
}

/** What a contract asks for. */
export type ObjectiveDef =
  /** Copy a file from the target to your gateway. */
  | { readonly kind: 'steal'; readonly file: string }
  /** Delete a file on the target. */
  | { readonly kind: 'destroy'; readonly file: string }
  /** Change one value in the target's records: the row whose first column is `key`. */
  | { readonly kind: 'record'; readonly key: string; readonly column: string; readonly value: string }
  /**
   * Open a file on the target and read it. If it `reveals` a login, the player
   * has that account's password from then on, and the address of its server.
   */
  | { readonly kind: 'read'; readonly file: string; readonly reveals?: { readonly serverId: string; readonly user: string } }
  /** Put a file the client sends you onto the target. It arrives on your gateway when the stage begins. */
  | { readonly kind: 'plant'; readonly file: string; readonly sizeGq: number }
  /**
   * Make the target's access log point at someone else: write a false line
   * naming `who` (from `address`), and leave none of your own lines behind.
   */
  | { readonly kind: 'frame'; readonly who: string; readonly address: string };

export const OBJECTIVE_KINDS = ['steal', 'destroy', 'record', 'read', 'plant', 'frame'] as const;

/** A security layer by name. */
export type LayerName = keyof SecurityDef;
export const LAYER_NAMES = ['password', 'proxy', 'firewall', 'monitor'] as const;

/** Something that changes in the world as a stage begins. */
export type TwistDef =
  /** The stage's target puts a layer up by `by` levels for a while (never past the top level). */
  | { readonly kind: 'raise'; readonly layer: LayerName; readonly by: number }
  /** A file turns up on the stage's target, moved there from another server. */
  | { readonly kind: 'move'; readonly file: string; readonly fromId: string }
  /** For a while, one of the stage target's layers is run from another server (see ServerLinkDef). */
  | { readonly kind: 'link'; readonly layer: LinkLayer; readonly fromId: string }
  /** A new file appears on the stage's target (a note left for the player, a backup copy). */
  | { readonly kind: 'drop'; readonly file: string; readonly sizeGq: number; readonly text?: string; readonly folder?: string };

export const TWIST_KINDS = ['raise', 'move', 'link', 'drop'] as const;

/**
 * One step of a contract after the first. The first step is the
 * contract's own targetId and objective.
 */
export interface StageDef {
  readonly targetId: string;
  readonly objective: ObjectiveDef;
  /** What the client writes as this stage begins. Blank lines separate paragraphs. */
  readonly brief?: string;
  /** In-game minutes this stage may take once it begins. Missed, the contract is lost. */
  readonly withinMinutes?: number;
  readonly twists?: readonly TwistDef[];
}

/** One way to finish a contract, when the brief offers more than one. */
export interface ChoiceDef {
  readonly id: string;
  /** What the button says, e.g. "Sell to the rival". */
  readonly label: string;
  /** One line on what it means. */
  readonly note: string;
  readonly pay: number;
  /** Rating it adds; may be negative. */
  readonly rating: number;
  /** True to keep what was taken instead of handing it over. */
  readonly keep?: boolean;
  /** The message that comes back, if not the usual one. */
  readonly reply?: { readonly from: string; readonly subject: string; readonly body: string };
}

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
  /** In-game minutes the first stage may take once the contract is taken. */
  readonly withinMinutes?: number;
  /** What changes in the world as the contract is taken (see StageDef). */
  readonly twists?: readonly TwistDef[];
  /** Steps after the first, in order. Missing = a one-step job. */
  readonly stages?: readonly StageDef[];
  /** Other ways to finish it, offered at delivery beside the usual one. */
  readonly choices?: readonly ChoiceDef[];
  /** A module paid on top of the credits. */
  readonly part?: PartDef;
  /** True for a story mission. The board never offers it on its own; the story director does (see core/story.ts). */
  readonly story?: boolean;
}

/** A message the game sends the player. Text in {braces} is filled in when it is sent. */
export interface MailDef {
  readonly from: string;
  readonly subject: string;
  readonly body: string;
}

/** Messages the rules send by name. Every one must exist in mail.json. */
export const MAIL_KEYS = ['welcome', 'firstAccept', 'firstDelivery', 'paid', 'contractFailed', 'caught', 'review', 'harderSecurity', 'phishing', 'phishRefused', 'phishReported', 'models', 'modelExpired', 'hardware', 'hardwareLost', 'jobs', 'links', 'skills', 'workbench', 'decompiling', 'routes', 'stages', 'stageNote', 'contractLate', 'defence', 'raid', 'raidWon', 'raidLost', 'raidFled', 'shops', 'gear'] as const;
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
  /** Size in gigabytes. ("Gq" in field names is the old name of the unit; saves use it, so it stays.) */
  readonly sizeGq: number;
  /** Lowest role that can see the file. */
  readonly access: Role;
  /** Level of the encryption on it. Missing = readable. A copy stays encrypted until a Decrypter has run on it. */
  readonly encrypted?: number;
  /** What you get when you open the file. Files without it show as raw data. */
  readonly content?: FileContent;
  /** A module installer: copying it home adds this module to the player's parts, once. */
  readonly part?: PartDef;
  /** A compiled program: copied home, a Decompiler takes it apart into these. */
  readonly program?: ProgramFileDef;
  /** The folder it sits in, as names separated by "/", e.g. "mail/2034". Missing = the top folder. */
  readonly folder?: string;
}

/** A module and its grade, as data files name one. */
export interface PartDef {
  /** Module id (modules.json). */
  readonly id: string;
  readonly grade: number;
}

/** What decompiling a program file gives. */
export interface ProgramFileDef {
  readonly modules: readonly PartDef[];
  /** A market program it turns out to be a copy of. Installed for free if the player hasn't got it. */
  readonly unlocks?: string;
}

/** One line of a recording, and when it is said. */
export interface CueDef {
  /** Seconds from the start. */
  readonly at: number;
  /** Who is speaking, if anyone is named. */
  readonly who?: string;
  readonly text: string;
}

export const SCENES = ['gate', 'corridor', 'room'] as const;
/** What a camera recording looks at. The picture is drawn by the game. */
export type Scene = (typeof SCENES)[number];

export type FileContent =
  /** Plain text. Blank lines separate paragraphs; single line breaks are kept. */
  | { readonly kind: 'text'; readonly text: string }
  /** A sound recording: voices, with the words shown as they are spoken. */
  | { readonly kind: 'audio'; readonly title: string; readonly seconds: number; readonly lines: readonly CueDef[] }
  /** A camera recording, with notes that appear as it plays. */
  | {
      readonly kind: 'video';
      readonly title: string;
      readonly seconds: number;
      readonly scene: Scene;
      readonly lines: readonly CueDef[];
    };

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
  /** With no relays, the trace takes this fraction of the server's per-hop time. */
  readonly directTraceFactor: number;
  /** A trace step that stays inside one country takes this times as long. */
  readonly sameCountryLegFactor: number;
  /** A trace step that crosses a border inside one part of the world takes this times as long. */
  readonly borderLegFactor: number;
  /** A trace step that crosses to another part of the world takes this times as long. */
  readonly overseasLegFactor: number;
  /** How many trace steps, counting back from the target, take their full time. Later steps are cut by `relayFade`. */
  readonly relayFullSteps: number;
  /** What each trace step after the full ones is worth, in order. Steps past the end of the list use its last value. */
  readonly relayFade: readonly number[];
  /** How much one use of a relay cuts what it adds to a trace: its step is divided by 1 + this times its heat. */
  readonly relayHeatSlow: number;
  /** In-game hours a relay needs to cool by one use. */
  readonly relayCoolHours: number;
  /**
   * What a relay's trace step is worth when the target's monitor outclasses it, by how many levels it falls short:
   * [0 short, 1 short, 2 or more short].
   */
  readonly coverShort: readonly number[];
  /** In-game hours you can't take contracts after being traced. */
  readonly lieLowHours: number;
  /** Share of its pay a standing job gives while the player is lying low. */
  readonly lieLowPayFactor: number;
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
  /** Seconds a Monitor Bypass as strong as the monitor keeps it blind. Each level of difference doubles or halves it. */
  readonly monitorBlindSeconds: number;
  /** Seconds a version 1 Trace Jammer freezes a trace. A stronger jammer freezes for longer. */
  readonly traceJamSeconds: number;
  /** Echo the handshake: repeating the pattern right multiplies the blind time left by this. */
  readonly echoBonusFactor: number;
  /** Echo the handshake: one wrong cell multiplies the blind time left by this. */
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
  /** Rating at which Wren writes about the other shops. */
  readonly shopsAfterRating: number;
  /** Rating at which Wren writes about scanners, jammers and the rest of the specialist kit. */
  readonly gearAfterRating: number;
  /** Each time the player's best rating passes another multiple of this, they earn a skill point. */
  readonly skillPointRating: number;
  /** Credits to unlearn every skill the first time. Each time after costs this much more. */
  readonly unlearnPrice: number;
  /** Seconds the Workbench takes to fit one module, on a stock processor. */
  readonly buildSeconds: number;
  /** Delivered contracts before the fixer writes about the Workbench and sends the first modules. */
  readonly workbenchAfter: number;
  /** Rating needed before the market sells each grade of module, grade 1 first. */
  readonly moduleGradeRatings: readonly number[];
  /** Lowest rating at which a random enemy attack can land. */
  readonly raidMinRating: number;
  /** Least a job must pay before a random attack is considered after it. */
  readonly raidProfilePay: number;
  /** Chance of an attack after a high-profile job (0 to 1). */
  readonly raidChance: number;
  /** In-game hours between random attacks. */
  readonly raidCooldownHours: number;
  /** Seconds the intruder needs to break in, by rival level (level 1 first). */
  readonly raidBreachSeconds: readonly number[];
  /** Seconds a counter-trace needs, by rival level. */
  readonly raidTraceSeconds: readonly number[];
  /** Barriers (ports) before the breach, by rival level. */
  readonly raidBarriers: readonly number[];
  /** Seconds closing a port sets the break-in back. */
  readonly raidPortSetbackSeconds: number;
  /** Each port shut in one attack sets the intruder back this share of what the one before did: they learn. 1 = no fading. */
  readonly raidPortFade: number;
  /** How many files or programs the player can lock during one attack. */
  readonly raidMaxLocks: number;
  /** A thief or framer loss takes this fraction of the balance. */
  readonly raidLossCredits: number;
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
      sizeGq: num(file, where, raw, 'sizeGq', 0, 1000),
      blurb: text(file, where, raw, 'blurb'),
    };
  });
  unique(file, 'programs', 'id', programs.map((program) => program.id));
  return programs;
}

export function parseObjective(file: string, where: string, value: unknown): ObjectiveDef {
  const goal = entry(file, `${where} objective`, value);
  const at = `${where} objective`;
  const kind = text(file, at, goal, 'kind');
  switch (kind) {
    case 'steal':
    case 'destroy':
      return { kind, file: text(file, at, goal, 'file') };
    case 'record':
      return { kind, key: text(file, at, goal, 'key'), column: text(file, at, goal, 'column'), value: text(file, at, goal, 'value') };
    case 'read': {
      const reveals = goal['reveals'];
      if (reveals === undefined) return { kind, file: text(file, at, goal, 'file') };
      const raw = entry(file, `${at} reveals`, reveals);
      return { kind, file: text(file, at, goal, 'file'), reveals: { serverId: text(file, `${at} reveals`, raw, 'serverId'), user: text(file, `${at} reveals`, raw, 'user') } };
    }
    case 'plant':
      return { kind, file: text(file, at, goal, 'file'), sizeGq: num(file, at, goal, 'sizeGq', 1, 1000) };
    case 'frame':
      return { kind, who: text(file, at, goal, 'who'), address: text(file, at, goal, 'address') };
  }
  throw new ContentError(file, `${where}: objective kind "${kind}" is not one of ${OBJECTIVE_KINDS.join(', ')}`);
}

function parseTwist(file: string, where: string, value: unknown): TwistDef {
  const raw = entry(file, `${where} twist`, value);
  const kind = text(file, `${where} twist`, raw, 'kind');
  if (kind === 'raise') {
    const layer = text(file, `${where} twist`, raw, 'layer');
    if (!(LAYER_NAMES as readonly string[]).includes(layer)) throw new ContentError(file, `${where}: twist layer "${layer}" is not one of ${LAYER_NAMES.join(', ')}`);
    return { kind, layer: layer as LayerName, by: num(file, `${where} twist`, raw, 'by', 1, MAX_LAYER_LEVEL) };
  }
  if (kind === 'move') return { kind, file: text(file, `${where} twist`, raw, 'file'), fromId: text(file, `${where} twist`, raw, 'fromId') };
  if (kind === 'link') {
    const layer = text(file, `${where} twist`, raw, 'layer');
    if (!(LINK_LAYERS as readonly string[]).includes(layer)) throw new ContentError(file, `${where}: twist link layer "${layer}" is not one of ${LINK_LAYERS.join(', ')}`);
    return { kind, layer: layer as LinkLayer, fromId: text(file, `${where} twist`, raw, 'fromId') };
  }
  if (kind === 'drop') {
    const body = raw['text'];
    if (body !== undefined && (typeof body !== 'string' || body.trim() === '')) throw new ContentError(file, `${where}: twist text must be text`);
    return {
      kind,
      file: text(file, `${where} twist`, raw, 'file'),
      sizeGq: num(file, `${where} twist`, raw, 'sizeGq', 1, 1000),
      ...(body === undefined ? {} : { text: body as string }),
      ...(raw['folder'] === undefined ? {} : { folder: parseFolder(file, `${where} twist`, raw['folder']) }),
    };
  }
  throw new ContentError(file, `${where}: twist kind "${kind}" is not one of ${TWIST_KINDS.join(', ')}`);
}

export function parseStage(file: string, where: string, value: unknown): StageDef {
  const raw = entry(file, where, value);
  const brief = raw['brief'];
  if (brief !== undefined && (typeof brief !== 'string' || brief.trim() === '')) throw new ContentError(file, `${where}: brief must be text`);
  const twists = raw['twists'] === undefined ? [] : list(file, where, raw, 'twists').map((item) => parseTwist(file, where, item));
  return {
    targetId: text(file, where, raw, 'targetId'),
    objective: parseObjective(file, where, raw['objective']),
    ...(brief === undefined ? {} : { brief: brief as string }),
    ...(raw['withinMinutes'] === undefined ? {} : { withinMinutes: num(file, where, raw, 'withinMinutes', 1, 100_000) }),
    ...(twists.length > 0 ? { twists } : {}),
  };
}

function parseChoice(file: string, where: string, value: unknown): ChoiceDef {
  const raw = entry(file, where, value);
  const reply = raw['reply'];
  let parsedReply: ChoiceDef['reply'];
  if (reply !== undefined) {
    const r = entry(file, `${where} reply`, reply);
    parsedReply = { from: text(file, `${where} reply`, r, 'from'), subject: text(file, `${where} reply`, r, 'subject'), body: text(file, `${where} reply`, r, 'body') };
  }
  return {
    id: text(file, where, raw, 'id'),
    label: text(file, where, raw, 'label'),
    note: text(file, where, raw, 'note'),
    pay: num(file, where, raw, 'pay', 0, 10_000_000),
    rating: num(file, where, raw, 'rating', -100, 100),
    ...(raw['keep'] === undefined ? {} : { keep: flag(file, where, raw, 'keep') }),
    ...(parsedReply ? { reply: parsedReply } : {}),
  };
}

export function parseContracts(data: unknown, file = 'contracts.json'): ContractDef[] {
  if (!Array.isArray(data)) throw new ContentError(file, 'must be a list of contracts');
  const contracts = data.map((value, index): ContractDef => {
    const raw = entry(file, `entry ${index}`, value);
    const id = text(file, `entry ${index}`, raw, 'id');
    const where = `contract "${id}"`;
    const objective = parseObjective(file, where, raw.objective);
    const stages = raw['stages'] === undefined ? undefined : list(file, where, raw, 'stages').map((item, i) => parseStage(file, `${where} stage ${i + 2}`, item));
    const choices = raw['choices'] === undefined ? undefined : list(file, where, raw, 'choices').map((item, i) => parseChoice(file, `${where} choice ${i + 1}`, item));
    if (choices) unique(file, where, 'choice', choices.map((choice) => choice.id));
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
      ...(raw['withinMinutes'] === undefined ? {} : { withinMinutes: num(file, where, raw, 'withinMinutes', 1, 100_000) }),
      ...(raw['twists'] === undefined ? {} : { twists: list(file, where, raw, 'twists').map((item) => parseTwist(file, where, item)) }),
      ...(stages && stages.length > 0 ? { stages } : {}),
      ...(choices && choices.length > 0 ? { choices } : {}),
      ...(raw['part'] === undefined ? {} : { part: parsePart(file, where, raw['part']) }),
      ...(raw['story'] === undefined ? {} : { story: flag(file, where, raw, 'story') }),
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

function parseCues(file: string, where: string, raw: Obj, seconds: number): CueDef[] {
  return list(file, where, raw, 'lines').map((value, i) => {
    const item = entry(file, `${where} line ${i}`, value);
    const who = item['who'];
    if (who !== undefined && typeof who !== 'string') throw new ContentError(file, `${where} line ${i}: "who" must be text`);
    return {
      at: num(file, `${where} line ${i}`, item, 'at', 0, seconds),
      ...(who === undefined ? {} : { who }),
      text: text(file, `${where} line ${i}`, item, 'text'),
    };
  });
}

function parseFileContent(file: string, where: string, value: unknown): FileContent {
  const raw = entry(file, `${where} content`, value);
  const kind = raw['kind'];
  if (kind === 'text') return { kind, text: text(file, where, raw, 'text') };
  if (kind === 'audio' || kind === 'video') {
    const seconds = num(file, where, raw, 'seconds', 1, 600);
    const base = { title: text(file, where, raw, 'title'), seconds, lines: parseCues(file, where, raw, seconds) };
    if (kind === 'audio') return { kind, ...base };
    const scene = raw['scene'];
    if (!(SCENES as readonly unknown[]).includes(scene)) {
      throw new ContentError(file, `${where}: scene must be one of ${SCENES.join(', ')}`);
    }
    return { kind, ...base, scene: scene as Scene };
  }
  throw new ContentError(file, `${where}: content kind must be text, audio or video`);
}

export function parsePart(file: string, where: string, value: unknown): PartDef {
  const raw = entry(file, `${where} part`, value);
  const grade = num(file, `${where} part`, raw, 'grade', 1, 3);
  if (!Number.isInteger(grade)) throw new ContentError(file, `${where}: a part's grade must be 1, 2 or 3`);
  return { id: text(file, `${where} part`, raw, 'id'), grade };
}

export function parseProgramFile(file: string, where: string, value: unknown): ProgramFileDef {
  const raw = entry(file, `${where} program`, value);
  const modules = list(file, `${where} program`, raw, 'modules').map((part) => parsePart(file, where, part));
  if (modules.length === 0) throw new ContentError(file, `${where}: a program file needs at least one module`);
  const unlocks = raw['unlocks'];
  if (unlocks !== undefined && typeof unlocks !== 'string') throw new ContentError(file, `${where}: unlocks must be a program id`);
  return { modules, ...(unlocks !== undefined ? { unlocks } : {}) };
}

function parseFiles(file: string, where: string, raw: Obj): FileDef[] {
  const files = list(file, where, raw, 'files').map((value, i): FileDef => {
    const item = entry(file, `${where} file ${i}`, value);
    const name = text(file, `${where} file ${i}`, item, 'name');
    return {
      name,
      sizeGq: num(file, `${where} file ${i}`, item, 'sizeGq', 1, 1000),
      access: role(file, `${where} file ${i}`, item, 'access'),
      ...(item['encrypted'] === undefined ? {} : { encrypted: num(file, `${where} file "${name}"`, item, 'encrypted', 1, 5) }),
      ...(item['content'] === undefined ? {} : { content: parseFileContent(file, `${where} file "${name}"`, item['content']) }),
      ...(item['part'] === undefined ? {} : { part: parsePart(file, `${where} file "${name}"`, item['part']) }),
      ...(item['program'] === undefined ? {} : { program: parseProgramFile(file, `${where} file "${name}"`, item['program']) }),
      ...(item['folder'] === undefined ? {} : { folder: parseFolder(file, `${where} file "${name}"`, item['folder']) }),
    };
  });
  unique(file, where, 'file', files.map((item) => item.name));
  return files;
}

/** A folder path: names of letters, digits, - _ . and spaces, separated by "/". */
export function parseFolder(file: string, where: string, value: unknown): string {
  if (typeof value !== 'string' || !/^[\w .-]+(\/[\w .-]+)*$/.test(value)) {
    throw new ContentError(file, `${where}: folder must be names separated by "/", e.g. "mail/2034"`);
  }
  return value;
}

function parseLink(file: string, where: string, value: unknown): ServerLinkDef {
  const raw = entry(file, `${where} link`, value);
  const layer = text(file, `${where} link`, raw, 'layer');
  if (!(LINK_LAYERS as readonly string[]).includes(layer)) {
    throw new ContentError(file, `${where}: link layer "${layer}" is not one of ${LINK_LAYERS.join(', ')}`);
  }
  return { serverId: text(file, `${where} link`, raw, 'serverId'), layer: layer as LinkLayer };
}

const RARE_KINDS = ['program', 'hardware', 'module'] as const;

function parseShop(file: string, where: string, value: unknown): ShopDef {
  const raw = entry(file, `${where} shop`, value);
  const flagOr = (key: string, fallback: boolean): boolean => (raw[key] === undefined ? fallback : flag(file, `${where} shop`, raw, key));
  const kinds = raw['programKinds'];
  let programKinds: ProgramKind[] | undefined;
  if (kinds !== undefined) {
    if (!Array.isArray(kinds) || !kinds.every((k) => (PROGRAM_KINDS as readonly unknown[]).includes(k))) {
      throw new ContentError(file, `${where} shop: programKinds must be a list of program kinds`);
    }
    programKinds = kinds as ProgramKind[];
  }
  const slotsRaw = raw['hardwareSlots'];
  let hardwareSlots: string[] | undefined;
  if (slotsRaw !== undefined) {
    if (!Array.isArray(slotsRaw) || !slotsRaw.every((k) => typeof k === 'string')) {
      throw new ContentError(file, `${where} shop: hardwareSlots must be a list of slot names`);
    }
    hardwareSlots = slotsRaw as string[];
  }
  const excludeRaw = raw['excludePrograms'];
  let excluded: string[] | undefined;
  if (excludeRaw !== undefined) {
    if (!Array.isArray(excludeRaw) || !excludeRaw.every((k) => typeof k === 'string')) {
      throw new ContentError(file, `${where} shop: excludePrograms must be a list of program ids`);
    }
    excluded = excludeRaw as string[];
  }
  const rareRaw = raw['rare'];
  let rare: RareStockDef[] | undefined;
  if (rareRaw !== undefined) {
    if (!Array.isArray(rareRaw)) throw new ContentError(file, `${where} shop: rare must be a list`);
    rare = rareRaw.map((item, i): RareStockDef => {
      const line = entry(file, `${where} shop rare ${i}`, item);
      const kind = text(file, `${where} shop rare ${i}`, line, 'kind');
      if (!(RARE_KINDS as readonly string[]).includes(kind)) {
        throw new ContentError(file, `${where} shop rare ${i}: kind "${kind}" is not one of ${RARE_KINDS.join(', ')}`);
      }
      return {
        kind: kind as RareStockDef['kind'],
        id: text(file, `${where} shop rare ${i}`, line, 'id'),
        ...(line['grade'] === undefined ? {} : { grade: num(file, `${where} shop rare ${i}`, line, 'grade', 1, 10) }),
        chance: num(file, `${where} shop rare ${i}`, line, 'chance', 0, 1),
      };
    });
  }
  return {
    programs: flagOr('programs', true),
    hardware: flagOr('hardware', true),
    modules: flagOr('modules', true),
    models: flagOr('models', true),
    ...(programKinds ? { programKinds } : {}),
    ...(raw['maxVersion'] === undefined ? {} : { maxVersion: num(file, `${where} shop`, raw, 'maxVersion', 1, 20) }),
    ...(raw['maxTier'] === undefined ? {} : { maxTier: num(file, `${where} shop`, raw, 'maxTier', 1, 20) }),
    ...(raw['maxGrade'] === undefined ? {} : { maxGrade: num(file, `${where} shop`, raw, 'maxGrade', 1, 10) }),
    ...(hardwareSlots ? { hardwareSlots } : {}),
    ...(excluded ? { excludePrograms: excluded } : {}),
    ...(raw['contracts'] === undefined ? {} : { contracts: flag(file, `${where} shop`, raw, 'contracts') }),
    priceFactor: raw['priceFactor'] === undefined ? 1 : num(file, `${where} shop`, raw, 'priceFactor', 0.1, 10),
    ...(rare ? { rare } : {}),
  };
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
      ...(raw.link === undefined ? {} : { link: parseLink(file, where, raw.link) }),
      ...(raw.shop === undefined ? {} : { shop: parseShop(file, where, raw.shop) }),
    };
  });

  const gateways = servers.filter((server) => server.kind === 'gateway');
  if (gateways.length !== 1) {
    throw new ContentError(file, `needs exactly one gateway server, found ${gateways.length}`);
  }
  return servers;
}

/** Checks one stage of a written contract against the servers. `before` are the stages ahead of it. */
function checkStage(servers: readonly ServerDef[], where: string, stage: StageDef, before: readonly StageDef[]): void {
  const fail = (problem: string) => {
    throw new ContentError('contracts.json', `${where}: ${problem}`);
  };
  const target = servers.find((server) => server.id === stage.targetId);
  if (!target) fail(`target "${stage.targetId}" is not a server`);
  const goal = stage.objective;
  // A file can be planted or moved there by this stage or one before it.
  const arrives = (name: string) =>
    [...before, stage].some(
      (step) =>
        (step.targetId === stage.targetId && step.objective.kind === 'plant' && step.objective.file === name) ||
        (step.targetId === stage.targetId && (step.twists ?? []).some((twist) => (twist.kind === 'move' || twist.kind === 'drop') && twist.file === name)),
    );
  if (goal.kind === 'record') {
    if (!target!.records?.columns.includes(goal.column) || goal.column === target!.records.columns[0]) fail(`${target!.id} has no changeable records column "${goal.column}"`);
    if (!target!.records!.rows.some((row) => row[0] === goal.key)) fail(`${target!.id} has no record "${goal.key}"`);
  } else if (goal.kind === 'steal' || goal.kind === 'destroy' || goal.kind === 'read') {
    if (!target!.files.some((item) => item.name === goal.file) && !arrives(goal.file)) fail(`${target!.id} has no file "${goal.file}"`);
    if (goal.kind === 'read' && goal.reveals) {
      const other = servers.find((server) => server.id === goal.reveals!.serverId);
      if (!other?.accounts.some((account) => account.user === goal.reveals!.user)) fail(`reveals "${goal.reveals.user}" on "${goal.reveals.serverId}", which has no such account`);
    }
  } else if (goal.kind === 'frame') {
    if (target!.security.proxy === 0 && !target!.accounts.some((account) => account.role === 'admin')) fail(`${target!.id} has nobody to log in as`);
  }
  for (const twist of stage.twists ?? []) {
    if (twist.kind === 'move' || twist.kind === 'link') {
      const from = servers.find((server) => server.id === twist.fromId);
      if (!from || from.id === stage.targetId) fail(`twist names "${twist.fromId}", which is not another server`);
      if (twist.kind === 'move' && !from!.files.some((item) => item.name === twist.file)) fail(`twist moves "${twist.file}", which ${twist.fromId} does not have`);
      if (twist.kind === 'link' && !from!.accounts.some((account) => account.role === 'admin')) fail(`${twist.fromId} has no admin account to hold the link with`);
    }
  }
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
    const steps: StageDef[] = [{ targetId: contract.targetId, objective: contract.objective, ...(contract.twists ? { twists: contract.twists } : {}) }, ...(contract.stages ?? [])];
    steps.forEach((stage, index) => checkStage(servers, `${where}${index > 0 ? ` stage ${index + 1}` : ''}`, stage, steps.slice(0, index)));
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
    const link = server.link;
    if (link) {
      const other = servers.find((item) => item.id === link.serverId);
      if (!other || other.id === server.id) throw new ContentError('servers/', `server "${server.id}": link names "${link.serverId}", which is not another server`);
      if (!other.accounts.some((account) => account.role === 'admin')) {
        throw new ContentError('servers/', `server "${server.id}": ${other.id} has no admin account to hold the link with`);
      }
      if (server.security[link.layer] === 0) throw new ContentError('servers/', `server "${server.id}" links its ${link.layer} but has none`);
    }
    const hasAdmin = server.accounts.some((account) => account.role === 'admin');
    if (server.security.password > 0 && !hasAdmin) {
      throw new ContentError('servers/', `server "${server.id}" has a password layer but no admin account to protect`);
    }
  }
}

/** A list of numbers from 0 to 1 in tuning. */
function fractions(file: string, data: Obj, key: string): number[] {
  return list(file, 'tuning', data, key).map((value) => {
    if (typeof value !== 'number' || !(value >= 0 && value <= 1)) {
      throw new ContentError(file, `${key} must be a list of numbers from 0 to 1`);
    }
    return value;
  });
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
    directTraceFactor: num(file, 'tuning', data, 'directTraceFactor', 0.05, 5),
    sameCountryLegFactor: num(file, 'tuning', data, 'sameCountryLegFactor', 0.1, 5),
    borderLegFactor: num(file, 'tuning', data, 'borderLegFactor', 0.1, 5),
    overseasLegFactor: num(file, 'tuning', data, 'overseasLegFactor', 0.1, 5),
    relayFullSteps: num(file, 'tuning', data, 'relayFullSteps', 0, 100),
    relayFade: fractions(file, data, 'relayFade'),
    relayHeatSlow: num(file, 'tuning', data, 'relayHeatSlow', 0, 10),
    relayCoolHours: num(file, 'tuning', data, 'relayCoolHours', 0.01, 24 * 365),
    coverShort: fractions(file, data, 'coverShort'),
    lieLowHours: num(file, 'tuning', data, 'lieLowHours', 0, 24 * 365),
    lieLowPayFactor: num(file, 'tuning', data, 'lieLowPayFactor', 0.1, 1),
    finePerSecurityLevel: num(file, 'tuning', data, 'finePerSecurityLevel', 0, 1_000_000),
    caughtRatingLoss: num(file, 'tuning', data, 'caughtRatingLoss', 0, 100),
    maxReroutes: num(file, 'tuning', data, 'maxReroutes', 0, 20),
    reviewHours: num(file, 'tuning', data, 'reviewHours', 0, 24 * 365),
    reviewFineFactor: num(file, 'tuning', data, 'reviewFineFactor', 0, 10),
    ringToleranceDegrees: num(file, 'tuning', data, 'ringToleranceDegrees', 1, 90),
    ringMissSeconds: num(file, 'tuning', data, 'ringMissSeconds', 0, 60),
    monitorBlindSeconds: num(file, 'tuning', data, 'monitorBlindSeconds', 1, 3600),
    traceJamSeconds: num(file, 'tuning', data, 'traceJamSeconds', 1, 600),
    echoBonusFactor: num(file, 'tuning', data, 'echoBonusFactor', 1, 10),
    echoPenaltyFactor: num(file, 'tuning', data, 'echoPenaltyFactor', 0, 1),
    harderSecurityAfter: num(file, 'tuning', data, 'harderSecurityAfter', 0, 1000),
    phishingAfter: num(file, 'tuning', data, 'phishingAfter', 0, 1000),
    phishReplyMinutes: num(file, 'tuning', data, 'phishReplyMinutes', 1, 100_000),
    phishMaxDetails: num(file, 'tuning', data, 'phishMaxDetails', 1, 10),
    phishWaryHours: num(file, 'tuning', data, 'phishWaryHours', 0, 24 * 365),
    phishStrikes: num(file, 'tuning', data, 'phishStrikes', 1, 20),
    modelsAfter: num(file, 'tuning', data, 'modelsAfter', 0, 1000),
    modelRentHours: num(file, 'tuning', data, 'modelRentHours', 1, 24 * 365),
    modelWatchSeconds: num(file, 'tuning', data, 'modelWatchSeconds', 1, 600),
    hardwareAfter: num(file, 'tuning', data, 'hardwareAfter', 0, 1000),
    hardwareLossLevel: num(file, 'tuning', data, 'hardwareLossLevel', 1, 6),
    boardJobs: num(file, 'tuning', data, 'boardJobs', 0, 20),
    jobHours: num(file, 'tuning', data, 'jobHours', 1, 24 * 365),
    jobPay: tierList(file, data, 'jobPay', false),
    tierRatings: tierList(file, data, 'tierRatings', true),
    jobRatings: tierList(file, data, 'jobRatings', false),
    jobsAfter: num(file, 'tuning', data, 'jobsAfter', 0, 1000),
    linksAfterRating: num(file, 'tuning', data, 'linksAfterRating', 0, 100_000),
    shopsAfterRating: num(file, 'tuning', data, 'shopsAfterRating', 0, 100_000),
    gearAfterRating: num(file, 'tuning', data, 'gearAfterRating', 0, 100_000),
    skillPointRating: num(file, 'tuning', data, 'skillPointRating', 1, 1000),
    unlearnPrice: num(file, 'tuning', data, 'unlearnPrice', 0, 10_000_000),
    buildSeconds: num(file, 'tuning', data, 'buildSeconds', 0, 3600),
    workbenchAfter: num(file, 'tuning', data, 'workbenchAfter', 0, 1000),
    moduleGradeRatings: (() => {
      const values = list(file, 'tuning', data, 'moduleGradeRatings');
      if (values.length !== 3 || values[0] !== 0 || values.some((v, i) => typeof v !== 'number' || (i > 0 && v <= (values[i - 1] as number)))) {
        throw new ContentError(file, 'moduleGradeRatings must be three rising numbers starting at 0');
      }
      return values as number[];
    })(),
    raidMinRating: num(file, 'tuning', data, 'raidMinRating', 0, 100_000),
    raidProfilePay: num(file, 'tuning', data, 'raidProfilePay', 0, 10_000_000),
    raidChance: num(file, 'tuning', data, 'raidChance', 0, 1),
    raidCooldownHours: num(file, 'tuning', data, 'raidCooldownHours', 0, 24 * 365),
    raidBreachSeconds: tierList(file, data, 'raidBreachSeconds', false),
    raidTraceSeconds: tierList(file, data, 'raidTraceSeconds', false),
    raidBarriers: tierList(file, data, 'raidBarriers', false),
    raidPortSetbackSeconds: num(file, 'tuning', data, 'raidPortSetbackSeconds', 0, 3600),
    raidPortFade: num(file, 'tuning', data, 'raidPortFade', 0, 1),
    raidMaxLocks: num(file, 'tuning', data, 'raidMaxLocks', 0, 20),
    raidLossCredits: num(file, 'tuning', data, 'raidLossCredits', 0, 1),
  };
}

/** A list of five numbers, one per company tier. Rising when `rising` is set. */
function tierList(file: string, data: Record<string, unknown>, key: string, rising: boolean): number[] {
  const values = list(file, 'tuning', data, key);
  if (values.length !== 5 || values.some((value) => typeof value !== 'number' || !(value >= 0))) {
    throw new ContentError(file, `${key} must be five numbers, one for each tier`);
  }
  const numbers = values as number[];
  if (rising && (numbers[0] !== 0 || numbers.some((value, index) => index > 0 && value <= numbers[index - 1]!))) {
    throw new ContentError(file, `${key} must start at 0 and go up`);
  }
  return numbers;
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
