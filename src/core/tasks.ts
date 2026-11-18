/**
 * Programs. Running one against a connection creates a task that takes
 * time; when it finishes, its effect is applied.
 */
import type { ProgramDef, ProgramKind, ServerDef } from '../content/schema';
import type { Connection, GameState, ServerState, Task, TaskTarget } from './state';
import { noteIntrusion } from './trace';
import { findAccount, findConnection, findProgram, findServer, ownedProgram, type Content } from './world';

/** A program this many levels below a layer can't touch it at all. */
export const MAX_LEVEL_GAP = 2;

const PROGRAM_FOR: Record<TaskTarget['kind'], ProgramKind> = {
  password: 'breakPassword',
  proxy: 'bypassProxy',
  firewall: 'bypassFirewall',
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

export function usedStorageGq(state: GameState): number {
  return state.player.files.reduce((sum, file) => sum + file.sizeGq, 0);
}

/** True if the player has broken (or never needed) the password for this account. */
export function canLogIn(state: GameState, server: ServerDef, user: string): boolean {
  const account = findAccount(server, user);
  if (!account) return false;
  if (account.role !== 'admin' || server.security.password === 0) return true;
  return state.player.passwords[server.id]?.includes(user) ?? false;
}

type Check = { ok: true; seconds: number; program: ProgramDef } | { ok: false; reason: string };
const no = (reason: string): Check => ({ ok: false, reason });

/** Decides whether a program can start on a target, and how long it will take. */
export function checkTask(state: GameState, content: Content, connection: Connection, target: TaskTarget): Check {
  const server = findServer(content, connection.serverId);
  const serverState = state.servers[connection.serverId];
  if (!server || !serverState) return no('That connection is closed.');

  const program = ownedProgram(state, content, PROGRAM_FOR[target.kind]);
  if (!program) return no('You do not own a program for that.');
  if (state.tasks.length >= content.rules.maxRunningPrograms) {
    return no(`Your gateway can run ${content.rules.maxRunningPrograms} programs at once.`);
  }
  const same = (task: Task) =>
    task.connectionId === connection.id && JSON.stringify(task.target) === JSON.stringify(target);
  if (state.tasks.some(same)) return no('That is already running.');

  const against = (layer: string, level: number): Check => {
    const seconds = layerSeconds(program, level);
    if (seconds === null) return no(`${program.name} v${program.version} is too weak for this ${layer} (level ${level}).`);
    return { ok: true, seconds, program };
  };
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
    case 'copyFile':
    case 'deleteFile': {
      const file = serverState.files.find((item) => item.name === target.file);
      if (!file || (file.access === 'admin' && !admin)) return no('No such file.');
      if (server.security.firewall > 0 && !connection.bypassed.firewall) return no('The firewall is blocking file access.');
      if (target.kind === 'copyFile') {
        if (state.player.files.some((own) => own.name === file.name)) return no('You already have a copy of that file.');
        if (usedStorageGq(state) + file.sizeGq > content.rules.storageGq) return no('Not enough room on your gateway.');
      } else if (!admin) {
        return no('Only an administrator can delete files.');
      }
      return fileTime(file.sizeGq);
    }
    case 'deleteLog': {
      if (!admin) return no('Only an administrator can change the log.');
      if (!serverState.logs.some((entry) => entry.id === target.logId)) return no('That log line is gone.');
      if (server.security.proxy > 0 && !connection.bypassed.proxy) return no('The proxy is blocking changes.');
      return { ok: true, seconds: program.baseSeconds / program.version, program };
    }
  }
}

function finish(state: GameState, serverState: ServerState, connection: Connection, task: Task): void {
  const target = task.target;
  switch (target.kind) {
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
      state.player.files.push({ name: file.name, sizeGq: file.sizeGq, from: connection.serverId });
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
      serverState.logs = serverState.logs.filter((entry) => entry.id !== target.logId);
      return;
  }
}

/** Starts a program. Returns a reason if it can't start. */
export function startTask(state: GameState, content: Content, connectionId: string, target: TaskTarget): string | null {
  const connection = findConnection(state, connectionId);
  if (!connection) return 'That connection is closed.';
  const check = checkTask(state, content, connection, target);
  if (!check.ok) return check.reason;
  state.tasks.push({
    id: `t${state.nextId++}`,
    programId: check.program.id,
    connectionId,
    target,
    progressMs: 0,
    durationMs: check.seconds * 1000,
  });
  // Monitors notice programs working on their server.
  noteIntrusion(content, connection);
  return null;
}

/** Moves every running program forward and applies the ones that finish. */
export function advanceTasks(state: GameState, content: Content, simMs: number): void {
  for (const task of [...state.tasks]) {
    task.progressMs += simMs;
    if (task.progressMs < task.durationMs) continue;
    state.tasks = state.tasks.filter((other) => other !== task);
    const connection = findConnection(state, task.connectionId);
    const serverState = connection && state.servers[connection.serverId];
    if (connection && serverState && findProgram(content, task.programId)) finish(state, serverState, connection, task);
  }
}
