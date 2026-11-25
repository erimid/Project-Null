/**
 * Programs. Running one against a connection creates a task that takes
 * time; when it finishes, its effect is applied.
 */
import type { ProgramDef, ProgramKind, ServerDef } from '../content/schema';
import type { Connection, EchoPuzzle, GameState, RingPuzzle, Task, TaskTarget } from './state';
import { cpuSpeed, fileSpeed, maxPrograms, rackStorageGb, storageGb } from './hardware';
import { heldBy } from './link';
import { checkBuild, finishBuild, finishDecompile, hasTrait, partTaken, programFile, takeModules, takePartFile } from './crafting';
import { effect } from './skills';
import { stream } from './streams';
import { noteIntrusion } from './trace';
import { needsMemory } from './loadout';
import { SURGE_SPEED } from './moves';
import { fileDef, findAccount, securityOf, findConnection, findProgram, findServer, ownedProgram, once, type Content } from './world';
import { noteStolen, teachNow } from './record';
import { rewriteOnCopy } from './stages';

/** A program this many levels below a layer can't touch it at all. */
export const MAX_LEVEL_GAP = 2;

const PROGRAM_FOR: Record<Exclude<TaskTarget['kind'], 'build'>, ProgramKind> = {
  password: 'breakPassword',
  proxy: 'bypassProxy',
  firewall: 'bypassFirewall',
  monitor: 'bypassMonitor',
  decrypt: 'decrypt',
  copyFile: 'copyFile',
  deleteFile: 'deleteFile',
  // Sending a file is the same work as fetching one.
  uploadFile: 'copyFile',
  deleteLog: 'deleteLog',
  decompile: 'decompile',
  scan: 'scan',
};

/**
 * How long a program needs against a layer. A program as strong as the
 * layer takes its base time; each level the layer is ahead doubles it
 * (or multiplies it by `behind`), each level the program is ahead halves
 * it. Null = too weak to work.
 */
export function layerSeconds(program: ProgramDef, level: number, behind = 2): number | null {
  const gap = level - program.version;
  if (gap > MAX_LEVEL_GAP) return null;
  return program.baseSeconds * (gap > 0 ? behind ** gap : 2 ** gap);
}

/** Program kinds the Sharp tools skill speeds up. */
const CRACKING: readonly TaskTarget['kind'][] = ['password', 'proxy', 'firewall'];

/** How close (in degrees) a ring's port must be to the marker to lock, with the player's skills. */
export const ringTolerance = (state: GameState, content: Content): number =>
  content.rules.ringToleranceDegrees * (1 + effect(state, content, 'steadyHand'));

/** Room taken on the gateway by installed programs. */
export function programStorageGq(state: GameState, content: Content): number {
  return state.player.programs.reduce((sum, id) => sum + (findProgram(content, id, state)?.sizeGq ?? 0), 0);
}

/** Room taken on the gateway: installed programs, a hosted model's weights, and stored files. */
export function usedStorageGq(state: GameState, content: Content): number {
  return (
    programStorageGq(state, content) + rackStorageGb(state, content) + state.player.files.reduce((sum, file) => sum + file.sizeGq, 0)
  );
}

/** Room left on the gateway, in GB. Can be below 0 after losing a storage part. */
export function freeStorageGb(state: GameState, content: Content): number {
  return storageGb(state, content) - usedStorageGq(state, content);
}

/** True if the player has broken (or never needed) the password for this account. */
export function canLogIn(state: GameState, server: ServerDef, user: string): boolean {
  const account = findAccount(server, user);
  if (!account) return false;
  if (account.role !== 'admin' || securityOf(state, server).password === 0) return true;
  return state.player.passwords[server.id]?.includes(user) ?? false;
}

type Check = { ok: true; seconds: number; program: ProgramDef; level?: number } | { ok: false; reason: string };
const no = (reason: string): Check => ({ ok: false, reason });

/**
 * Decides whether a program can start on a target, and how long it will
 * take. `connection` is null for work done on the gateway itself.
 */
export function checkTask(state: GameState, content: Content, connection: Connection | null, target: TaskTarget): Check {
  const check = baseCheck(state, content, connection, target);
  if (!check.ok) return check;
  // The modem moves files; the processor does everything else.
  const files = target.kind === 'copyFile' || target.kind === 'deleteFile' || target.kind === 'uploadFile';
  let speed = files ? fileSpeed(state, content) : cpuSpeed(state, content);
  if (CRACKING.includes(target.kind)) speed *= 1 + effect(state, content, 'crackSpeed');
  // Nothing at stake, nothing else to do: an easy password on an unwatched server breaks quickly.
  if (target.kind === 'password' && connection && easyLock(state, content, connection.serverId)) speed *= content.rules.easyCrackSpeed ?? 1;
  if (target.kind === 'deleteLog') speed *= 1 + effect(state, content, 'logSpeed');
  return { ...check, seconds: check.seconds / speed };
}

/** True, in the first few jobs, for a server whose password is the easiest kind and which nobody watches. */
function easyLock(state: GameState, content: Content, serverId: string): boolean {
  const server = findServer(content, serverId);
  if (!server) return false;
  const security = securityOf(state, server);
  return security.password <= 1 && security.monitor === 0 && state.contracts.completed.length < (content.rules.easyCrackJobs ?? 0);
}

/** Running programs that take a slot: a Parallel build runs off to the side and does not. */
function usedSlots(state: GameState, content: Content): number {
  return state.tasks.filter((task) => !hasTrait(state, content, task.programId, 'parallel')).length;
}

/** checkTask on a stock gateway. */
function baseCheck(state: GameState, content: Content, connection: Connection | null, target: TaskTarget): Check {
  const most = maxPrograms(state, content);
  if (target.kind === 'build') {
    if (usedSlots(state, content) >= most) return no(`Your gateway can run ${most} programs at once.`);
    if (state.tasks.some((task) => task.target.kind === 'build')) return no('The Workbench is already building something.');
    const build = checkBuild(state, content, target.base, target.modules);
    if (!build.ok) return build;
    if (build.preview.sizeGq > freeStorageGb(state, content)) return no('Not enough room on your gateway for the build.');
    return { ok: true, seconds: build.seconds, program: findProgram(content, target.base)! };
  }
  const program = ownedProgram(state, content, PROGRAM_FOR[target.kind]);
  if (!program) {
    // On the drive but not in memory: say so, since the cure is different.
    const kind = PROGRAM_FOR[target.kind];
    const onDrive = needsMemory(kind) ? state.player.programs.map((id) => findProgram(content, id, state)).find((item) => item?.kind === kind) : undefined;
    return no(onDrive ? `${onDrive.name} is on your drive, not in memory. Load it before you connect.` : 'You do not own a program for that.');
  }
  if (!hasTrait(state, content, program.id, 'parallel') && usedSlots(state, content) >= most) {
    return no(`Your gateway can run ${most} programs at once.`);
  }
  const same = (task: Task) =>
    task.connectionId === (connection?.id ?? null) && JSON.stringify(task.target) === JSON.stringify(target);
  if (state.tasks.some(same)) return no('That is already running.');

  const against = (layer: string, level: number): Check => {
    // A Hot patch rebuilt the program for this layer on this connection: it meets it as an equal.
    if (connection?.patched === layer && level > program.version) return { ok: true, seconds: program.baseSeconds, program, level };
    const seconds = layerSeconds(program, level, 2 - effect(state, content, 'overreach'));
    if (seconds === null) return no(`${program.name} v${program.version} is too weak for this ${layer} (level ${level}).`);
    return { ok: true, seconds, program, level };
  };

  if (target.kind === 'decompile') {
    const file = state.player.files.find((item) => item.name === target.file);
    if (!file) return no('You have no such file.');
    if (!programFile(state, content, file.name)) return no('That is not a program. There is nothing to take apart.');
    if (file.encrypted) return no('Decrypt it first.');
    return { ok: true, seconds: (program.baseSeconds + program.secondsPerGq * file.sizeGq) / program.version, program };
  }

  if (target.kind === 'decrypt') {
    const file = state.player.files.find((item) => item.name === target.file);
    if (!file) return no('You have no such file.');
    if (!file.encrypted) return no('That file is not encrypted.');
    const check = against('encryption', file.encrypted);
    return check.ok ? { ...check, seconds: check.seconds + (program.secondsPerGq * file.sizeGq) / program.version } : check;
  }

  if (target.kind === 'scan') {
    const toScan = findServer(content, target.serverId);
    if (!toScan || toScan.kind === 'gateway') return no('No such server.');
    if (!state.knownServers.includes(target.serverId)) return no('You do not have that address.');
    if (state.scanned.includes(target.serverId)) return no('You have already scanned that server.');
    return { ok: true, seconds: program.baseSeconds / program.version, program };
  }

  const server = connection && findServer(content, connection.serverId);
  const serverState = connection && state.servers[connection.serverId];
  if (!connection || !server || !serverState) return no('That connection is closed.');
  const admin = connection.role === 'admin';
  const fileTime = (sizeGq: number): Check => ({
    ok: true,
    seconds: (program.baseSeconds + program.secondsPerGq * sizeGq) / program.version,
    program,
  });

  switch (target.kind) {
    case 'password': {
      const account = findAccount(server, target.user);
      if (!account) return no('No such account.');
      if (connection.user !== null) return no('You are already logged in.');
      if (canLogIn(state, server, target.user)) return no('You already have that password.');
      return against('password', securityOf(state, server).password);
    }
    case 'proxy':
    case 'firewall': {
      if (connection.user === null) return no('Log in first.');
      const level = securityOf(state, server)[target.kind];
      if (level === 0) return no(`This server has no ${target.kind}.`);
      if (connection.bypassed[target.kind]) return no(`The ${target.kind} is already bypassed.`);
      if (target.kind === 'firewall' && heldBy(state, content, server.id, 'firewall')) return no('The firewall is already held open from elsewhere.');
      return against(target.kind, level);
    }
    case 'monitor': {
      const level = securityOf(state, server).monitor;
      if (level === 0) return no('Nothing is watching this server closely enough to blind.');
      if (connection.monitor.blindMs > 0) return no('The monitor is already blind.');
      if (connection.monitor.used) return no('This monitor has seen that trick. Reconnect to try it again.');
      return against('monitor', level);
    }
    case 'copyFile':
    case 'deleteFile': {
      const file = serverState.files.find((item) => item.name === target.file);
      if (!file || (file.access === 'admin' && !admin)) return no('No such file.');
      if (securityOf(state, server).firewall > 0 && !connection.bypassed.firewall && !heldBy(state, content, server.id, 'firewall')) {
        return no('The firewall is blocking file access.');
      }
      if (target.kind === 'copyFile' && fileDef(content, server.id, file.name)?.part) {
        // A module installer goes into your parts, not onto the drive.
        if (partTaken(state, server.id, file.name)) return no('You have already taken that module.');
      } else if (target.kind === 'copyFile') {
        if (state.player.files.some((own) => own.name === file.name)) return no('You already have a copy of that file.');
        if (file.sizeGq > freeStorageGb(state, content)) return no('Not enough room on your gateway.');
      } else if (!admin) {
        return no('Only an administrator can delete files.');
      }
      return fileTime(file.sizeGq);
    }
    case 'uploadFile': {
      const file = state.player.files.find((item) => item.name === target.file);
      if (!file) return no('You have no such file.');
      if (!admin) return no('Only an administrator can put files on this server.');
      if (serverState.files.some((item) => item.name === file.name)) return no('The server already has a file by that name.');
      if (securityOf(state, server).firewall > 0 && !connection.bypassed.firewall && !heldBy(state, content, server.id, 'firewall')) {
        return no('The firewall is blocking file access.');
      }
      if (state.tasks.some((task) => task.target.kind === 'uploadFile' && task.target.file === file.name)) return no('That file is already being sent.');
      return fileTime(file.sizeGq);
    }
    case 'deleteLog': {
      if (!admin) return no('Only an administrator can change the log.');
      if (target.logIds.length === 0) return no('Pick the lines to remove first.');
      if (!target.logIds.every((id) => serverState.logs.some((entry) => entry.id === id))) return no('That log line is gone.');
      if (securityOf(state, server).proxy > 0 && !connection.bypassed.proxy) return no('The proxy is blocking changes.');
      // The first line takes the base time; each further line a third of that.
      const lines = 1 + (target.logIds.length - 1) / 3;
      return { ok: true, seconds: (program.baseSeconds * lines) / program.version, program };
    }
  }
}

/** How long a bypass keeps a monitor blind: the base time, doubled or halved per level of difference. */
export function blindSeconds(content: Content, program: ProgramDef, level: number): number {
  return content.rules.monitorBlindSeconds * 2 ** Math.min(1, program.version - level);
}

const ECHO_CELLS = 9;

/** A handshake pattern for a monitor of this level: longer as the level goes up. */
function newEcho(state: GameState, level: number): EchoPuzzle {
  const rng = stream(state, 'puzzle');
  const cells: number[] = [];
  const length = 3 + Math.ceil(level / 2);
  while (cells.length < length) {
    const cell = rng.int(0, ECHO_CELLS - 1);
    // Never the same cell twice running, so each step can be seen.
    if (cell !== cells[cells.length - 1]) cells.push(cell);
  }
  return { cells, entered: 0, result: 'open' };
}

/**
 * Repeats one cell of the handshake pattern. The whole pattern right
 * stretches the blind time that is left; one wrong cell shortens it and
 * ends the attempt. Returns a reason only if there was nothing to answer.
 */
export function echoCell(state: GameState, content: Content, connectionId: string, cell: number): string | null {
  const monitor = findConnection(state, connectionId)?.monitor;
  const echo = monitor?.echo;
  if (!monitor || !echo || echo.result !== 'open') return 'There is no handshake to answer.';
  if (!Number.isInteger(cell) || cell < 0 || cell >= ECHO_CELLS) return 'No such cell.';
  if (echo.cells[echo.entered] !== cell) {
    echo.result = 'lost';
    monitor.blindMs *= content.rules.echoPenaltyFactor;
    return null;
  }
  echo.entered++;
  if (echo.entered === echo.cells.length) {
    echo.result = 'won';
    monitor.blindMs *= content.rules.echoBonusFactor;
  }
  return null;
}

/** Applies a finished program that ran on the gateway itself. */
function finishLocal(state: GameState, content: Content, task: Task): void {
  const target = task.target;
  if (target.kind === 'build') return finishBuild(state, content, task);
  if (target.kind === 'decompile') return finishDecompile(state, content, task);
  if (target.kind === 'scan') {
    if (!state.scanned.includes(target.serverId)) state.scanned.push(target.serverId);
    return;
  }
  if (target.kind !== 'decrypt') return;
  const file = state.player.files.find((item) => item.name === target.file);
  if (file) delete file.encrypted;
}

function finish(state: GameState, content: Content, connection: Connection, task: Task): void {
  const serverState = state.servers[connection.serverId];
  const program = findProgram(content, task.programId, state);
  if (!serverState || !program) return;
  const target = task.target;
  // A Tidy build leaves no trace of what it did to files.
  const tidy = hasTrait(state, content, program.id, 'tidy');
  switch (target.kind) {
    case 'decrypt':
    case 'decompile':
    case 'build':
      return;
    case 'monitor': {
      const at = findServer(content, connection.serverId);
      const level = at ? securityOf(state, at).monitor : 0;
      connection.monitor = {
        blindMs: blindSeconds(content, program, connection.patched === 'monitor' ? Math.min(level, program.version) : level) * 1000,
        used: true,
        echo: newEcho(state, level),
      };
      return;
    }
    case 'password': {
      const known = (state.player.passwords[connection.serverId] ??= []);
      if (!known.includes(target.user)) known.push(target.user);
      return;
    }
    case 'proxy':
    case 'firewall':
      connection.bypassed[target.kind] = true;
      return;
    case 'copyFile': {
      const file = serverState.files.find((item) => item.name === target.file);
      if (!file) return;
      if (takePartFile(state, content, connection.serverId, file.name)) {
        if (!tidy) serverState.logs.push({ id: state.nextId++, timeMs: state.clock.gameTimeMs, text: `file copied: ${file.name}`, byPlayer: true });
        return;
      }
      // The first compiled program taken home brings Wren's note on decompiling.
      if (fileDef(content, connection.serverId, file.name)?.program && content.programs.some((item) => item.kind === 'decompile')) {
        once(state, 'decompiling', () => teachNow(state, content, 'decompiling'));
      }
      // A file the job rewrites as it is copied comes home saying something else.
      const rewritten = rewriteOnCopy(state, content, connection.serverId, file.name);
      const said = rewritten ?? file.text;
      state.player.files.push({
        name: file.name,
        sizeGq: file.sizeGq,
        from: connection.serverId,
        takenMs: state.clock.gameTimeMs,
        ...(file.encrypted ? { encrypted: file.encrypted } : {}),
        ...(said ? { text: said } : {}),
      });
      noteStolen(state, file.sizeGq);
      if (!tidy) serverState.logs.push({ id: state.nextId++, timeMs: state.clock.gameTimeMs, text: `file copied: ${file.name}`, byPlayer: true });
      return;
    }
    case 'deleteFile': {
      if (!serverState.files.some((item) => item.name === target.file)) return;
      serverState.files = serverState.files.filter((item) => item.name !== target.file);
      if (!tidy) serverState.logs.push({ id: state.nextId++, timeMs: state.clock.gameTimeMs, text: `file deleted: ${target.file}`, byPlayer: true });
      return;
    }
    case 'uploadFile': {
      const file = state.player.files.find((item) => item.name === target.file);
      if (!file || serverState.files.some((item) => item.name === file.name)) return;
      // It goes, rather than being copied: a planted file should not also be found at home.
      state.player.files = state.player.files.filter((item) => item !== file);
      serverState.files.push({
        name: file.name,
        sizeGq: file.sizeGq,
        access: 'admin',
        ...(file.encrypted ? { encrypted: file.encrypted } : {}),
        ...(file.text ? { text: file.text } : {}),
        ...(file.doctored ? { doctored: true } : {}),
      });
      if (!tidy) serverState.logs.push({ id: state.nextId++, timeMs: state.clock.gameTimeMs, text: `file uploaded: ${file.name}`, byPlayer: true });
      return;
    }
    case 'deleteLog':
      serverState.logs = serverState.logs.filter((entry) => !target.logIds.includes(entry.id));
      return;
  }
}

const MAX_RINGS = 5;

/**
 * A port line-up for a firewall of this level: more rings, turning
 * faster, as the level goes up. Steady hand slows the rings; Auto-align
 * locks some of them before the player starts.
 */
function newPuzzle(state: GameState, content: Content, level = 1): RingPuzzle {
  const steady = 1 - effect(state, content, 'steadyHand');
  const rng = stream(state, 'puzzle');
  const rings = Math.min(MAX_RINGS, 2 + level);
  const startAngles: number[] = [];
  const speeds: number[] = [];
  for (let i = 0; i < rings; i++) {
    startAngles.push(rng.int(40, 320));
    const direction = i % 2 === 0 ? 1 : -1;
    speeds.push(direction * (70 + 30 * i) * (1 + 0.15 * (level - 1)) * steady);
  }
  // Never all of them: the last ring is always the player's.
  const auto = Math.min(rings - 1, effect(state, content, 'autoAlign'));
  return { startAngles, speeds, locked: startAngles.map((_, i) => i < auto) };
}

/** Where a ring's port is right now, in degrees from the marker (0 to 360). */
export function ringAngle(task: Task, ring: number): number {
  const puzzle = task.puzzle;
  if (!puzzle || puzzle.locked[ring]) return 0;
  const angle = (puzzle.startAngles[ring] ?? 0) + ((puzzle.speeds[ring] ?? 0) * task.progressMs) / 1000;
  return ((angle % 360) + 360) % 360;
}

/** When, at or after `fromMs` of the task's running time, a ring's port next crosses the marker. */
function nextCrossingMs(puzzle: RingPuzzle, ring: number, fromMs: number): number {
  const start = puzzle.startAngles[ring] ?? 0;
  const speed = puzzle.speeds[ring] ?? 0;
  if (speed === 0) return fromMs;
  const at = start + (speed * fromMs) / 1000;
  const turn = speed > 0 ? Math.ceil(at / 360) : Math.floor(at / 360);
  return Math.max(fromMs, ((turn * 360 - start) / speed) * 1000);
}

/** The ring the program would lock next by itself, and when: the first open port to cross the marker from `fromMs` on. */
function nextAuto(puzzle: RingPuzzle, fromMs: number): { ring: number; atMs: number } | undefined {
  let best: { ring: number; atMs: number } | undefined;
  puzzle.locked.forEach((locked, ring) => {
    if (locked) return;
    const atMs = nextCrossingMs(puzzle, ring, fromMs);
    if (!best || atMs < best.atMs) best = { ring, atMs };
  });
  return best;
}

/**
 * Works out when the program will lock its next ring without help. The
 * time left is shared equally between the open rings; each is locked the
 * first time a port crosses the marker after its share is done. The last
 * ring's crossing is the moment the task ends, so a bypass never stops
 * with a port short of the marker or past it.
 */
function schedulePuzzle(task: Task): void {
  const puzzle = task.puzzle;
  if (!puzzle) return;
  const open = puzzle.locked.filter((locked) => !locked).length;
  if (open === 0) {
    delete puzzle.autoAtMs;
    return;
  }
  const shareEndsMs = task.progressMs + Math.max(0, task.durationMs - task.progressMs) / open;
  const next = nextAuto(puzzle, shareEndsMs);
  puzzle.autoAtMs = next?.atMs ?? shareEndsMs;
  if (open === 1) task.durationMs = puzzle.autoAtMs;
}

/** Lets the program lock the rings it has earned. True once none are left open. */
function advancePuzzle(task: Task): boolean {
  const puzzle = task.puzzle;
  if (!puzzle) return true;
  if (puzzle.locked.every((locked) => locked)) return true;
  if (puzzle.autoAtMs === undefined) schedulePuzzle(task);
  while (puzzle.autoAtMs !== undefined && task.progressMs >= puzzle.autoAtMs) {
    const next = nextAuto(puzzle, puzzle.autoAtMs);
    if (!next) break;
    // Schedule the next ring from the moment this one locked, not from the end of the tick.
    const now = task.progressMs;
    task.progressMs = puzzle.autoAtMs;
    puzzle.locked[next.ring] = true;
    schedulePuzzle(task);
    task.progressMs = now;
  }
  return puzzle.locked.every((locked) => locked);
}

/**
 * Tries to lock one ring of a task's port line-up. A hit takes that
 * ring's share off the time left (the last ring finishes the task); a
 * miss adds time. Returns a reason only if there was nothing to lock.
 */
export function lockRing(state: GameState, content: Content, taskId: string, ring: number): string | null {
  const task = state.tasks.find((item) => item.id === taskId);
  const puzzle = task?.puzzle;
  if (!task || !puzzle) return 'That program has already stopped.';
  if (puzzle.locked[ring] !== false) return 'That port is already lined up.';

  const angle = ringAngle(task, ring);
  const offBy = Math.min(angle, 360 - angle);
  if (offBy > ringTolerance(state, content)) {
    task.durationMs += content.rules.ringMissSeconds * 1000;
    schedulePuzzle(task);
    return null;
  }
  const openBefore = puzzle.locked.filter((locked) => !locked).length;
  puzzle.locked[ring] = true;
  const remaining = Math.max(0, task.durationMs - task.progressMs);
  task.durationMs = task.progressMs + (remaining * (openBefore - 1)) / openBefore;
  schedulePuzzle(task);
  return null;
}

/** Starts a program, over a connection or (connectionId null) on the gateway. Returns a reason if it can't start. */
export function startTask(state: GameState, content: Content, connectionId: string | null, target: TaskTarget): string | null {
  const connection = findConnection(state, connectionId) ?? null;
  const atHome = target.kind === 'decrypt' || target.kind === 'decompile' || target.kind === 'build' || target.kind === 'scan';
  if ((connection === null) !== atHome) {
    return connection ? 'That runs on your gateway, not over a connection.' : 'That connection is closed.';
  }
  const check = checkTask(state, content, connection, target);
  if (!check.ok) return check.reason;
  const puzzle = target.kind === 'firewall' ? newPuzzle(state, content, check.level) : undefined;
  // Rings that start locked have already taken their share off the time.
  const open = puzzle ? puzzle.locked.filter((locked) => !locked).length / puzzle.locked.length : 1;
  const task: Task = {
    id: `t${state.nextId++}`,
    programId: check.program.id,
    connectionId: connection?.id ?? null,
    target,
    progressMs: 0,
    durationMs: check.seconds * 1000 * open,
    ...(puzzle ? { puzzle } : {}),
  };
  schedulePuzzle(task);
  state.tasks.push(task);
  if (target.kind === 'build') takeModules(state, target.modules);
  // Monitors notice programs working on their server. They don't notice being blinded, work done at home, or a Quiet build.
  if (connection && target.kind !== 'monitor' && !hasTrait(state, content, check.program.id, 'quiet')) {
    noteIntrusion(state, content, connection);
  }
  return null;
}

/** Moves every running program forward and applies the ones that finish. */
export function advanceTasks(state: GameState, content: Content, simMs: number): void {
  // An Overclock runs everything on its connection faster until it burns out.
  const surge = new Map<string, number>();
  for (const connection of state.connections) {
    const left = connection.surgeMs ?? 0;
    if (left <= 0) continue;
    surge.set(connection.id, Math.min(simMs, left) * (SURGE_SPEED - 1));
    connection.surgeMs = Math.max(0, left - simMs);
  }
  for (const task of [...state.tasks]) {
    task.progressMs += simMs + (task.connectionId === null ? 0 : (surge.get(task.connectionId) ?? 0));
    // A port line-up ends when its last ring locks, which is also when its time runs out.
    if (task.puzzle ? !advancePuzzle(task) : task.progressMs < task.durationMs) continue;
    state.tasks = state.tasks.filter((other) => other !== task);
    if (task.connectionId === null) {
      finishLocal(state, content, task);
      continue;
    }
    const connection = findConnection(state, task.connectionId);
    if (connection) finish(state, content, connection, task);
  }
}
