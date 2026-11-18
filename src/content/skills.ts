/**
 * The skill tree. Written in skills.json; checked here when the game
 * starts. Skills are bought with points the player earns by raising
 * their rating (see core/skills.ts).
 */
import { ContentError } from './schema';

export const SKILL_BRANCHES = ['intrusion', 'ghost', 'engineering'] as const;
/**
 * - intrusion: breaking in faster.
 * - ghost: staying hidden and leaving less behind.
 * - engineering: hardware, and later building programs.
 */
export type SkillBranch = (typeof SKILL_BRANCHES)[number];

export const SKILL_EFFECTS = [
  'crackSpeed',
  'steadyHand',
  'extraPrograms',
  'overreach',
  'autoAlign',
  'traceSlow',
  'monitorGrace',
  'logSpeed',
  'coldTrail',
  'slipAway',
  'hardwareSpeed',
  'secondSlot',
  'tightBuilds',
  'refine',
] as const;
/**
 * What a skill does. `amount` is per rank, and ranks add up.
 * - crackSpeed: password, proxy and firewall programs run 1 + amount times as fast.
 * - steadyHand: port line-up rings turn (1 - amount) as fast, and lock from 1 + amount times as far.
 * - extraPrograms: this many more programs run at once.
 * - overreach: each level a layer is ahead of a program costs 2 - amount times the time, not 2.
 * - autoAlign: this many rings of each port line-up start locked.
 * - traceSlow: each step of a trace takes 1 + amount times as long.
 * - monitorGrace: monitors wait 1 + amount times as long before tracing.
 * - logSpeed: the Log Deleter runs 1 + amount times as fast.
 * - coldTrail: log reviews come 1 + amount times as late, and their fines are (1 - amount) as big.
 * - slipAway: this many more reroutes per connection, and each sends the trace back this many more relays.
 * - hardwareSpeed: the processor and modem run 1 + amount times as fast.
 * - secondSlot: crafted programs take this many more modules.
 * - tightBuilds: crafted programs take (1 - amount) of the room.
 * - refine: two modules of one grade can be melted into one of the next grade.
 */
export type SkillEffect = (typeof SKILL_EFFECTS)[number];

export interface SkillDef {
  readonly id: string;
  readonly branch: SkillBranch;
  /** Where it sits in its branch, 1 at the top. Only for laying out the tree. */
  readonly row: number;
  readonly name: string;
  readonly blurb: string;
  /** How many times it can be learned. */
  readonly ranks: number;
  /** Points for each rank. */
  readonly cost: number;
  /** Id of a skill in the same branch that must be learned first. */
  readonly needs?: string;
  readonly effect: SkillEffect;
  /** Size of the effect per rank. */
  readonly amount: number;
}

export function parseSkills(data: unknown, file = 'skills.json'): SkillDef[] {
  if (!Array.isArray(data)) throw new ContentError(file, 'must be a list of skills');
  const skills = data.map((raw: unknown, index): SkillDef => {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new ContentError(file, `entry ${index} must be an object`);
    const item = raw as Record<string, unknown>;
    const text = (key: string): string => {
      const value = item[key];
      if (typeof value !== 'string' || value.trim() === '') throw new ContentError(file, `entry ${index} needs a non-empty text "${key}"`);
      return value;
    };
    const id = text('id');
    const where = `skill "${id}"`;
    const whole = (key: string, min: number, max: number): number => {
      const value = item[key];
      if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
        throw new ContentError(file, `${where} needs a whole number "${key}" between ${min} and ${max}`);
      }
      return value;
    };
    const branch = text('branch');
    if (!(SKILL_BRANCHES as readonly string[]).includes(branch)) {
      throw new ContentError(file, `${where}: branch "${branch}" is not one of ${SKILL_BRANCHES.join(', ')}`);
    }
    const effect = text('effect');
    if (!(SKILL_EFFECTS as readonly string[]).includes(effect)) {
      throw new ContentError(file, `${where}: effect "${effect}" is not one of ${SKILL_EFFECTS.join(', ')}`);
    }
    const amount = item['amount'];
    if (typeof amount !== 'number' || !(amount > 0) || amount > 10) throw new ContentError(file, `${where} needs an amount above 0`);
    const needs = item['needs'];
    if (needs !== undefined && (typeof needs !== 'string' || needs === '')) throw new ContentError(file, `${where}: needs must be a skill id`);
    return {
      id,
      branch: branch as SkillBranch,
      row: whole('row', 1, 6),
      name: text('name'),
      blurb: text('blurb'),
      ranks: whole('ranks', 1, 5),
      cost: whole('cost', 1, 10),
      ...(needs !== undefined ? { needs } : {}),
      effect: effect as SkillEffect,
      amount,
    };
  });

  const ids = skills.map((skill) => skill.id);
  const repeated = ids.find((id, index) => ids.indexOf(id) !== index);
  if (repeated) throw new ContentError(file, `skill id "${repeated}" is used twice`);
  for (const skill of skills) {
    if (skill.needs === undefined) continue;
    const before = skills.find((other) => other.id === skill.needs);
    if (!before) throw new ContentError(file, `skill "${skill.id}" needs "${skill.needs}", which is not in the list`);
    if (before.branch !== skill.branch || before.row >= skill.row) {
      throw new ContentError(file, `skill "${skill.id}" needs "${skill.needs}", which must be higher up the same branch`);
    }
  }
  // Fractions of 1 that shrink something can't reach 1, or it would vanish.
  for (const effect of ['steadyHand', 'coldTrail', 'tightBuilds'] as const) {
    for (const skill of skills.filter((item) => item.effect === effect)) {
      if (skill.amount * skill.ranks >= 1) throw new ContentError(file, `skill "${skill.id}": ${effect} must stay below 1 at full rank`);
    }
  }
  for (const skill of skills.filter((item) => item.effect === 'overreach')) {
    if (skill.amount * skill.ranks >= 1) throw new ContentError(file, `skill "${skill.id}": overreach must stay below 1 at full rank`);
  }
  return skills;
}
