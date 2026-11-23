/**
 * The link between the fixed data files (content/) and a running game.
 *
 * The core never imports the data files itself. Whoever runs the game
 * hands them in as a `Content` object, so tests can use tiny made-up
 * worlds and the real data can change without touching the rules.
 */
import { MAX_LAYER_LEVEL, type AccountDef, type ContractDef, type FileContent, type FileDef, type MailDef, type MailKey, type ProgramDef, type ProgramKind, type SecurityDef, type ServerDef, type ServerLinkDef } from '../content/schema';
import type { CompanyPools } from '../content/companies';
import type { HardwareDef } from '../content/hardware';
import type { ModelDef } from '../content/models';
import type { PeopleDef } from '../content/people';
import type { SkillDef } from '../content/skills';
import type { ModuleDef } from '../content/modules';
import type { RivalDef } from '../content/rivals';
import type { StoryDef } from '../content/story';
import type { NewsDef } from '../content/news';
import type { PatronDef } from '../content/patrons';
import type { ChorusDef } from '../content/chorus';
import type { EndingDef } from '../content/endings';
import type { LadderDef } from '../content/ladder';
import type { DataMarketDef } from '../content/data';
import type { AssetDef } from '../content/assets';
import { twistOn } from './legend';
import { backfillChoices, backfillTrust } from './patrons';
import { backfillStoryFlags } from './story';
import { builtProgram } from './builds';
import { autoPack, dropFromMemory, loadedOfKind, memoryGb, needsMemory, trimLoadout } from './loadout';
import type { Connection, GameState, ServerState } from './state';

/** Numbers that tune the rules. The real ones come from content/tuning.json. */
export interface Rules {
  /** Game minutes that pass per real second at 1× speed. */
  readonly gameMinutesPerRealSecond: number;
  /** Seconds between an intrusion and the trace starting, by monitor level. Past the end = on connect. */
  readonly monitorGraceSeconds: readonly number[];
  /** How many times faster an easy password on an unwatched server breaks (see tuning). Missing = 1. */
  readonly easyCrackSpeed?: number;
  /** For this many delivered jobs. */
  readonly easyCrackJobs?: number;
  /** With no relays, the trace takes this fraction of the server's per-hop time. */
  readonly directTraceFactor: number;
  /** How much a trace step is stretched by the leg it has to cross: inside one country, across a border, to another part of the world. */
  readonly sameCountryLegFactor: number;
  readonly borderLegFactor: number;
  readonly overseasLegFactor: number;
  /** Trace steps, counting back from the target, that take their full time. */
  readonly relayFullSteps: number;
  /** What each step after those is worth, in order; the last value covers the rest. */
  readonly relayFade: readonly number[];
  /** A relay's step is divided by 1 + this times its heat. */
  readonly relayHeatSlow: number;
  /** In-game hours a relay needs to cool by one use. */
  readonly relayCoolHours: number;
  /** A relay's worth by how many levels the target's monitor outclasses it. */
  readonly coverShort: readonly number[];
  /** In-game hours without contracts after being traced. */
  readonly lieLowHours: number;
  readonly lieLowPayFactor: number;
  readonly finePerSecurityLevel: number;
  readonly caughtRatingLoss: number;
  /** How many times one connection can be rerouted around a trace. */
  readonly maxReroutes: number;
  /** In-game hours after an intrusion before the target reads its logs. */
  readonly reviewHours: number;
  /** A fine from a log review is this fraction of the fine for being traced. */
  readonly reviewFineFactor: number;
  /** How close (in degrees) a ring's port must be to the marker to lock. */
  readonly ringToleranceDegrees: number;
  /** Seconds a missed lock adds to the task. */
  readonly ringMissSeconds: number;
  /** Seconds a Monitor Bypass as strong as the monitor keeps it blind. */
  readonly monitorBlindSeconds: number;
  /** Seconds a version 1 Trace Jammer freezes a trace. */
  readonly traceJamSeconds: number;
  /** Echoing the handshake right multiplies the blind time left by this. */
  readonly echoBonusFactor: number;
  /** One wrong cell multiplies the blind time left by this. */
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
  readonly shopsAfterRating: number;
  readonly gearAfterRating: number;
  /** Each time the best rating passes another multiple of this, the player earns a skill point. */
  readonly skillPointRating: number;
  /** Past this best rating a point takes `skillPointSlowRating` rating. Left out: the same pace all the way up. */
  readonly skillPointSlowAfter?: number;
  readonly skillPointSlowRating?: number;
  /** The rating from which the board posts legend contracts (see legend.ts). Left out: never. */
  readonly legendRating?: number;
  /** Credits to unlearn every skill the first time; each time after costs this much more. */
  readonly unlearnPrice: number;
  /** Seconds the Workbench takes to fit one module, on a stock processor. */
  readonly buildSeconds: number;
  /** Delivered contracts before the fixer writes about the Workbench and sends the first modules. */
  readonly workbenchAfter: number;
  /** Rating needed before the market sells each grade of module, grade 1 first. */
  readonly moduleGradeRatings: readonly number[];
  /** Lowest rating at which a random enemy attack can land. */
  readonly raidMinRating: number;
  /** Least a job must pay for a random attack to be considered after it. */
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
  readonly raidPortFade: number;
  /** How many files or programs the player can lock during one attack. */
  readonly raidMaxLocks: number;
  /** A thief or framer loss takes this fraction of the balance. */
  readonly raidLossCredits: number;
  /** Best rating at which the one signature skill can be picked. Missing = never. */
  readonly signatureRating?: number;
}

export interface Content {
  readonly servers: readonly ServerDef[];
  /** Ids of servers every player knows from the start. */
  readonly startingServers: readonly string[];
  readonly programs: readonly ProgramDef[];
  /** Ids of programs every player owns from the start. */
  readonly startingPrograms: readonly string[];
  readonly contracts: readonly ContractDef[];
  /** Messages the rules send, by name. */
  readonly mail: Readonly<Record<MailKey, MailDef>>;
  /** People who can be written to, and what can be known about them. */
  readonly people: PeopleDef;
  /** Language models for rent on the board. */
  readonly models: readonly ModelDef[];
  /** Parts for the gateway, sold on the board. */
  readonly hardware: readonly HardwareDef[];
  /** Pools the ordinary companies and their jobs are made from (see generate.ts and jobs.ts). */
  readonly companies: CompanyPools;
  /** The skill tree. */
  readonly skills: readonly SkillDef[];
  /** Modules that are fitted to programs at the Workbench. */
  readonly modules: readonly ModuleDef[];
  /** Enemy hackers who break into the gateway (see core/raid.ts). */
  readonly rivals: readonly RivalDef[];
  /** Act 1 story beats (see core/story.ts). */
  readonly story: StoryDef;
  /** Templates for the daily paper (see core/news.ts). Missing = a paper with nothing to print. */
  readonly news?: NewsDef;
  /** The endings of the story (see core/endings.ts). Missing = none. */
  readonly endings?: readonly EndingDef[];
  /** Chorus (see core/chorus.ts). Missing = it never wakes. */
  readonly chorus?: ChorusDef;
  /** Named clients with standing (see core/patrons.ts). Missing = none. */
  readonly patrons?: readonly PatronDef[];
  /** The rivals ladder at the Backroom (see core/ladder.ts). Missing = no ladder. */
  readonly ladder?: LadderDef;
  /** What the data market at Lowtide buys (see core/data.ts). Missing = it buys nothing. */
  readonly data?: DataMarketDef;
  /** Property for sale late in a career (see core/assets.ts). Missing = none. */
  readonly assets?: readonly AssetDef[];
  readonly rules: Rules;
}

/**
 * Sends the player one of the written messages. Text in {braces} is
 * replaced from `fill`; {handle} is always available.
 */
export function sendMail(state: GameState, content: Content, key: MailKey, fill: Record<string, string> = {}): void {
  const values: Record<string, string> = { handle: state.player.handle, ...fill };
  const write = (text: string) => text.replace(/\{(\w+)\}/g, (whole, name: string) => values[name] ?? whole);
  const mail = content.mail[key];
  state.messages.push({
    id: `m${state.nextId++}`,
    from: write(mail.from),
    subject: write(mail.subject),
    body: write(mail.body),
    timeMs: state.clock.gameTimeMs,
    read: false,
  });
}

/** Sends a letter written into the content itself (a twist's, a story beat's). {handle} and anything in `fill` are filled in. */
export function sendLetter(state: GameState, letter: { readonly from: string; readonly subject: string; readonly body: string }, fill: Readonly<Record<string, string>> = {}): void {
  const values: Record<string, string> = { handle: state.player.handle, ...fill };
  const write = (text: string) => text.replace(/\{(\w+)\}/g, (whole, name: string) => values[name] ?? whole);
  state.messages.push({
    id: `m${state.nextId++}`,
    from: write(letter.from),
    subject: write(letter.subject),
    body: write(letter.body),
    timeMs: state.clock.gameTimeMs,
    read: false,
  });
}

/** Sends the messages that depend on how far the player has got. Safe to call any time. */
export function noteProgress(state: GameState, content: Content): void {
  if (state.contracts.completed.length >= content.rules.harderSecurityAfter) {
    once(state, 'harderSecurity', () => sendMail(state, content, 'harderSecurity'));
  }
  if (state.contracts.completed.length >= content.rules.phishingAfter && content.people.asks.length > 0) {
    once(state, 'phishing', () => sendMail(state, content, 'phishing'));
  }
  if (state.contracts.completed.length >= content.rules.hardwareAfter && content.hardware.some((part) => part.price > 0)) {
    once(state, 'hardware', () => sendMail(state, content, 'hardware'));
  }
  if (state.contracts.completed.length >= content.rules.jobsAfter) {
    once(state, 'jobs', () => sendMail(state, content, 'jobs'));
  }
  if (state.player.rating >= content.rules.linksAfterRating) {
    once(state, 'links', () => sendMail(state, content, 'links'));
  }
  if (state.player.rating >= content.rules.shopsAfterRating && content.servers.some((server) => server.kind === 'board' && server.shop?.contracts === false)) {
    once(state, 'shops', () => sendMail(state, content, 'shops'));
  }
  if (state.player.rating >= content.rules.gearAfterRating) {
    once(state, 'gear', () => sendMail(state, content, 'gear'));
  }
  // The broker writes once the first property is within reach, and the board once legend contracts start.
  const firstAsset = Math.min(...(content.assets ?? []).map((asset) => asset.minRating));
  if (state.player.rating >= firstAsset) once(state, 'property', () => sendMail(state, content, 'property'));
  if (content.rules.legendRating !== undefined && state.player.rating >= content.rules.legendRating) {
    once(state, 'legend', () => sendMail(state, content, 'legend'));
  }
  // At the rating where enemy hackers start to take an interest, the fixer gives warning.
  if (state.player.rating >= content.rules.raidMinRating && content.rivals.length > 0) {
    once(state, 'defence', () => sendMail(state, content, 'defence'));
  }
  // The best rating is what skill points come from (see skills.ts).
  state.player.bestRating = Math.max(state.player.bestRating, state.player.rating);
  if (state.player.bestRating >= content.rules.skillPointRating && content.skills.length > 0) {
    once(state, 'skills', () => sendMail(state, content, 'skills'));
  }
  if (state.contracts.completed.length >= content.rules.workbenchAfter && content.modules.length > 0) {
    once(state, 'workbench', () => {
      // A first pair to try: one that makes a program faster, one that keeps it out of sight.
      for (const id of ['swift', 'quiet']) {
        if (content.modules.some((module) => module.id === id)) state.player.parts[`${id}:1`] = (state.player.parts[`${id}:1`] ?? 0) + 1;
      }
      sendMail(state, content, 'workbench');
    });
  }
  // Once there is more to own than memory will hold, Wren explains what to carry.
  if (state.contracts.completed.length > content.rules.hardwareAfter && content.hardware.some((part) => part.slot === 'memory')) {
    once(state, 'memory', () => sendMail(state, content, 'memory'));
  }
  if (state.contracts.completed.length >= content.rules.modelsAfter && content.models.length > 0) {
    once(state, 'models', () => sendMail(state, content, 'models'));
  }
}

/** Does `name` the first time it is called for this game, and nothing after that. */
export function once(state: GameState, name: string, action: () => void): void {
  if (state.flags.includes(name)) return;
  state.flags.push(name);
  action();
}

/** A program from the market, or (given the game) one the player built at the Workbench. */
export function findProgram(content: Content, id: string, state?: GameState): ProgramDef | undefined {
  const program = content.programs.find((item) => item.id === id);
  if (program || !state) return program;
  const build = state.player.builds.find((item) => item.id === id);
  return build && builtProgram(state, content, build);
}

/** Every installed program of a kind, strongest first. A market program comes before a crafted one of the same version. */
export function installedOfKind(state: GameState, content: Content, kind: ProgramKind): ProgramDef[] {
  const crafted = (program: ProgramDef) => Number(!content.programs.includes(program));
  return state.player.programs
    .map((id) => findProgram(content, id, state))
    .filter((program): program is ProgramDef => program?.kind === kind)
    .sort((a, b) => b.version - a.version || crafted(a) - crafted(b));
}

/**
 * The program of a kind that runs when the player uses one. For work over
 * a connection that is the one loaded into memory (see loadout.ts); work
 * done at home runs the strongest on the drive.
 */
export function ownedProgram(state: GameState, content: Content, kind: ProgramKind): ProgramDef | undefined {
  if (needsMemory(kind)) return loadedOfKind(state, content, kind);
  return installedOfKind(state, content, kind)[0];
}

/** The written definition of a file on a server (or of the server a stored file came from). */
export function fileDef(content: Content, serverId: string, name: string): FileDef | undefined {
  return findServer(content, serverId)?.files.find((file) => file.name === name);
}

/** What opening a file shows, if anything was written for it. `serverId` is where the file is, or came from. */
export function fileContent(content: Content, serverId: string, name: string): FileContent | undefined {
  return findServer(content, serverId)?.files.find((file) => file.name === name)?.content;
}

/** The alert a server is under right now, if any. */
function liveAlert(state: GameState, serverId: string) {
  const alert = state.servers[serverId]?.alert;
  return alert && alert.untilMs > state.clock.gameTimeMs ? alert : undefined;
}

/** A server's security as it stands now: as written, plus anything a contract has put it on guard about. */
export function securityOf(state: GameState, server: ServerDef): SecurityDef {
  const alert = liveAlert(state, server.id)?.raise;
  // A company that hired a security firm (see news.ts) watches harder and keeps a stronger firewall, for good.
  const firm = state.news?.firms.includes(server.id) ? { firewall: 1, monitor: 1 } : undefined;
  // The vault of a heist under way: each layer a hold controls is shut tight, or off while its desk is held (see heists.ts).
  const heist = state.contracts?.heist?.vaultId === server.id ? state.contracts.heist : undefined;
  // A legend contract with the On guard twist: every lock on its servers is a level up while it is being worked on (see legend.ts).
  const guard = state.contracts && twistOn(state, 'onGuard', server.id) ? 1 : 0;
  if (!alert && !firm && !heist && !guard) return server.security;
  const raise = (layer: keyof SecurityDef) => (alert?.[layer] ?? 0) + (firm?.[layer as 'firewall'] ?? 0) + guard;
  const up = (layer: keyof SecurityDef) => {
    const hold = heist?.holds.find((item) => item.layer === layer);
    if (hold) return heistHeld(state, hold) ? 0 : MAX_LAYER_LEVEL;
    return Math.min(MAX_LAYER_LEVEL, server.security[layer] + (server.security[layer] > 0 || layer === 'monitor' ? raise(layer) : 0));
  };
  return { password: up('password'), proxy: up('proxy'), firewall: up('firewall'), monitor: up('monitor') };
}

/** True while an ally is keeping a heist's hold: always, or for a timed ally until their time runs out. */
export function allyHolding(hold: { ally?: string; allyMs?: number }): boolean {
  return hold.ally !== undefined && (hold.allyMs === undefined || hold.allyMs > 0);
}

/** True while a heist's hold is kept: an ally has it, or the player is logged in there as its administrator. */
export function heistHeld(state: GameState, hold: { targetId: string; ally?: string; allyMs?: number }): boolean {
  return allyHolding(hold) || state.connections.some((connection) => connection.serverId === hold.targetId && connection.role === 'admin');
}

/** The layer of a server that is run from another server right now, if any. */
export function linkOf(state: GameState, server: ServerDef): ServerLinkDef | undefined {
  return liveAlert(state, server.id)?.link ?? server.link;
}

/** Where a file sits on a server: its own folder, else the data files', else the top folder (''). */
export function folderOf(content: Content, serverId: string, file: { name: string; folder?: string }): string {
  return file.folder ?? fileDef(content, serverId, file.name)?.folder ?? '';
}

/** What opening a file shows, as the game stands: a file written during play says what it says, else what the data files wrote. */
export function openedContent(state: GameState, content: Content, serverId: string, name: string): FileContent | undefined {
  const own = state.player.files.find((file) => file.name === name && file.from === serverId);
  const live = own ?? state.servers[serverId]?.files.find((file) => file.name === name);
  if (live?.text) return { kind: 'text', text: live.text };
  return fileContent(content, serverId, name);
}

export function findServer(content: Content, id: string): ServerDef | undefined {
  return content.servers.find((server) => server.id === id);
}

export function gatewayOf(content: Content): ServerDef {
  const gateway = content.servers.find((server) => server.kind === 'gateway');
  if (!gateway) throw new Error('Content has no gateway server.');
  return gateway;
}

export function findAccount(server: ServerDef, user: string): AccountDef | undefined {
  return server.accounts.find((account) => account.user === user);
}

function initialServerState(server: ServerDef, state: GameState): ServerState {
  return {
    // What is inside a file stays in the data files; the game only tracks which files exist.
    files: server.files.map((file) => ({
      name: file.name,
      sizeGq: file.sizeGq,
      access: file.access,
      ...(file.encrypted ? { encrypted: file.encrypted } : {}),
      ...(file.folder ? { folder: file.folder } : {}),
    })),
    logs: server.logs
      .map((log) => ({ timeMs: state.clock.gameTimeMs - log.minutesAgo * 60_000, text: log.text }))
      .sort((a, b) => a.timeMs - b.timeMs)
      .map((log) => ({ id: state.nextId++, ...log, byPlayer: false })),
    records: server.records ? server.records.rows.map((row) => [...row]) : [],
  };
}

/**
 * Brings a game up to date with the data files: gives every server its
 * starting state if it has none yet, and makes sure the player knows the
 * starting servers. Safe to call any number of times. Call it on every
 * new game and every loaded save, so servers added in a later version of
 * the game show up in old saves too.
 */
export function syncWithContent(state: GameState, content: Content): GameState {
  for (const server of content.servers) {
    state.servers[server.id] ??= initialServerState(server, state);
  }
  const exists = (id: string) => findServer(content, id) !== undefined;
  for (const id of [gatewayOf(content).id, ...content.startingServers]) {
    if (!state.knownServers.includes(id)) state.knownServers.push(id);
  }
  // A player always owns something; an empty list means a new game or a save from before programs existed.
  if (state.player.programs.length === 0) state.player.programs = [...content.startingPrograms];
  // Builds from modules or programs that no longer exist go, and so do installed ids with nothing behind them.
  for (const build of state.player.builds) {
    if (builtProgram(state, content, build) !== undefined) continue;
    // The program it was built from comes back in its place, if that still exists.
    const back = content.programs.some((program) => program.id === build.base) && !state.player.programs.includes(build.base);
    state.player.programs = state.player.programs.flatMap((id) => (id === build.id ? (back ? [build.base] : []) : [id]));
    state.player.loadout = state.player.loadout.map((id) => (id === build.id && back ? build.base : id));
  }
  state.player.builds = state.player.builds.filter((build) => builtProgram(state, content, build) !== undefined);
  state.player.programs = state.player.programs.filter((id) => findProgram(content, id, state) !== undefined);

  // Loadouts came after some saves were made. Once: a build takes the place of the program it was built from,
  // in a save from before them memory grows (free, this once) to hold what the player was running, and that is what gets loaded.
  once(state, 'loadouts', () => {
    for (const build of state.player.builds) {
      if (state.player.programs.includes(build.id)) state.player.programs = state.player.programs.filter((id) => id !== build.base);
    }
    const picked = state.player.loadout.filter((id) => state.player.programs.includes(id));
    const tiers = content.hardware.filter((part) => part.slot === 'memory').sort((a, b) => a.tier - b.tier);
    const want = () => {
      let total = 0;
      const kinds = new Set<string>();
      for (const id of [...picked, ...state.player.programs]) {
        const program = findProgram(content, id, state);
        if (!program || !needsMemory(program.kind) || kinds.has(program.kind)) continue;
        kinds.add(program.kind);
        total += program.sizeGq;
      }
      return total;
    };
    const fits = tiers.find((part) => (part.memoryGb ?? 0) >= want());
    if (tiers.length > 0 && state.flags.includes('beforeLoadouts')) state.player.hardware.memory = Math.max(state.player.hardware.memory, (fits ?? tiers[tiers.length - 1]!).tier);
    autoPack(state, content);
    // What the player had picked to run takes the place of the strongest, where it fits.
    for (const id of picked) {
      const program = findProgram(content, id, state);
      const current = program && loadedOfKind(state, content, program.kind);
      if (!program || !current || current.id === id) continue;
      if (program.sizeGq <= memoryGb(state, content) - (state.player.loadout.reduce((sum, own) => sum + (findProgram(content, own, state)?.sizeGq ?? 0), 0) - current.sizeGq)) {
        state.player.loadout = state.player.loadout.map((own) => (own === current.id ? id : own));
      }
    }
  });
  for (const id of [...state.player.loadout]) if (!state.player.programs.includes(id)) dropFromMemory(state, id);
  trimLoadout(state, content);

  // Recordings were added to servers after some saves were made; give those saves the files once.
  once(state, 'recordings-added', () => {
    for (const server of content.servers) {
      const files = state.servers[server.id]?.files;
      for (const file of server.files) {
        if (!files || file.content === undefined || file.content.kind === 'text') continue;
        if (!files.some((other) => other.name === file.name)) {
          files.push({ name: file.name, sizeGq: file.sizeGq, access: file.access });
        }
      }
    }
  });

  // Module installers and program files were added to servers after some saves were made; give those saves the files once.
  once(state, 'installers-added', () => {
    for (const server of content.servers) {
      const files = state.servers[server.id]?.files;
      for (const file of server.files) {
        if (!files || !(file.part || file.program) || files.some((other) => other.name === file.name)) continue;
        if (state.flags.includes(`part:${server.id}/${file.name}`)) continue;
        files.push({ name: file.name, sizeGq: file.sizeGq, access: file.access });
      }
    }
  });

  // Files that name people or hold details were added after some saves were made; give those saves the files once.
  once(state, 'people-files', () => {
    const sources = [...content.people.people.flatMap((person) => (person.source ? [person.source] : [])), ...content.people.facts.map((fact) => fact.source)];
    for (const source of sources) {
      const files = state.servers[source.serverId]?.files;
      const file = findServer(content, source.serverId)?.files.find((item) => item.name === source.file);
      if (files && file && !files.some((other) => other.name === file.name)) {
        files.push({ name: file.name, sizeGq: file.sizeGq, access: file.access, ...(file.encrypted ? { encrypted: file.encrypted } : {}) });
      }
    }
  });

  // Choices made before they were recorded: worked out once from what is on the gateway.
  once(state, 'choices-recorded', () => backfillChoices(state, content));
  once(state, 'trust-counted', () => backfillTrust(state, content));
  backfillStoryFlags(state, content);

  once(state, 'welcome', () => sendMail(state, content, 'welcome'));
  noteProgress(state, content);
  // A contract that was removed from the game can't be finished.
  const isContract = (id: string) =>
    content.contracts.some((contract) => contract.id === id) ||
    state.contracts.jobs.some((job) => job.id === id && exists(job.targetId));
  state.contracts.jobs = state.contracts.jobs.filter((job) => exists(job.targetId));
  if (state.contracts.activeId !== null && !isContract(state.contracts.activeId)) state.contracts.activeId = null;

  if (state.player.model && !content.models.some((model) => model.id === state.player.model?.id)) state.player.model = null;

  // Drop anything that points at a server that no longer exists.
  state.knownServers = state.knownServers.filter(exists);
  state.route = state.route.filter(exists);
  state.connections = state.connections.filter(
    (connection) => exists(connection.serverId) && connection.route.every(exists),
  );
  state.tasks = state.tasks.filter(
    (task) =>
      (task.connectionId === null || findConnection(state, task.connectionId)) && findProgram(content, task.programId, state),
  );
  return state;
}

/** The address the far end sees: the last relay in the route, or the gateway if there is none. */
export function sourceAddress(content: Content, connection: Connection): string {
  const lastHop = connection.route[connection.route.length - 1];
  return (lastHop === undefined ? gatewayOf(content) : (findServer(content, lastHop) ?? gatewayOf(content))).address;
}

export function findConnection(state: GameState, id: string | null): Connection | undefined {
  return state.connections.find((connection) => connection.id === id);
}
