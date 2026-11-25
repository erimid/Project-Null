/**
 * Turning a game into save-file text and back.
 *
 * A save is JSON with a small header (so the slot list can show who and
 * when without loading the game) and the full GameState. Where the text
 * is stored (browser storage, a downloaded file) is the UI's business.
 */
import { OBJECTIVE_KINDS, ROLES } from '../content/schema';
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
  // 2 -> 3: security, programs, traces and messages were added. Open connections
  // from version 2 had no security to trip, so they start with a clean trace.
  2: (old) => {
    let nextId = typeof old.nextId === 'number' ? old.nextId : 1;
    const servers = Object.fromEntries(
      Object.entries(old.servers as Record<string, Record<string, unknown>>).map(([id, server]) => [
        id,
        { ...server, logs: (server.logs as object[]).map((log) => ({ id: nextId++, ...log })) },
      ]),
    );
    return {
      ...old,
      nextId,
      player: { ...(old.player as object), programs: [], files: [], passwords: {} },
      connections: (old.connections as object[]).map((connection) => ({
        ...connection,
        bypassed: { proxy: false, firewall: false },
        trace: { status: 'none', graceMs: 0, elapsedMs: 0, hopMs: [60_000] },
      })),
      tasks: [],
      messages: [],
      servers,
    };
  },
  // 3 -> 4: contracts, rating and lying low were added.
  3: (old) => ({
    ...old,
    player: { ...(old.player as object), rating: 0, lieLowUntilMs: 0 },
    contracts: { activeId: null, completed: [] },
    flags: [],
  }),
  // 4 -> 5: reroutes, log reviews, and removing several log lines in one run.
  4: (old) => ({
    ...old,
    reviews: [],
    connections: (old.connections as object[]).map((connection) => ({ ...connection, reroutes: 0 })),
    tasks: (old.tasks as { target: { kind: string; logId?: number } }[]).map((task) =>
      task.target.kind === 'deleteLog' ? { ...task, target: { kind: 'deleteLog', logIds: [task.target.logId] } } : task,
    ),
  }),
  // 5 -> 6: Monitor Bypass. No monitor was blind before it existed.
  5: (old) => ({
    ...old,
    connections: (old.connections as object[]).map((connection) => ({
      ...connection,
      monitor: { blindMs: 0, used: false, echo: null },
    })),
  }),
  // 6 -> 7: writing to people. Nobody had been written to before it existed.
  6: (old) => ({
    ...old,
    player: { ...(old.player as object), contacts: [], facts: [] },
    phish: { sent: [], strikes: {}, waryUntilMs: {}, done: [] },
  }),
  // 7 -> 8: models for rent. Nobody had one before.
  7: (old) => ({ ...old, player: { ...(old.player as object), model: null } }),
  // 8 -> 9: gateway hardware. Everyone had stock parts; the old connection limit becomes the ports part.
  8: (old) => {
    const { maxConnections, ...player } = old.player as Record<string, unknown>;
    const ports = typeof maxConnections === 'number' ? Math.min(3, Math.max(1, Math.floor(maxConnections))) : 1;
    return { ...old, player: { ...player, hardware: { cpu: 1, storage: 1, modem: 1, ports, rack: 0 } } };
  },
  // 9 -> 10: repeatable jobs against generated companies. The board posts them on the next tick.
  9: (old) => ({ ...old, contracts: { ...(old.contracts as object), jobs: [] } }),
  // 10 -> 11: the skill tree. The points a player's rating has already earned are there to spend.
  10: (old) => {
    const player = old.player as Record<string, unknown>;
    const rating = typeof player.rating === 'number' ? player.rating : 0;
    return { ...old, player: { ...player, bestRating: rating, skills: {}, unlearns: 0 } };
  },
  // 11 -> 12: crafting. Nobody had parts or built programs before.
  11: (old) => ({ ...old, player: { ...(old.player as object), parts: {}, builds: [], preferred: {} } }),
  // 12 -> 13: bookmarks in the address book. Nobody had starred anything.
  12: (old) => ({ ...old, bookmarks: [] }),
  // 13 -> 14: saved routes and relays that warm with use. Every relay starts cold.
  13: (old) => ({ ...old, savedRoutes: [[], [], []], relayHeat: {} }),
  // 14 -> 15: contracts with stages. A contract under way is on its first stage, begun now.
  14: (old) => {
    const clock = old.clock as Record<string, unknown> | undefined;
    const now = typeof clock?.gameTimeMs === 'number' ? clock.gameTimeMs : 0;
    return { ...old, contracts: { ...(old.contracts as object), stage: 0, stageStartMs: now } };
  },
  // 15 -> 16: enemy hackers. Nobody was under attack before they existed.
  15: (old) => ({ ...old, raid: null, raidPending: null, raidQuietUntilMs: 0 }),
  // 16 -> 17: new gear and shops. No server scanned yet, and no trace sensor fitted.
  16: (old) => ({
    ...old,
    scanned: [],
    player: { ...(old.player as object), hardware: { ...((old.player as { hardware: object }).hardware), sensor: 0 } },
  }),
  // 17 -> 18: the story director. The story picks up from the save's rating, so it starts at the first beat.
  17: (old) => ({ ...old, story: { beat: 0, arrived: false, lastMs: 0, offered: [] } }),
  // 18 -> 19: the cooling slot. Nobody had a cooler fitted before it existed.
  18: (old) => ({
    ...old,
    player: { ...(old.player as object), hardware: { ...((old.player as { hardware: object }).hardware), cooling: 0 } },
  }),
  // 19 -> 20: the daily news. The first edition is printed when the game next looks at the clock.
  19: (old) => ({ ...old, news: { editions: [], pending: [], hits: {}, firms: [], marks: {} } }),
  // 20 -> 21: patrons and the record of choices. The choices already made are filled in on load (see backfillChoices).
  20: (old) => ({ ...old, patrons: { standing: {}, met: [], choices: {} } }),
  // 22 -> 23: new kinds of job. Nothing was being held, guarded or raced.
  22: (old) => ({ ...old, contracts: { ...(old.contracts as object), heldMs: 0, guard: null, raceUntilMs: 0 } }),
  23: (old) => ({ ...old, contracts: { ...(old.contracts as object), heist: null, burned: [], heistDay: -1 } }),
  // Files already on the gateway count as taken when the save was loaded.
  24: (old) => {
    const player = old.player as { files?: unknown } | undefined;
    const now = (old.clock as { gameTimeMs?: number } | undefined)?.gameTimeMs ?? 0;
    const files = Array.isArray(player?.files) ? player.files.map((file: unknown) => (typeof file === 'object' && file !== null ? { ...file, takenMs: now } : file)) : player?.files;
    return { ...old, ...(player ? { player: { ...player, files } } : {}), data: { sold: [] } };
  },
  // 25 -> 26: loadouts, a memory slot and the wanted level. What the player had picked to run is what gets loaded
  // (syncWithContent finishes the job, since only it knows how big each program is). Nobody was wanted.
  25: (old) => {
    const { preferred, ...player } = old.player as Record<string, unknown>;
    const picks = typeof preferred === 'object' && preferred !== null ? Object.values(preferred).filter((id): id is string => typeof id === 'string') : [];
    return {
      ...old,
      player: { ...player, hardware: { ...(player.hardware as object), memory: 1 }, loadout: picks, savedLoadouts: [[], [], []] },
      wanted: { heat: 0, level: 0, day: 0 },
      // Tells the next sync that this gateway was running everything it owned: its memory grows, free, to hold that.
      flags: [...(Array.isArray(old.flags) ? old.flags : []), 'beforeLoadouts'],
    };
  },
  // 26 -> 27: the upper titles grew twice as long, so a rating above 25 moves to where it now stands
  // (25 + twice what was above it), the player's and every rival's. Property and legend contracts start empty.
  26: (old) => {
    const stretch = (value: unknown): unknown => (typeof value === 'number' && value > 25 ? 25 + 2 * (value - 25) : value);
    const player = old.player as Record<string, unknown>;
    const ladder = old.ladder as { scores?: Record<string, unknown> } | undefined;
    return {
      ...old,
      player: { ...player, rating: stretch(player.rating), bestRating: stretch(player.bestRating), assets: [], legends: 0 },
      contracts: { ...(old.contracts as object), legendDay: -1 },
      ...(ladder ? { ladder: { ...ladder, scores: Object.fromEntries(Object.entries(ladder.scores ?? {}).map(([id, score]) => [id, stretch(score)])) } } : {}),
    };
  },
  // 21 -> 22: the rivals ladder. It sets itself up on the next clock check; raiders already beaten wait for a decision.
  21: (old) => ({
    ...old,
    ladder: {
      day: -1,
      scores: {},
      moves: [],
      outcomes: {},
      beaten: ((old.flags as unknown[]) ?? []).flatMap((flag) => (typeof flag === 'string' && flag.startsWith('beat:') ? [flag.slice(5)] : [])),
      above: [],
    },
  }),
  // 27 -> 28: the story runs on lines. Acts 1 and 2 are the line "main", which carries on exactly where the save was.
  // The flags for beats already passed are filled in on load (see syncWithContent), since only the content knows their ids.
  27: (old) => {
    const story = (old.story ?? {}) as { beat?: number; arrived?: boolean; lastMs?: number; offered?: unknown };
    return {
      ...old,
      story: {
        lines: { main: { beat: story.beat ?? 0, arrived: story.arrived ?? false, lastMs: story.lastMs ?? 0 } },
        offered: Array.isArray(story.offered) ? story.offered : [],
      },
    };
  },
  // 28 -> 29: Chorus. It has not woken in any save from before it existed.
  28: (old) => ({ ...old, chorus: { taken: [], nextMs: 0, takes: 0, ignoredMs: 0, checkedMs: 0, warned: 0 }, ending: null }),
  // 29 -> 30: story lines remember their beat by id as well as by place, and whether its needs letter went out.
  // Nothing to move: the ids are filled in on load (see backfillStoryFlags), since only the content knows them.
  29: (old) => old,
  // 30 -> 31: a heist ally may hold a door for a while only (allyMs). A heist under way in an old save has none.
  30: (old) => old,
  // 31 -> 32: jobs with one clock for all their steps, and optional terms. A job under way in an old save has neither.
  31: (old) => {
    const contracts = old.contracts as Record<string, unknown>;
    return { ...old, contracts: { ...contracts, takenMs: 0, windowUntilMs: 0, termsBroken: false } };
  },
  // 32 -> 33: darknet events. None is under way in an old save; the first is decided on the next clock check.
  32: (old) => ({ ...old, events: { current: null, nextMs: 0, last: null, owed: [], warned: false } }),
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
    throw new SaveError('This file is not a Project NULL save.');
  }
  if (!isObj(file) || file.format !== SAVE_FORMAT || !isObj(file.state)) {
    throw new SaveError('This file is not a Project NULL save.');
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
  ((c.user === null && c.role === null) || (isText(c.user) && isRole(c.role))) &&
  isObj(c.bypassed) &&
  typeof c.bypassed.proxy === 'boolean' &&
  typeof c.bypassed.firewall === 'boolean' &&
  isObj(c.trace) &&
  ['none', 'pending', 'active'].includes(c.trace.status as string) &&
  isNum(c.trace.graceMs) &&
  isNum(c.trace.elapsedMs) &&
  isList(c.trace.hopMs, isNum) &&
  isNum(c.reroutes) &&
  isObj(c.monitor) &&
  isNum(c.monitor.blindMs) &&
  typeof c.monitor.used === 'boolean' &&
  (c.monitor.echo === null ||
    (isObj(c.monitor.echo) &&
      isList(c.monitor.echo.cells, isNum) &&
      isNum(c.monitor.echo.entered) &&
      ['open', 'won', 'lost'].includes(c.monitor.echo.result as string)));

const isHardware = (h: unknown) =>
  isObj(h) && ['cpu', 'memory', 'storage', 'modem', 'ports', 'rack', 'sensor', 'cooling'].every((slot) => isNum(h[slot]) && Number.isInteger(h[slot]) && (h[slot] as number) >= 0);

const isJob = (j: unknown): j is Obj =>
  isObj(j) &&
  ['id', 'title', 'client', 'targetId', 'summary', 'brief'].every((key) => isText(j[key])) &&
  ['pay', 'rating', 'minRating', 'expiresMs'].every((key) => isNum(j[key])) &&
  isObj(j.objective) &&
  (OBJECTIVE_KINDS as readonly string[]).includes(j.objective.kind as string) &&
  (j.stages === undefined ||
    isList(j.stages, (stage): stage is Obj => isObj(stage) && isText(stage.targetId) && isObj(stage.objective) && (OBJECTIVE_KINDS as readonly string[]).includes(stage.objective.kind as string)));

const isLevel = (value: unknown) => value === undefined || isNum(value);

const isFitted = (f: unknown): f is Obj => isObj(f) && isText(f.id) && isNum(f.grade);
const isBuild = (b: unknown): b is Obj => isObj(b) && isText(b.id) && isText(b.base) && isList(b.modules, isFitted);

const TARGET_KINDS = ['password', 'proxy', 'firewall', 'monitor', 'decrypt', 'copyFile', 'deleteFile', 'uploadFile', 'deleteLog', 'build', 'decompile', 'scan'];

const isTask = (t: unknown): t is Obj =>
  isObj(t) &&
  isText(t.id) &&
  isText(t.programId) &&
  (t.connectionId === null || isText(t.connectionId)) &&
  isNum(t.progressMs) &&
  isNum(t.durationMs) &&
  isObj(t.target) &&
  TARGET_KINDS.includes(t.target.kind as string) &&
  (t.target.kind !== 'deleteLog' || isList(t.target.logIds, isNum)) &&
  (t.target.kind !== 'decrypt' || (isText(t.target.file) && t.connectionId === null)) &&
  (t.target.kind !== 'decompile' || (isText(t.target.file) && t.connectionId === null)) &&
  (t.target.kind !== 'build' || (isText(t.target.base) && isList(t.target.modules, isFitted) && t.connectionId === null)) &&
  (t.puzzle === undefined ||
    (isObj(t.puzzle) &&
      isList(t.puzzle.startAngles, isNum) &&
      isList(t.puzzle.speeds, isNum) &&
      isList(t.puzzle.locked, (v): v is boolean => typeof v === 'boolean')));

const isPort = (p: unknown): p is Obj =>
  isObj(p) &&
  isList(p.startAngles, isNum) &&
  isList(p.speeds, isNum) &&
  isList(p.locked, (v): v is boolean => typeof v === 'boolean') &&
  isNum(p.ageMs);

const isTrace = (t: unknown): t is Obj =>
  isObj(t) && ['none', 'pending', 'active'].includes(t.status as string) && isNum(t.graceMs) && isNum(t.elapsedMs) && isList(t.hopMs, isNum);

const isRaid = (r: unknown): r is Obj =>
  isObj(r) &&
  isText(r.attackerId) &&
  isList(r.route, isText) &&
  isNum(r.startedAtMs) &&
  isNum(r.breachMs) &&
  isNum(r.breachTotalMs) &&
  isNum(r.barriers) &&
  (r.port === null || isPort(r.port)) &&
  (r.traceBack === null || isTrace(r.traceBack)) &&
  isList(r.locked, isText) &&
  ['open', 'won', 'lost', 'fled'].includes(r.result as string) &&
  typeof r.story === 'boolean';

const isMessage = (m: unknown): m is Obj =>
  isObj(m) &&
  isText(m.id) &&
  isText(m.from) &&
  isText(m.subject) &&
  isText(m.body) &&
  isNum(m.timeMs) &&
  typeof m.read === 'boolean';

const isNewsItem = (n: unknown): n is Obj =>
  isObj(n) && isText(n.id) && ['you', 'world', 'story'].includes(n.kind as string) && isText(n.headline) && isText(n.body);

const isServerState = (s: unknown): s is Obj =>
  isObj(s) &&
  isList(s.files, (f): f is Obj => isObj(f) && isText(f.name) && isNum(f.sizeGq) && isRole(f.access) && isLevel(f.encrypted)) &&
  isList(
    s.logs,
    (l): l is Obj => isObj(l) && isNum(l.id) && isNum(l.timeMs) && isText(l.text) && typeof l.byPlayer === 'boolean',
  ) &&
  isList(s.records, (row): row is string[] => isList(row, isText));

function checkState(raw: Obj): GameState {
  const damaged = new SaveError('This save is damaged.');
  const { clock, player, rngStreams, servers } = raw;

  if (!isNum(raw.seed) || !isNum(raw.nextId)) throw damaged;
  if (!isObj(clock) || !isNum(clock.gameTimeMs) || !(SPEEDS as readonly unknown[]).includes(clock.speed)) {
    throw damaged;
  }
  if (!isObj(player) || !isText(player.handle) || !isNum(player.balance) || !isHardware(player.hardware)) {
    throw damaged;
  }
  if (
    !isList(player.programs, isText) ||
    !isList(player.files, (f): f is Obj => isObj(f) && isText(f.name) && isNum(f.sizeGq) && isText(f.from) && isLevel(f.encrypted)) ||
    !isObj(player.passwords) ||
    !Object.values(player.passwords).every((users) => isList(users, isText))
  ) {
    throw damaged;
  }
  if (!isNum(player.rating) || !isNum(player.lieLowUntilMs)) throw damaged;
  if (!isNum(player.bestRating) || !isNum(player.unlearns) || !isObj(player.skills) || !Object.values(player.skills).every(isNum)) {
    throw damaged;
  }
  if (!isObj(player.parts) || !Object.values(player.parts).every(isNum) || !isList(player.builds, isBuild)) throw damaged;
  if (!isList(player.loadout, isText) || !isList(player.savedLoadouts, (slot): slot is string[] => isList(slot, isText))) throw damaged;
  if (!isList(player.assets, isText) || !isNum(player.legends)) throw damaged;
  const heat = raw.wanted;
  if (!isObj(heat) || !isNum(heat.heat) || !isNum(heat.level) || !isNum(heat.day)) throw damaged;
  if (!isList(player.contacts, isText) || !isList(player.facts, isText)) throw damaged;
  if (!(player.model === null || (isObj(player.model) && isText(player.model.id) && isNum(player.model.untilMs)))) throw damaged;
  const phish = raw.phish;
  if (
    !isObj(phish) ||
    !isList(phish.sent, (a): a is Obj => isObj(a) && isText(a.askId) && isNum(a.dueMs) && typeof a.ok === 'boolean') ||
    !isObj(phish.strikes) ||
    !Object.values(phish.strikes).every(isNum) ||
    !isObj(phish.waryUntilMs) ||
    !Object.values(phish.waryUntilMs).every(isNum) ||
    !isList(phish.done, isText)
  ) {
    throw damaged;
  }
  const contracts = raw.contracts;
  if (
    !isObj(contracts) ||
    !(contracts.activeId === null || isText(contracts.activeId)) ||
    !isList(contracts.completed, isText) ||
    !isList(contracts.jobs, isJob) ||
    !isNum(contracts.stage) ||
    !isNum(contracts.stageStartMs) ||
    !isNum(contracts.heldMs) ||
    !isNum(contracts.raceUntilMs) ||
    !isNum(contracts.heistDay) ||
    !isNum(contracts.legendDay) ||
    !isNum(contracts.takenMs) ||
    !isNum(contracts.windowUntilMs) ||
    typeof contracts.termsBroken !== 'boolean' ||
    !isList(contracts.burned, isText) ||
    !(
      contracts.heist === null ||
      (isObj(contracts.heist) &&
        isText(contracts.heist.vaultId) &&
        isList(contracts.heist.holds, (hold): hold is Obj => isObj(hold) && isText(hold.targetId) && ['firewall', 'monitor', 'proxy'].includes(hold.layer as string) && (hold.ally === undefined || isText(hold.ally))))
    ) ||
    !(contracts.guard === null || (isObj(contracts.guard) && isNum(contracts.guard.breachMs) && isNum(contracts.guard.totalMs) && isNum(contracts.guard.shut) && (contracts.guard.port === null || isPort(contracts.guard.port))))
  ) {
    throw damaged;
  }
  const story = raw.story;
  if (
    !isObj(story) ||
    !isObj(story.lines) ||
    !Object.values(story.lines).every((line) => isObj(line) && isNum(line.beat) && typeof line.arrived === 'boolean' && isNum(line.lastMs) && (line.lapsed === undefined || typeof line.lapsed === 'boolean') && (line.warned === undefined || typeof line.warned === 'boolean')) ||
    !isList(story.offered, isText)
  ) {
    throw damaged;
  }
  if (!isList(raw.flags, isText)) throw damaged;
  if (!isList(raw.reviews, (r): r is Obj => isObj(r) && isText(r.serverId) && isNum(r.dueMs))) throw damaged;
  if (!isList(raw.tasks, isTask) || !isList(raw.messages, isMessage)) throw damaged;
  if (!isObj(rngStreams) || !Object.values(rngStreams).every(isNum)) throw damaged;
  if (!isList(raw.knownServers, isText) || !isList(raw.route, isText) || !isList(raw.bookmarks, isText)) throw damaged;
  if (!isList(raw.scanned, isText)) throw damaged;
  if (!isList(raw.savedRoutes, (route): route is string[] => isList(route, isText))) throw damaged;
  if (!isObj(raw.relayHeat) || !Object.values(raw.relayHeat).every((mark) => isObj(mark) && isNum(mark.heat) && isNum(mark.atMs))) throw damaged;
  if (!isList(raw.connections, isConnection)) throw damaged;
  if (!isObj(servers) || !Object.values(servers).every(isServerState)) throw damaged;
  if (!(raw.raid === null || isRaid(raw.raid))) throw damaged;
  if (!(raw.raidPending === null || (isObj(raw.raidPending) && isText(raw.raidPending.attackerId) && typeof raw.raidPending.story === 'boolean'))) throw damaged;
  if (!isNum(raw.raidQuietUntilMs)) throw damaged;
  const news = raw.news;
  if (
    !isObj(news) ||
    !isList(news.editions, (e): e is Obj => isObj(e) && isNum(e.day) && isText(e.weather) && isList(e.items, isNewsItem)) ||
    !isList(news.pending, isNewsItem) ||
    !isObj(news.hits) ||
    !Object.values(news.hits).every(isNum) ||
    !isList(news.firms, isText) ||
    !isObj(news.marks) ||
    !Object.values(news.marks).every((mark) => isObj(mark) && isText(mark.label) && (mark.untilMs === undefined || isNum(mark.untilMs)))
  ) {
    throw damaged;
  }
  const ladder = raw.ladder;
  if (
    !isObj(ladder) ||
    !isNum(ladder.day) ||
    !isObj(ladder.scores) ||
    !Object.values(ladder.scores).every(isNum) ||
    !isList(ladder.moves, (m): m is Obj => isObj(m) && isNum(m.timeMs) && isText(m.text)) ||
    !isObj(ladder.outcomes) ||
    !Object.values(ladder.outcomes).every((o) => o === 'sold' || o === 'relay' || o === 'truce') ||
    !isList(ladder.beaten, isText) ||
    !isList(ladder.above, isText)
  ) {
    throw damaged;
  }
  if (!isObj(raw.data) || !isList(raw.data.sold, isText)) throw damaged;
  const events = raw.events;
  const current = isObj(events) ? events.current : undefined;
  if (
    !isObj(events) ||
    !isNum(events.nextMs) ||
    !(events.last === null || isText(events.last)) ||
    !isList(events.owed, isText) ||
    typeof events.warned !== 'boolean' ||
    !(current === null || (isObj(current) && isText(current.kind) && isText(current.id) && isNum(current.startMs) && isNum(current.untilMs)))
  ) {
    throw damaged;
  }
  const patrons = raw.patrons;
  if (
    !isObj(patrons) ||
    !isObj(patrons.standing) ||
    !Object.values(patrons.standing).every(isNum) ||
    !isList(patrons.met, isText) ||
    !isObj(patrons.choices) ||
    !Object.values(patrons.choices).every(isText)
  ) {
    throw damaged;
  }
  const chorus = raw.chorus;
  if (!isObj(chorus) || !isList(chorus.taken, isText) || !isNum(chorus.nextMs) || !isNum(chorus.takes) || !isNum(chorus.ignoredMs) || !isNum(chorus.checkedMs) || !isNum(chorus.warned)) throw damaged;
  const ending = raw.ending;
  if (!(ending === null || (isObj(ending) && isText(ending.id) && isNum(ending.atMs)))) throw damaged;
  return raw as unknown as GameState;
}
