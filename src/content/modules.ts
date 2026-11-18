/**
 * Modules: parts that are fitted to a program the player owns to make a
 * crafted version of it (see core/crafting.ts). Written in
 * modules.json; checked here when the game starts.
 */
import { ContentError, PROGRAM_KINDS, type ContractDef, type PartDef, type ProgramDef, type ProgramKind, type ServerDef } from './schema';

/** Highest grade a module comes in. Grades run 1 to this. */
export const MAX_GRADE = 3;

export const MODULE_TRAITS = ['quiet', 'tidy'] as const;
/**
 * Something a module makes a program do besides changing its speed and size.
 * - quiet: starting it does not alert a monitor, and a monitor back from blind does not notice it running.
 * - tidy: files it copies or deletes leave no line in the access log.
 */
export type ModuleTrait = (typeof MODULE_TRAITS)[number];

export interface ModuleGrade {
  /** The program runs this many times as fast. Below 1 = slower. */
  readonly speed: number;
  /** The program takes this many times the room. */
  readonly size: number;
  /** Credits, where one is sold. */
  readonly price: number;
}

export interface ModuleDef {
  readonly id: string;
  readonly name: string;
  readonly blurb: string;
  readonly trait?: ModuleTrait;
  /** Kinds of program it can be fitted to. */
  readonly fits: readonly ProgramKind[];
  /** Grade 1 first. */
  readonly grades: readonly ModuleGrade[];
}

export function parseModules(data: unknown, file = 'modules.json'): ModuleDef[] {
  if (!Array.isArray(data)) throw new ContentError(file, 'must be a list of modules');
  const seen = new Set<string>();
  return data.map((raw: unknown, index): ModuleDef => {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new ContentError(file, `entry ${index} must be an object`);
    const item = raw as Record<string, unknown>;
    const text = (key: string): string => {
      const value = item[key];
      if (typeof value !== 'string' || value.trim() === '') throw new ContentError(file, `entry ${index} needs a non-empty text "${key}"`);
      return value;
    };
    const id = text('id');
    const where = `module "${id}"`;
    if (seen.has(id)) throw new ContentError(file, `module id "${id}" is used twice`);
    seen.add(id);
    const trait = item['trait'];
    if (trait !== undefined && !(MODULE_TRAITS as readonly unknown[]).includes(trait)) {
      throw new ContentError(file, `${where}: trait must be one of ${MODULE_TRAITS.join(', ')}`);
    }
    const fits = item['fits'];
    if (!Array.isArray(fits) || fits.length === 0 || !fits.every((kind) => (PROGRAM_KINDS as readonly unknown[]).includes(kind))) {
      throw new ContentError(file, `${where}: fits must be a list of program kinds`);
    }
    if (fits.includes('traceTracker')) throw new ContentError(file, `${where}: the Trace Tracker takes no modules`);
    const grades = item['grades'];
    if (!Array.isArray(grades) || grades.length !== MAX_GRADE) throw new ContentError(file, `${where} needs ${MAX_GRADE} grades`);
    return {
      id,
      name: text('name'),
      blurb: text('blurb'),
      ...(trait !== undefined ? { trait: trait as ModuleTrait } : {}),
      fits: fits as ProgramKind[],
      grades: grades.map((grade: unknown, g): ModuleGrade => {
        const value = grade as Record<string, unknown>;
        const number = (key: string, min: number, max: number) => {
          const n = value?.[key];
          if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max) {
            throw new ContentError(file, `${where} grade ${g + 1} needs a number "${key}" between ${min} and ${max}`);
          }
          return n;
        };
        return { speed: number('speed', 0.1, 10), size: number('size', 0.1, 10), price: number('price', 0, 10_000_000) };
      }),
    };
  });
}

/** Checks that every module a server file or contract names exists, and every program a program file unlocks. */
export function checkParts(
  modules: readonly ModuleDef[],
  servers: readonly ServerDef[],
  contracts: readonly ContractDef[],
  programs: readonly ProgramDef[],
): void {
  const check = (file: string, where: string, part: PartDef) => {
    const module = modules.find((item) => item.id === part.id);
    if (!module) throw new ContentError(file, `${where}: module "${part.id}" is not in modules.json`);
    if (!module.grades[part.grade - 1]) throw new ContentError(file, `${where}: ${module.name} has no grade ${part.grade}`);
  };
  for (const server of servers) {
    for (const file of server.files) {
      const where = `server "${server.id}" file "${file.name}"`;
      if (file.part && file.program) throw new ContentError('servers/', `${where} cannot be both a module and a program`);
      if (file.part) check('servers/', where, file.part);
      if (file.program) {
        for (const part of file.program.modules) check('servers/', where, part);
        const unlocks = file.program.unlocks;
        if (unlocks !== undefined && !programs.some((program) => program.id === unlocks && program.price > 0)) {
          throw new ContentError('servers/', `${where}: unlocks "${unlocks}", which is not a program on the market`);
        }
      }
    }
  }
  for (const contract of contracts) if (contract.part) check('contracts.json', `contract "${contract.id}"`, contract.part);
}
