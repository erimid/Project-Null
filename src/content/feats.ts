/**
 * Feats: things worth doing once, kept across careers. Their names and
 * descriptions are written in feats.json; when each is earned is a rule in
 * the core (see core/feats.ts), matched by id.
 */
import { FEAT_IDS } from '../core/feats';
import { ContentError } from './schema';

export interface FeatDef {
  readonly id: string;
  readonly name: string;
  readonly text: string;
}

export function parseFeats(data: unknown, file = 'feats.json'): FeatDef[] {
  const list = (data as { feats?: unknown } | null)?.feats;
  if (!Array.isArray(list)) throw new ContentError(file, 'needs a list "feats"');
  const seen = new Set<string>();
  const feats = list.map((raw: unknown, index): FeatDef => {
    const item = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
    const text = (key: string): string => {
      const value = item[key];
      if (typeof value !== 'string' || value.trim() === '') throw new ContentError(file, `feat ${index} needs a non-empty text "${key}"`);
      return value;
    };
    const id = text('id');
    if (!(FEAT_IDS as readonly string[]).includes(id)) throw new ContentError(file, `feat "${id}" has no rule in core/feats.ts`);
    if (seen.has(id)) throw new ContentError(file, `feat "${id}" is listed twice`);
    seen.add(id);
    return { id, name: text('name'), text: text('text') };
  });
  const missing = FEAT_IDS.filter((id) => !seen.has(id));
  if (missing.length > 0) throw new ContentError(file, `feats with no wording: ${missing.join(', ')}`);
  return feats;
}
