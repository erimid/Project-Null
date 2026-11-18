/**
 * What a crafted program is like: the market program it was built from,
 * changed by its modules. Kept apart from crafting.ts, which has the
 * rules for building, so that world.ts can look builds up without the
 * two importing each other.
 */
import type { ModuleDef, ModuleTrait } from '../content/modules';
import type { ProgramDef } from '../content/schema';
import type { SkillDef } from '../content/skills';
import type { Build, Fitted, GameState } from './state';

/** A crafted program as the rules see it: a program, plus what its modules make it do. */
export interface BuiltProgram extends ProgramDef {
  /** Id of the market program it was built from. */
  readonly base: string;
  readonly modules: readonly Fitted[];
  readonly traits: readonly ModuleTrait[];
}

interface Parts {
  readonly programs: readonly ProgramDef[];
  readonly modules: readonly ModuleDef[];
  readonly skills: readonly SkillDef[];
}

/** How much the Tight builds skill shrinks crafted programs: 1 = not at all. */
export function tightness(state: GameState, content: Parts): number {
  let cut = 0;
  for (const skill of content.skills) {
    if (skill.effect === 'tightBuilds') cut += skill.amount * (state.player.skills[skill.id] ?? 0);
  }
  return Math.max(0, 1 - cut);
}

/**
 * The program `modules` would make of `base`. Speeds and sizes multiply;
 * the room taken is rounded up to whole GB and is never below 1.
 * Undefined if the base or a module doesn't exist.
 */
export function describeBuild(
  state: GameState,
  content: Parts,
  id: string,
  baseId: string,
  modules: readonly Fitted[],
): BuiltProgram | undefined {
  const base = content.programs.find((program) => program.id === baseId);
  if (!base) return undefined;
  let speed = 1;
  let size = tightness(state, content);
  const traits: ModuleTrait[] = [];
  const names: string[] = [];
  for (const fitted of modules) {
    const module = content.modules.find((item) => item.id === fitted.id);
    const grade = module?.grades[fitted.grade - 1];
    if (!module || !grade) return undefined;
    speed *= grade.speed;
    size *= grade.size;
    if (module.trait && !traits.includes(module.trait)) traits.push(module.trait);
    names.push(`${module.name} ${fitted.grade}`);
  }
  return {
    ...base,
    id,
    name: `${base.name}, ${names.join(' + ')}`,
    baseSeconds: base.baseSeconds / speed,
    secondsPerGq: base.secondsPerGq / speed,
    price: 0,
    sizeGq: Math.max(1, Math.ceil(base.sizeGq * size)),
    base: base.id,
    modules: modules.map((fitted) => ({ ...fitted })),
    traits,
  };
}

/** A build the player owns, as a program. */
export const builtProgram = (state: GameState, content: Parts, build: Build): BuiltProgram | undefined =>
  describeBuild(state, content, build.id, build.base, build.modules);
