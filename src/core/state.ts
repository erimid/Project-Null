/**
 * The whole game in one plain object. It contains only data (no
 * functions, no class instances), so it can be saved as JSON as it is.
 */
import type { ContractDef, Role } from '../content/schema';

/** Increase this when the shape of GameState changes, and add a migration in save.ts. */
export const STATE_VERSION = 29;

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
  /** Ids of the programs loaded into memory: the ones that can run over a connection (see loadout.ts). */
  loadout: string[];
  /** Loadouts the player has kept to load again, one per slot. An empty list is an empty slot. */
  savedLoadouts: string[][];
  /** Game time until which the board gives the player no work. 0 = never traced. */
  lieLowUntilMs: number;
  /** Ids of the property the player has bought (see assets.ts). */
  assets: string[];
  /** Legend contracts delivered. */
  legends: number;
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
  /** Room for loaded programs. */
  memory: number;
  storage: number;
  modem: number;
  ports: number;
  /** 0 = no model hosted at home. */
  rack: number;
  /** 0 = no trace sensor fitted. */
  sensor: number;
  /** 0 = no cooler fitted. */
  cooling: number;
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
  /** Which stage of the active contract is being worked on: 0 = the first. */
  stage: number;
  /** Game time the current stage began. */
  stageStartMs: number;
  /** How long the player has held the current stage's target, for a guard or stay-in job (see kinds.ts). */
  heldMs: number;
  /** The attack on a server the player is guarding, once it has begun. */
  guard: GuardState | null;
  /** Game time a rival on the same job gets there first, for a race. 0 = no race. */
  raceUntilMs: number;
  /** The heist under way, as it was planned when taken (see heists.ts), or null. */
  heist: ActiveHeist | null;
  /** Written heists that were burned: never offered again. */
  burned: string[];
  /** The edition day the board last thought about posting a heist. */
  heistDay: number;
  /** The game day the board last posted a legend contract (see legend.ts). */
  legendDay: number;
}

/** A heist being worked on: the vault and who holds which of its layers. */
export interface ActiveHeist {
  vaultId: string;
  holds: { targetId: string; layer: 'firewall' | 'monitor' | 'proxy'; ally?: string }[];
  /** Traces run this many times slower while it is under way, from help the player earned. Missing = 1. */
  slow?: number;
}

/** A rival breaking into a server the player is guarding: the gateway defence, from the other side. */
export interface GuardState {
  /** How far the intruder has got, in ms. */
  breachMs: number;
  /** Time they need to break all the way in. */
  totalMs: number;
  /** The port line-up the player has open to shut them out, or null. */
  port: RaidPort | null;
  /** Ports shut so far. Each sets them back less than the last. */
  shut: number;
}

/** Where one story line has got to (see core/story.ts). */
export interface StoryLineState {
  /** Index of the beat the line is waiting on. Equal to the number of its beats once the line is over. */
  beat: number;
  /** Whether the current beat has already arrived (its message sent, its contract posted). */
  arrived: boolean;
  /** Game time the current beat arrived, or the last one passed, or the line opened: the clock the next beat's spacing counts from. */
  lastMs: number;
  /** True once the current beat's timed turn has fired. */
  lapsed?: boolean;
}

/** How far the player has got through the story, and which story contracts are on the board (see core/story.ts). */
export interface StoryState {
  /** Each line that has opened, by line id. A line missing here has not opened yet. */
  lines: Record<string, StoryLineState>;
  /** Ids of story contracts the director has put on the board and are not yet delivered. */
  offered: string[];
}

/** A job the board made up against a generated company. Taken down at `expiresMs` unless it is being worked on. */
export interface Job extends ContractDef {
  /** Game time it comes off the board. */
  readonly expiresMs: number;
  /** The headline that brought it, for a job a news story opened (see news.ts). */
  readonly news?: string;
  /** For a legend contract (see legend.ts): the twist it carries and the game week it was posted in. */
  readonly legend?: { readonly twist: 'shortFuse' | 'onGuard' | 'travelLight' | 'blindRun'; readonly week: number };
}

export interface StoredFile {
  name: string;
  sizeGq: number;
  /** Id of the server it was copied from, or CLIENT_FILE for one a client sent to be planted. */
  from: string;
  /** Level of the encryption on it. Missing = readable. */
  encrypted?: number;
  /** What it says, for a file made during the game (see FileState.text). */
  text?: string;
  /** The folder it sat in on the server it came from. */
  folder?: string;
  /** True for a doctored copy a client sent for a swap job. */
  doctored?: boolean;
  /** Game time it was copied to the gateway. Stolen data loses value as it ages (see data.ts). */
  takenMs?: number;
}

/** `from` of a file a client sent to the gateway to be planted somewhere. */
export const CLIENT_FILE = 'client';

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
  /** Time a Trace Jammer still has the trace frozen for. While above 0 the trace stands still. */
  frozenMs?: number;
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
  /** True once a Trace Jammer has been used on this connection. It works once. */
  jammed?: boolean;
  /** Time an Overclock still has left to run on this connection: programs on it run twice as fast meanwhile. */
  surgeMs?: number;
  /** How many times each active skill has been used on this connection, by move (see moves.ts). */
  moves?: Partial<Record<MoveId, number>>;
  /** The layer a Hot patch rebuilt a program for: that program meets it as an equal for as long as this connection lasts. */
  patched?: PatchLayer;
}

/** The skills the player presses a button for, once on each connection (see moves.ts). */
export type MoveId = 'overclock' | 'falseTrail' | 'hotPatch';
/** A layer a Hot patch can rebuild a program for. */
export type PatchLayer = 'password' | 'proxy' | 'firewall' | 'monitor';

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

/**
 * An attacker's port line-up as the player sees it: rings that turn, each
 * with one port. Locking every ring while its port is under the marker
 * shuts the attacker out of that barrier for a while. Drawn only from how
 * long the port has been open, so like a bypass it needs little state.
 */
export interface RaidPort {
  /** Where each ring's port was when the port opened, in degrees. */
  startAngles: number[];
  /** Degrees per second; negative turns the other way. */
  speeds: number[];
  locked: boolean[];
  /** How long the port has been open, which turns the rings. */
  ageMs: number;
}

/**
 * An enemy hacker breaking into your gateway. One at a time. The intruder
 * works through your defences over `breachTotalMs`; closing ports sets
 * them back, and a counter-trace along their route wins their address.
 */
export interface RaidState {
  /** Id of the rival hacker (content RivalDef). */
  readonly attackerId: string;
  /** Relay ids from the attacker toward your gateway, for the globe and the counter-trace. */
  readonly route: string[];
  /** Game time the attack began. */
  readonly startedAtMs: number;
  /** How far the intruder has got, in ms, toward breaking in. */
  breachMs: number;
  /** Time the intruder needs to break all the way in. */
  readonly breachTotalMs: number;
  /** How many barriers (ports) stand before the breach. */
  readonly barriers: number;
  /** The port line-up the player has open to shut the intruder out, or null. */
  port: RaidPort | null;
  /** How long the attack has run, in the same time the break-in counts in. Missing = not counted (an ordinary attack). */
  ranMs?: number;
  /** Ports shut so far in this attack. Each one sets the intruder back less than the last. Missing = none. */
  shut?: number;
  /** The counter-trace back along the attacker's route, or null until it is started. */
  traceBack: TraceState | null;
  /** Names of files or programs the player has locked, safe from a loss. */
  locked: string[];
  result: 'open' | 'won' | 'lost' | 'fled';
  /** True for a story attack: it may land while the player is connected. */
  readonly story: boolean;
}

/** An attack waiting to land: it begins when the player is next offline (or at once, for a story beat). */
export interface PendingRaid {
  readonly attackerId: string;
  readonly story: boolean;
}

/** How many slots there are for saved routes. */
export const ROUTE_SLOTS = 3;
/** How many slots there are for saved loadouts. */
export const LOADOUT_SLOTS = 3;

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
  /** Put a file from the gateway onto the server. */
  | { kind: 'uploadFile'; file: string }
  /** Remove one or more lines from the access log in a single run. */
  | { kind: 'deleteLog'; logIds: number[] }
  /** Take a program file stored on the gateway apart into modules. Runs at home. */
  | { kind: 'decompile'; file: string }
  /** Read a known server's security before connecting. Runs at home, against the server id. */
  | { kind: 'scan'; serverId: string }
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
  /** The folder it is in. Missing = what the data files say, or the top folder. */
  folder?: string;
  /** What it says, for a file made during the game (a note left for a job, a planted file). Written files keep theirs in content/. */
  text?: string;
  /** True once a client's doctored copy has replaced the real file. */
  doctored?: boolean;
}

export interface LogEntry {
  /** Unique within the game, so a program can point at one entry. */
  id: number;
  /** Game time the entry was written. */
  timeMs: number;
  text: string;
  /** True if the player caused this entry. Never shown; cleanup and forensics use it. */
  byPlayer: boolean;
  /** Set on a false line the player wrote to point at someone else: who it names. */
  framed?: string;
  /** Set on a line in a hacker's trail: the server it leads to (see kinds.ts). */
  points?: string;
}

/**
 * A server on its guard for a while, after something a contract set off:
 * layers raised, or a layer run from another server.
 */
export interface ServerAlert {
  /** Levels added to each layer. */
  raise: Partial<Record<'password' | 'proxy' | 'firewall' | 'monitor', number>>;
  /** A layer run from another server, as if the data files said so. */
  link?: { serverId: string; layer: 'firewall' | 'monitor' };
  /** Game time it ends. */
  untilMs: number;
}

/** The changeable parts of one server. The fixed parts live in content/servers/. */
export interface ServerState {
  files: FileState[];
  logs: LogEntry[];
  /** Rows of the server's records table, if it has one. */
  records: string[][];
  /** Set while the server is on its guard. */
  alert?: ServerAlert;
}

/** One story in the Continental Wire (see core/news.ts). */
export interface NewsItem {
  id: string;
  /** you = about the player's work (never naming them); world = a company's reaction or a background event; story = a story beat's echo. */
  kind: 'you' | 'world' | 'story';
  headline: string;
  /** Paragraphs split by a blank line. */
  body: string;
  /** The company it is about, if any. */
  serverId?: string;
  /** A job the story opened on the board, if any. */
  jobId?: string;
}

/** One morning's paper. */
export interface Edition {
  /** Which morning: see editionDay in news.ts. */
  day: number;
  items: NewsItem[];
  weather: string;
}

/** A word the globe and the address book show beside a server, put there by the story or the news. */
export interface ServerMark {
  label: string;
  /** Game time it comes off. Missing = for good. */
  untilMs?: number;
}

export interface NewsState {
  /** The last few editions, oldest first. */
  editions: Edition[];
  /** Stories waiting for the next edition. */
  pending: NewsItem[];
  /** Times the player's work on each company has made the news, by server id. */
  hits: Record<string, number>;
  /** Companies that have hired a security firm and stay harder for good. */
  firms: string[];
  /** Words shown beside servers, by server id. */
  marks: Record<string, ServerMark>;
}

/** Standing with each patron, and the record of how contracts with a choice were finished (see core/patrons.ts). */
export interface PatronsState {
  /** Standing by patron id. Missing = 0. */
  standing: Record<string, number>;
  /** Patrons the player has worked for under their own name, in the order met. */
  met: string[];
  /** How each contract that offered a choice was finished: choice id, or 'default' for the usual way. By contract id. */
  choices: Record<string, string>;
}

/** What the player did with a raider they beat: sold their address, kept their rig as a relay, or called a truce. */
export type LadderOutcome = 'sold' | 'relay' | 'truce';

/** The rivals ladder (see core/ladder.ts). */
export interface LadderState {
  /** The paper's day the ladder last moved on. -1 = never. */
  day: number;
  /** Each rival's score, by id, on the scale of the player's rating. */
  scores: Record<string, number>;
  /** What happened lately, newest first. */
  moves: { timeMs: number; text: string }[];
  /** What the player did with each raider they beat, by rival id. */
  outcomes: Record<string, LadderOutcome>;
  /** Raiders beaten and waiting for the player to decide. */
  beaten: string[];
  /** Rivals above the player at the last move, to notice who passed whom. */
  above: string[];
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
  /** Ids of servers the player has scanned, so their security is known before connecting. */
  scanned: string[];
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
  /** How far the player has got through the story (see core/story.ts). */
  story: StoryState;
  phish: PhishState;
  /** Log reviews still to come, in no particular order. */
  reviews: Review[];
  /** Names of one-off things that have already happened (e.g. the welcome message was sent). */
  flags: string[];
  /** Changeable state of each server, by server id. */
  servers: Record<string, ServerState>;
  /** An enemy hacker breaking into your gateway right now, or null. */
  raid: RaidState | null;
  /** An attack scheduled to land, waiting for the right moment, or null. */
  raidPending: PendingRaid | null;
  /** Game time before which no random attack is checked for (the cool-down). */
  raidQuietUntilMs: number;
  /** The daily paper and how the world has reacted to the player (see core/news.ts). */
  news: NewsState;
  patrons: PatronsState;
  ladder: LadderState;
  /** The data market at Lowtide: files it has already bought, as "server:name". */
  data: { sold: string[] };
  /** How badly the player is wanted (see core/wanted.ts). */
  wanted: WantedState;
  /** Chorus spreading through the world (see core/chorus.ts). */
  chorus: ChorusState;
  /** The ending the story reached, or null. */
  ending: EndingState | null;
}

export interface ChorusState {
  /** Servers it has taken, in the order taken. */
  taken: string[];
  /** Game time it takes the next one. 0 = its clock has not started. */
  nextMs: number;
  /** Servers taken so far, freed ones included. */
  takes: number;
  /**
   * Game time the story has been left waiting since the player last
   * delivered a story job: time with a story job on the board and not being
   * worked on. A player who is only slow, with no story job offered, is not
   * counted as ignoring it.
   */
  ignoredMs: number;
  /** Game time ignoredMs was last brought up to date. */
  checkedMs: number;
  /** Warnings sent so far about the long silence (see chorus.json doom). */
  warned: number;
}

/** The ending the story reached, once it has (see core/endings.ts). Play continues after. */
export interface EndingState {
  id: string;
  atMs: number;
}

/** How much attention the player has drawn. Being traced and leaving logs behind raise it; clean work and time bring it down. */
export interface WantedState {
  /** Rises by steps and falls slowly. 0 = nobody is looking. */
  heat: number;
  /** The level `heat` stood at when the player was last told, so a change is noticed once. */
  level: number;
  /** The game day heat last cooled with time. */
  day: number;
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
      hardware: { cpu: 1, memory: 1, storage: 1, modem: 1, ports: 1, rack: 0, sensor: 0, cooling: 0 },
      programs: [],
      files: [],
      passwords: {},
      rating: 0,
      bestRating: 0,
      skills: {},
      unlearns: 0,
      parts: {},
      builds: [],
      loadout: [],
      savedLoadouts: Array.from({ length: LOADOUT_SLOTS }, () => []),
      lieLowUntilMs: 0,
      assets: [],
      legends: 0,
      contacts: [],
      facts: [],
      model: null,
    },
    knownServers: [],
    scanned: [],
    bookmarks: [],
    savedRoutes: Array.from({ length: ROUTE_SLOTS }, () => []),
    relayHeat: {},
    route: [],
    connections: [],
    tasks: [],
    messages: [],
    contracts: { activeId: null, completed: [], jobs: [], stage: 0, stageStartMs: 0, heldMs: 0, guard: null, raceUntilMs: 0, heist: null, burned: [], heistDay: -1, legendDay: -1 },
    story: { lines: {}, offered: [] },
    phish: { sent: [], strikes: {}, waryUntilMs: {}, done: [] },
    reviews: [],
    flags: [],
    servers: {},
    raid: null,
    raidPending: null,
    raidQuietUntilMs: 0,
    news: { editions: [], pending: [], hits: {}, firms: [], marks: {} },
    patrons: { standing: {}, met: [], choices: {} },
    ladder: { day: -1, scores: {}, moves: [], outcomes: {}, beaten: [], above: [] },
    data: { sold: [] },
    wanted: { heat: 0, level: 0, day: 0 },
    chorus: { taken: [], nextMs: 0, takes: 0, ignoredMs: 0, checkedMs: 0, warned: 0 },
    ending: null,
  };
}

/** True while any connection is open. Time is then locked to real time. */
export function isConnected(state: GameState): boolean {
  return state.connections.length > 0;
}
