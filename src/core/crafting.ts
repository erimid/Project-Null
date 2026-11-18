/**
 * The Workbench: fitting modules to a program the player owns to build a
 * crafted version of it, scrapping a build to get the modules back, and
 * (with the Refine skill) melting two modules into a better one.
 *
 * Building runs on the gateway like decrypting does (a task with target
 * kind "build"); the modules are taken when it starts and given back if
 * it is stopped.
 */
import type { ModuleDef } from '../content/modules';
import type { ProgramDef } from '../content/schema';
import { describeBuild, type BuiltProgram } from './builds';
import { effect } from './skills';
import type { Fitted, GameState, Task } from './state';
import { findProgram, type Content } from './world';

export const findModule = (content: Content, id: string): ModuleDef | undefined => content.modules.find((module) => module.id === id);

/** Key of a module and grade in the player's parts. */
export const partKey = (id: string, grade: number): string => `${id}:${grade}`;

/** How many of a module, at a grade, the player has. */
export const partCount = (state: GameState, id: string, grade: number): number => state.player.parts[partKey(id, grade)] ?? 0;

export function addParts(state: GameState, id: string, grade: number, count = 1): void {
  const key = partKey(id, grade);
  const left = (state.player.parts[key] ?? 0) + count;
  if (left > 0) state.player.parts[key] = left;
  else delete state.player.parts[key];
}

/** Modules one build can take. */
export const moduleSlots = (state: GameState, content: Content): number => 1 + effect(state, content, 'secondSlot');

/** The crafted program behind an id, if it is one. */
export function findBuilt(state: GameState, content: Content, id: string): BuiltProgram | undefined {
  const program = findProgram(content, id, state);
  return program && 'traits' in program ? (program as BuiltProgram) : undefined;
}

/** True if the program is a crafted one with this trait. */
export const hasTrait = (state: GameState, content: Content, programId: string, trait: 'quiet' | 'tidy'): boolean =>
  findBuilt(state, content, programId)?.traits.includes(trait) ?? false;

/** Market programs the player has installed, which can be built on. */
export function buildBases(state: GameState, content: Content): ProgramDef[] {
  return content.programs.filter((program) => state.player.programs.includes(program.id) && program.kind !== 'traceTracker');
}

type BuildCheck = { ok: true; preview: BuiltProgram; seconds: number } | { ok: false; reason: string };

/** Whether `modules` can be fitted to `baseId` now, what would come out, and how long it would take on a stock processor. */
export function checkBuild(state: GameState, content: Content, baseId: string, modules: readonly Fitted[]): BuildCheck {
  const no = (reason: string): BuildCheck => ({ ok: false, reason });
  const base = content.programs.find((program) => program.id === baseId);
  if (!base || !state.player.programs.includes(base.id)) return no('Pick a program you have installed.');
  if (base.kind === 'traceTracker') return no('The Trace Tracker takes no modules.');
  if (modules.length === 0) return no('Pick a module to fit.');
  const slots = moduleSlots(state, content);
  if (modules.length > slots) return no(slots === 1 ? 'A build takes one module.' : `A build takes up to ${slots} modules.`);
  const needed = new Map<string, number>();
  for (const fitted of modules) {
    const module = findModule(content, fitted.id);
    if (!module || !module.grades[fitted.grade - 1]) return no('No such module.');
    if (!module.fits.includes(base.kind)) return no(`${module.name} does nothing for a ${base.name}.`);
    if (modules.filter((other) => other.id === fitted.id).length > 1) return no(`One ${module.name} module per build.`);
    const key = partKey(fitted.id, fitted.grade);
    needed.set(key, (needed.get(key) ?? 0) + 1);
  }
  for (const [key, count] of needed) {
    if ((state.player.parts[key] ?? 0) < count) return no('You do not have that module.');
  }
  const preview = describeBuild(state, content, 'preview', base.id, modules);
  if (!preview) return no('No such module.');
  // On a stock processor; checkTask scales it to the gateway's.
  return { ok: true, preview, seconds: content.rules.buildSeconds * modules.length };
}

/** Takes the modules for a build that is starting. */
export function takeModules(state: GameState, modules: readonly Fitted[]): void {
  for (const fitted of modules) addParts(state, fitted.id, fitted.grade, -1);
}

/** Gives back the modules of a build that was stopped before it finished. */
export function returnModules(state: GameState, task: Task): void {
  if (task.target.kind !== 'build') return;
  for (const fitted of task.target.modules) addParts(state, fitted.id, fitted.grade);
}

/** Finishes a build: the new program is installed beside the one it was built from. */
export function finishBuild(state: GameState, task: Task): void {
  if (task.target.kind !== 'build') return;
  const id = `b${state.nextId++}`;
  state.player.builds.push({ id, base: task.target.base, modules: task.target.modules.map((fitted) => ({ ...fitted })) });
  state.player.programs.push(id);
}

/** Takes a crafted program apart: it is gone, and its modules go back on the shelf. */
export function scrapBuild(state: GameState, programId: string): string | null {
  const build = state.player.builds.find((item) => item.id === programId);
  if (!build) return 'Only programs you built can be scrapped.';
  if (state.tasks.some((task) => task.programId === programId)) return 'That program is running. Stop it first.';
  for (const fitted of build.modules) addParts(state, fitted.id, fitted.grade);
  state.player.builds = state.player.builds.filter((item) => item !== build);
  state.player.programs = state.player.programs.filter((id) => id !== programId);
  for (const [kind, id] of Object.entries(state.player.preferred)) if (id === programId) delete state.player.preferred[kind];
  return null;
}

/** Melts two modules of one grade into one of the next grade. Needs the Refine skill. */
export function refineModule(state: GameState, content: Content, id: string, grade: number): string | null {
  if (effect(state, content, 'refine') <= 0) return 'You need the Refine skill for that.';
  const module = findModule(content, id);
  if (!module || !module.grades[grade - 1]) return 'No such module.';
  if (grade >= module.grades.length) return `${module.name} ${grade} is as good as it gets.`;
  if (partCount(state, id, grade) < 2) return `Refining takes two ${module.name} ${grade} modules.`;
  addParts(state, id, grade, -2);
  addParts(state, id, grade + 1);
  return null;
}

/** Picks which installed program runs for its kind. */
export function preferProgram(state: GameState, content: Content, programId: string): string | null {
  const program = findProgram(content, programId, state);
  if (!program || !state.player.programs.includes(programId)) return 'That program is not installed.';
  state.player.preferred[program.kind] = programId;
  return null;
}
