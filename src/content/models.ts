/**
 * Language models the player can rent by the day. Written in
 * models.json; checked here when the game starts.
 */
import { ContentError } from './schema';

export const MODEL_SKILLS = ['read', 'scrub', 'review', 'watch'] as const;
/**
 * What a rented model can do for the player:
 * - read: open every file on a server at once and note what they say.
 * - scrub: pick out the log lines that would give the player away.
 * - review: say what is wrong with a message before it is sent.
 * - watch: cut the connection just before a trace completes.
 */
export type ModelSkill = (typeof MODEL_SKILLS)[number];

export interface ModelDef {
  readonly id: string;
  readonly name: string;
  readonly blurb: string;
  /** Credits for one rental period (see modelRentHours in tuning.json). */
  readonly price: number;
  readonly skills: readonly ModelSkill[];
}

export function parseModels(data: unknown, file = 'models.json'): ModelDef[] {
  if (!Array.isArray(data)) throw new ContentError(file, 'must be a list of models');
  const seen = new Set<string>();
  return data.map((raw: unknown, index): ModelDef => {
    if (typeof raw !== 'object' || raw === null) throw new ContentError(file, `entry ${index} must be an object`);
    const item = raw as Record<string, unknown>;
    const text = (key: string): string => {
      const value = item[key];
      if (typeof value !== 'string' || value.trim() === '') throw new ContentError(file, `entry ${index} needs a non-empty text "${key}"`);
      return value;
    };
    const id = text('id');
    if (seen.has(id)) throw new ContentError(file, `model id "${id}" is used twice`);
    seen.add(id);
    const price = item['price'];
    if (typeof price !== 'number' || !(price > 0)) throw new ContentError(file, `model "${id}" needs a price above 0`);
    const skills = item['skills'];
    if (!Array.isArray(skills) || skills.length === 0 || !skills.every((skill) => (MODEL_SKILLS as readonly unknown[]).includes(skill))) {
      throw new ContentError(file, `model "${id}": skills must be a list from ${MODEL_SKILLS.join(', ')}`);
    }
    return { id, name: text('name'), blurb: text('blurb'), price, skills: skills as ModelSkill[] };
  });
}
