/**
 * Programs. Running one against a connection creates a task that takes
 * time; when it finishes, its effect is applied.
 */
import type { ProgramDef, ProgramKind, ServerDef } from '../content/schema';
import type { Connection, EchoPuzzle, GameState, RingPuzzle, Task, TaskTarget } from './state';
import { cpuSpeed, fileSpeed, maxPrograms, rackStorageGb, storageGb } from './hardware';
import { stream } from './streams';
import { noteIntrusion } from './trace';
import { findAccount, findConnection, findProgram, findServer, ownedProgram, type Content } from './world';

/** A program this many levels below a layer can't touch it at all. */
export const MAX_LEVEL_GAP = 2;

const PROGRAM_FOR: Record<TaskTarget['kind'], ProgramKind> = {
  password: 'breakPassword',
  proxy: 'bypassProxy',
  firewall: 'bypassFirewall',
  monitor: 'bypassMonitor',
  decrypt: 'decrypt',
  copyFile: 'copyFile',
  deleteFile: 'deleteFile',
  deleteLog: 'deleteLog',
};

/**
 * How long a program needs against a layer. A program as strong as the
 * layer takes its base time; each level the layer is ahead doubles it,
 * each level the program is ahead halves it. Null = too weak to work.
 */
export function layerSeconds(program: ProgramDef, level: number): number | null {
  const gap = level - program.version;
  if (gap > MAX_LEVEL_GAP) return null;
  return program.baseSeconds * 2 ** gap;
}

/** Room taken on the gateway by installed programs. */
export function programStorageGq(state: GameState, content: Content): number {
  return state.player.programs.reduce((sum, id) => sum + (findProgram(content, id)?.sizeGq ?? 0), 0);
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
  if (account.role !== 'admin' || server.security.password === 0) return true;
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
  const files = target.kind === 'copyFile' || target.kind === 'deleteFile';
  return { ...check, seconds: check.seconds / (files ? fileSpeed(state, content) : cpuSpeed(state, content)) };
}

/** checkTask on a stock gateway. */
function baseCheck(state: GameState, content: Content, connection: Connection | null, target: TaskTarget): Check {
  const program = ownedProgram(state, content, PROGRAM_FOR[target.kind]);
  if (!program) return no('You do not own a program for that.');
  const most = maxPrograms(state, content);
  if (state.tasks.length >= most) return no(`Your gateway can run ${most} programs at once.`);
  const same = (task: Task) =>
    task.connectionId === (connection?.id ?? null) && JSON.stringify(task.target) === JSON.stringify(target);
  if (state.tasks.some(same)) return no('That is already running.');

  const against = (layer: string, level: number): Check => {
    const seconds = layerSeconds(program, level);
    if (seconds === null) return no(`${program.name} v${program.version} is too weak for this ${layer} (level ${level}).`);
    return { ok: true, seconds, program, level };
  };

  if (target.kind === 'decrypt') {
    const file = state.player.files.find((item) => item.name === target.file);
    if (!file) return no('You have no such file.');
    if (!file.encrypted) return no('That file is not encrypted.');
    const check = against('encryption', file.encrypted);
    return check.ok ? { ...check, seconds: check.seconds + (program.secondsPerGq * file.sizeGq) / program.version } : check;
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
      return against('password', server.security.password);
    }
    case 'proxy':
    case 'firewall': {
      if (connection.user === null) return no('Log in first.');
      const level = server.security[target.kind];
      if (level === 0) return no(`This server has no ${target.kind}.`);
      if (connection.bypassed[target.kind]) return no(`The ${target.kind} is already bypassed.`);
      return against(target.kind, level);
    }
    case 'monitor': {
      const level = server.security.monitor;
      if (level === 0) return no('Nothing is watching this server closely enough to blind.');
      if (connection.monitor.blindMs > 0) return no('The monitor is already blind.');
      if (connection.monitor.used) return no('This monitor has seen that trick. Reconnect to try it again.');
      return against('monitor', level);
    }
    case 'copyFile':
    case 'deleteFile': {
      const file = serverState.files.find((item) => item.name === target.file);
      if (!file || (file.access === 'admin' && !admin)) return no('No such file.');
      if (server.security.firewall > 0 && !connection.bypassed.firewall) return no('The firewall is blocking file access.');
      if (target.kind === 'copyFile') {
        if (state.player.files.some((own) => own.name === file.name)) return no('You already have a copy of that file.');
        if (file.sizeGq > freeStorageGb(state, content)) return no('Not enough room on your gateway.');
      } else if (!admin) {
        return no('Only an administrator can delete files.');
      }
      return fileTime(file.sizeGq);
    }
    case 'deleteLog': {
      if (!admin) return no('Only an administrator can change the log.');
      if (target.logIds.length === 0) return no('Pick the lines to remove first.');
      if (!target.logIds.every((id) => serverState.logs.some((entry) => entry.id === id))) return no('That log line is gone.');
      if (server.security.proxy > 0 && !connection.bypassed.proxy) return no('The proxy is blocking changes.');
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
function finishLocal(state: GameState, task: Task): void {
  const target = task.target;
  if (target.kind !== 'decrypt') return;
  const file = state.player.files.find((item) => item.name === target.file);
  if (file) delete file.encrypted;
}

function finish(state: GameState, content: Content, connection: Connection, task: Task): void {
  const serverState = state.servers[connection.serverId];
  const program = findProgram(content, task.programId);
  if (!serverState || !program) return;
  const target = task.target;
  switch (target.kind) {
    case 'decrypt':
      return;
    case 'monitor': {
      const level = findServer(content, connection.serverId)?.security.monitor ?? 0;
      connection.monitor = {
        blindMs: blindSeconds(content, program, level) * 1000,
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
      state.player.files.push({
        name: file.name,
        sizeGq: file.sizeGq,
        from: connection.serverId,
        ...(file.encrypted ? { encrypted: file.encrypted } : {}),
      });
      serverState.logs.push({ id: state.nextId++, timeMs: state.clock.gameTimeMs, text: `file copied: ${file.name}`, byPlayer: true });
      return;
    }
    case 'deleteFile': {
      if (!serverState.files.some((item) => item.name === target.file)) return;
      serverState.files = serverState.files.filter((item) => item.name !== target.file);
      serverState.logs.push({ id: state.nextId++, timeMs: state.clock.gameTimeMs, text: `file deleted: ${target.file}`, byPlayer: true });
      return;
    }
    case 'deleteLog':
      serverState.logs = serverState.logs.filter((entry) => !target.logIds.includes(entry.id));
      return;
  }
}

const MAX_RINGS = 5;

/** A port line-up for a firewall of this level: more rings, turning faster, as the level goes up. */
function newPuzzle(state: GameState, level = 1): RingPuzzle {
  const rng = stream(state, 'puzzle');
  const rings = Math.min(MAX_RINGS, 2 + level);
  const startAngles: number[] = [];
  const speeds: number[] = [];
  for (let i = 0; i < rings; i++) {
    startAngles.push(rng.int(40, 320));
    const direction = i % 2 === 0 ? 1 : -1;
    speeds.push(direction * (70 + 30 * i) * (1 + 0.15 * (level - 1)));
  }
  return { startAngles, speeds, locked: startAngles.map(() => false) };
}

/** Where a ring's port is right now, in degrees from the marker (0 to 360). */
export function ringAngle(task: Task, ring: number): number {
  const puzzle = task.puzzle;
  if (!puzzle || puzzle.locked[ring]) return 0;
  const angle = (puzzle.startAngles[ring] ?? 0) + ((puzzle.speeds[ring] ?? 0) * task.progressMs) / 1000;
  return ((angle % 360) + 360) % 360;
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
  if (offBy > content.rules.ringToleranceDegrees) {
    task.durationMs += content.rules.ringMissSeconds * 1000;
    return null;
  }
  const openBefore = puzzle.locked.filter((locked) => !locked).length;
  puzzle.locked[ring] = true;
  const remaining = Math.max(0, task.durationMs - task.progressMs);
  task.durationMs = task.progressMs + (remaining * (openBefore - 1)) / openBefore;
  return null;
}

/** Starts a program, over a connection or (connectionId null) on the gateway. Returns a reason if it can't start. */
export function startTask(state: GameState, content: Content, connectionId: string | null, target: TaskTarget): string | null {
  const connection = findConnection(state, connectionId) ?? null;
  if ((connection === null) !== (target.kind === 'decrypt')) {
    return connection ? 'That runs on your gateway, not over a connection.' : 'That connection is closed.';
  }
  const check = checkTask(state, content, connection, target);
  if (!check.ok) return check.reason;
  state.tasks.push({
    id: `t${state.nextId++}`,
    programId: check.program.id,
    connectionId: connection?.id ?? null,
    target,
    progressMs: 0,
    durationMs: check.seconds * 1000,
    ...(target.kind === 'firewall' ? { puzzle: newPuzzle(state, check.level) } : {}),
  });
  // Monitors notice programs working on their server. They don't notice being blinded, or work done at home.
  if (connection && target.kind !== 'monitor') noteIntrusion(content, connection);
  return null;
}

/** Moves every running program forward and applies the ones that finish. */
export function advanceTasks(state: GameState, content: Content, simMs: number): void {
  for (const task of [...state.tasks]) {
    task.progressMs += simMs;
    if (task.progressMs < task.durationMs) continue;
    state.tasks = state.tasks.filter((other) => other !== task);
    if (task.connectionId === null) {
      finishLocal(state, task);
      continue;
    }
    const connection = findConnection(state, task.connectionId);
    if (connection) finish(state, content, connection, task);
  }
}
