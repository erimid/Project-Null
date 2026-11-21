/**
 * Loadouts. The drive holds every program the player owns; memory holds
 * the few they take on a job. Only a program in memory can run over a
 * connection, so what to load is a choice made before connecting. One
 * program of each kind fits in memory at a time. Work done at home
 * (decrypting, scanning, planning a route) runs straight off the drive.
 *
 * Kept apart from tasks.ts so world.ts can ask what is loaded without the
 * two importing each other.
 */
import type { HardwareDef } from '../content/hardware';
import type { ProgramDef, ProgramKind, ServerDef } from '../content/schema';
import type { SkillDef } from '../content/skills';
import type { ModuleDef } from '../content/modules';
import { builtProgram } from './builds';
import { LOADOUT_SLOTS, type GameState } from './state';

/** The kinds of program that work over a connection, and so have to be in memory to run. */
export const FIELD_KINDS: readonly ProgramKind[] = ['breakPassword', 'bypassProxy', 'bypassFirewall', 'bypassMonitor', 'copyFile', 'deleteFile', 'deleteLog', 'traceTracker', 'jamTrace'];

/** True for a kind of program that has to be loaded into memory before it can run. */
export const needsMemory = (kind: ProgramKind): boolean => FIELD_KINDS.includes(kind);

interface Parts {
  readonly programs: readonly ProgramDef[];
  readonly hardware: readonly HardwareDef[];
  readonly skills: readonly SkillDef[];
  readonly modules: readonly ModuleDef[];
  readonly servers: readonly ServerDef[];
}

function programOf(state: GameState, content: Parts, id: string): ProgramDef | undefined {
  const program = content.programs.find((item) => item.id === id);
  if (program) return program;
  const build = state.player.builds.find((item) => item.id === id);
  return build && builtProgram(state, content, build);
}

/** Room in memory for loaded programs, in GB. A gateway with no memory part to speak of has no limit. */
export function memoryGb(state: GameState, content: Parts): number {
  const part = content.hardware.find((item) => item.slot === 'memory' && item.tier === state.player.hardware.memory);
  if (!part?.memoryGb) return Infinity;
  let extra = 0;
  for (const skill of content.skills) if (skill.effect === 'deepMemory') extra += skill.amount * (state.player.skills[skill.id] ?? 0);
  return part.memoryGb + extra;
}

/** The programs in memory, in the order they were loaded. Anything no longer installed is left out. */
export function loadedPrograms(state: GameState, content: Parts): ProgramDef[] {
  return state.player.loadout
    .filter((id) => state.player.programs.includes(id))
    .map((id) => programOf(state, content, id))
    .filter((program): program is ProgramDef => program !== undefined);
}

/** Memory taken by what is loaded, in GB. */
export const usedMemoryGb = (state: GameState, content: Parts): number => loadedPrograms(state, content).reduce((sum, program) => sum + program.sizeGq, 0);

/** Memory still free, in GB. */
export const freeMemoryGb = (state: GameState, content: Parts): number => memoryGb(state, content) - usedMemoryGb(state, content);

export const isLoaded = (state: GameState, programId: string): boolean => state.player.loadout.includes(programId) && state.player.programs.includes(programId);

/** The program of a kind that is in memory, if any. */
export function loadedOfKind(state: GameState, content: Parts, kind: ProgramKind): ProgramDef | undefined {
  return loadedPrograms(state, content).find((program) => program.kind === kind);
}

/**
 * True while the loadout cannot be changed: the player is inside
 * someone's server. A board or a directory is a shop counter, not a job,
 * so memory can still be repacked there.
 */
export function loadoutLocked(state: GameState, content: Parts): boolean {
  return state.connections.some((connection) => {
    const kind = content.servers.find((server) => server.id === connection.serverId)?.kind;
    return kind !== 'board' && kind !== 'directory';
  });
}

const LOCKED = 'Memory is locked while you are inside a server. Disconnect first.';

/** Why a program can't be loaded right now, or null if it can. A program of the same kind already in memory makes way for it. */
export function whyNotLoad(state: GameState, content: Parts, programId: string): string | null {
  const program = programOf(state, content, programId);
  if (!program || !state.player.programs.includes(programId)) return 'That program is not installed.';
  if (!needsMemory(program.kind)) return `${program.name} runs at home, straight off the drive. It needs no memory.`;
  if (isLoaded(state, programId)) return 'That is already in memory.';
  if (loadoutLocked(state, content)) return LOCKED;
  const swapped = loadedOfKind(state, content, program.kind);
  if (swapped && state.tasks.some((task) => task.programId === swapped.id)) return `${swapped.name} is running. Stop it first.`;
  const free = freeMemoryGb(state, content) + (swapped?.sizeGq ?? 0);
  if (program.sizeGq > free) return `Not enough memory: ${program.name} takes ${program.sizeGq} GB and ${Math.max(0, free)} GB is free. Unload something first.`;
  return null;
}

/** Puts a program into memory, in place of any other of its kind. No checks: see whyNotLoad. */
function place(state: GameState, content: Parts, program: ProgramDef): void {
  const others = new Set(loadedPrograms(state, content).filter((other) => other.kind === program.kind).map((other) => other.id));
  const at = state.player.loadout.findIndex((id) => others.has(id));
  state.player.loadout = state.player.loadout.filter((id) => !others.has(id) && id !== program.id && state.player.programs.includes(id));
  // It takes the place of the one it replaced, so the list keeps its order.
  state.player.loadout.splice(at < 0 ? state.player.loadout.length : Math.min(at, state.player.loadout.length), 0, program.id);
}

/** Loads a program into memory. Returns a reason if it can't. */
export function loadProgram(state: GameState, content: Parts, programId: string): string | null {
  const reason = whyNotLoad(state, content, programId);
  if (reason !== null) return reason;
  place(state, content, programOf(state, content, programId)!);
  return null;
}

/** Takes a program out of memory. It stays on the drive. */
export function unloadProgram(state: GameState, content: Parts, programId: string): string | null {
  if (!isLoaded(state, programId)) return 'That is not in memory.';
  if (loadoutLocked(state, content)) return LOCKED;
  if (state.tasks.some((task) => task.programId === programId)) return 'That program is running. Stop it first.';
  state.player.loadout = state.player.loadout.filter((id) => id !== programId);
  return null;
}

/**
 * A program has just arrived on the drive (bought, built, taken out of a
 * file). It goes into memory if nothing of its kind is there, or if it is
 * better than what is and there is room; otherwise it waits on the drive.
 * Works even while connected: a shop loads what it sells you.
 */
export function stowNew(state: GameState, content: Parts, programId: string): void {
  const program = programOf(state, content, programId);
  if (!program || !needsMemory(program.kind) || isLoaded(state, programId)) return;
  const current = loadedOfKind(state, content, program.kind);
  if (current && (current.version > program.version || state.tasks.some((task) => task.programId === current.id))) return;
  if (program.sizeGq > freeMemoryGb(state, content) + (current?.sizeGq ?? 0)) return;
  place(state, content, program);
}

/** Unloads from the end of the list until what is left fits: for a gateway that has lost memory. Returns what was unloaded. */
export function trimLoadout(state: GameState, content: Parts): string[] {
  const out: string[] = [];
  while (state.player.loadout.length > 0 && usedMemoryGb(state, content) > memoryGb(state, content)) out.push(state.player.loadout.pop()!);
  return out;
}

/** Forgets a program that has left the drive. */
export function dropFromMemory(state: GameState, programId: string): void {
  state.player.loadout = state.player.loadout.filter((id) => id !== programId);
  state.player.savedLoadouts = state.player.savedLoadouts.map((slot) => slot.filter((id) => id !== programId));
}

/**
 * Packs memory from scratch: the strongest program of each kind, in the
 * order a job needs them, for as long as they fit. For a new game, a save
 * from before loadouts, and the Pack button.
 */
export function autoPack(state: GameState, content: Parts): void {
  state.player.loadout = [];
  for (const kind of FIELD_KINDS) {
    const best = state.player.programs
      .map((id) => programOf(state, content, id))
      .filter((program): program is ProgramDef => program?.kind === kind)
      .sort((a, b) => b.version - a.version || a.sizeGq - b.sizeGq)
      .find((program) => program.sizeGq <= freeMemoryGb(state, content));
    if (best) state.player.loadout.push(best.id);
  }
}

/** Keeps what is in memory now in a slot, to load again later. */
export function saveLoadout(state: GameState, content: Parts, slot: number): string | null {
  if (!Number.isInteger(slot) || slot < 0 || slot >= LOADOUT_SLOTS) return 'There is no such slot.';
  const loaded = loadedPrograms(state, content).map((program) => program.id);
  if (loaded.length === 0) return 'There is nothing in memory to keep.';
  state.player.savedLoadouts[slot] = loaded;
  return null;
}

/**
 * Loads a kept loadout. Programs that have since left the drive are left
 * out, and one that no longer fits stays on the drive.
 */
export function useLoadout(state: GameState, content: Parts, slot: number): string | null {
  const saved = state.player.savedLoadouts[slot];
  if (!saved || saved.length === 0) return 'That slot is empty.';
  if (loadoutLocked(state, content)) return LOCKED;
  if (state.tasks.some((task) => isLoaded(state, task.programId))) return 'A loaded program is running. Stop it first.';
  state.player.loadout = [];
  for (const id of saved) {
    const program = programOf(state, content, id);
    if (!program || !state.player.programs.includes(id) || !needsMemory(program.kind)) continue;
    if (loadedOfKind(state, content, program.kind) || program.sizeGq > freeMemoryGb(state, content)) continue;
    state.player.loadout.push(id);
  }
  return null;
}

/** True if what is in memory now is exactly a kept loadout. */
export function matchesLoadout(state: GameState, content: Parts, slot: number): boolean {
  const saved = state.player.savedLoadouts[slot] ?? [];
  const loaded = loadedPrograms(state, content).map((program) => program.id);
  return saved.length > 0 && saved.length === loaded.length && saved.every((id) => loaded.includes(id));
}

/** True if the player has the market program, either as it was sold or built into something at the Workbench. */
export function ownsProgram(state: GameState, programId: string): boolean {
  return state.player.programs.includes(programId) || state.player.builds.some((build) => build.base === programId && state.player.programs.includes(build.id));
}
