/**
 * Shop-window sums: how a program on a shelf measures up against the one
 * the player runs now. Nothing here changes the game; screens use it to
 * say "this is 40% faster than yours" without doing the sums themselves.
 */
import type { ProgramDef, ProgramKind } from '../content/schema';
import type { GameState } from './state';
import { ownsProgram } from './loadout';
import { installedOfKind, ownedProgram, type Content } from './world';

/** The size of file the file programs are timed on, so a copier that is slow to start but quick per GB compares fairly. */
export const REFERENCE_FILE_GB = 10;

/**
 * Seconds a program takes over a standard piece of work: a level 1 layer,
 * or a 10 GB file. 0 for programs that take no time at all (a route
 * planner, a tracker).
 */
export const programPace = (program: ProgramDef): number =>
  (program.baseSeconds + program.secondsPerGq * REFERENCE_FILE_GB) / program.version;

/** The quickest pace of any program of a kind in the catalogue. 0 if the kind takes no time. */
export function bestPace(content: Content, kind: ProgramKind): number {
  const paces = content.programs.filter((program) => program.kind === kind).map(programPace).filter((pace) => pace > 0);
  return paces.length > 0 ? Math.min(...paces) : 0;
}

/** The highest version of a kind in the catalogue. */
export const topVersion = (content: Content, kind: ProgramKind): number =>
  Math.max(1, ...content.programs.filter((program) => program.kind === kind).map((program) => program.version));

/** How fast a program is against the quickest of its kind, 0 to 1. Undefined for programs that take no time. */
export function speedShare(content: Content, program: ProgramDef): number | undefined {
  const pace = programPace(program);
  const best = bestPace(content, program.kind);
  return pace > 0 && best > 0 ? Math.min(1, best / pace) : undefined;
}

export interface ProgramComparison {
  /** True if this very program is installed. */
  readonly owned: boolean;
  /** The program of the same kind that runs now, if the player has one. */
  readonly current?: ProgramDef;
  /** How many times as fast as the current one (2 = twice as fast). Undefined with nothing to compare, or for programs that take no time. */
  readonly speed?: number;
  /** Versions above (or, negative, below) the current one. A higher version takes on stronger security. */
  readonly versions: number;
  /** Extra room it takes over the current one, in GB. Negative = smaller. */
  readonly sizeGq: number;
  /** True if buying it would be a step up: a kind the player lacks, a higher version, or the same version but faster. */
  readonly upgrade: boolean;
}

/** Measures a program against the one of its kind the player runs now. */
export function compareProgram(state: GameState, content: Content, program: ProgramDef): ProgramComparison {
  const owned = ownsProgram(state, program.id);
  // What runs now: the one in memory, or with none loaded the strongest on the drive.
  const current = ownedProgram(state, content, program.kind) ?? installedOfKind(state, content, program.kind)[0];
  if (!current) return { owned, versions: 0, sizeGq: 0, upgrade: !owned };
  const mine = programPace(current);
  const theirs = programPace(program);
  const speed = mine > 0 && theirs > 0 ? mine / theirs : undefined;
  const versions = program.version - current.version;
  const faster = speed !== undefined && speed > 1.01;
  return {
    owned,
    current,
    speed,
    versions,
    sizeGq: program.sizeGq - current.sizeGq,
    upgrade: !owned && current.id !== program.id && (versions > 0 || (versions === 0 && faster)),
  };
}
