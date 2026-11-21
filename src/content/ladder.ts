/**
 * The rivals ladder at the Backroom: a dozen handles, the player's among
 * them, that climb on their own (see core/ladder.ts). An entry with only
 * an id is one of the raiders in rivals.json, who also break into
 * gateways; the rest only climb, snipe jobs and talk. Written in
 * ladder.json; checked here when the game starts.
 *
 * Letters may use {handle} (the player's); tips also {server}; sniped
 * news {rival}, {company} and {CITY}.
 */
import type { NewsTemplate } from './news';
import type { RivalDef } from './rivals';
import { ContentError } from './schema';

export interface LadderRivalDef {
  readonly id: string;
  readonly handle: string;
  readonly blurb: string;
  /** Score (on the same scale as the player's rating) at the start of a game. */
  readonly start: number;
  /** Score gained on an average day. */
  readonly pace: number;
  /** True for one of the raiders in rivals.json. */
  readonly raider: boolean;
}

export interface LadderDef {
  readonly rivals: readonly LadderRivalDef[];
  readonly taunts: readonly string[];
  readonly overtaken: readonly string[];
  readonly tips: readonly string[];
  readonly sniped: readonly NewsTemplate[];
}

type Obj = Record<string, unknown>;
const isObj = (value: unknown): value is Obj => typeof value === 'object' && value !== null && !Array.isArray(value);

export function parseLadder(data: unknown, raiders: readonly RivalDef[], file = 'ladder.json'): LadderDef {
  const fail = (message: string): never => {
    throw new ContentError(file, message);
  };
  if (!isObj(data)) return fail('must be an object');
  const texts = (key: string): string[] => {
    const raw = data[key];
    if (!Array.isArray(raw) || raw.length === 0 || raw.some((item) => typeof item !== 'string' || item.trim() === '')) return fail(`"${key}" must be a list of text`);
    return raw as string[];
  };
  if (!Array.isArray(data.rivals)) return fail('"rivals" must be a list');
  const seen = new Set<string>();
  const rivals = data.rivals.map((value, index): LadderRivalDef => {
    if (!isObj(value) || typeof value.id !== 'string') return fail(`rival ${index} needs an id`);
    const id = value.id;
    if (seen.has(id)) fail(`rival "${id}" is listed twice`);
    seen.add(id);
    const number = (key: string, min: number, max: number) => {
      const raw = value[key];
      return typeof raw === 'number' && raw >= min && raw <= max ? raw : fail(`rival "${id}" needs "${key}" from ${min} to ${max}`);
    };
    const raider = raiders.find((rival) => rival.id === id);
    const text = (key: string, fallback: string | undefined) => {
      const raw = value[key] ?? fallback;
      return typeof raw === 'string' && raw.trim() !== '' ? raw : fail(`rival "${id}" needs "${key}"`);
    };
    return { id, handle: text('handle', raider?.handle), blurb: text('blurb', raider?.blurb), start: number('start', 0, 1000), pace: number('pace', 0, 50), raider: raider !== undefined };
  });
  const sniped = (Array.isArray(data.sniped) ? data.sniped : fail('"sniped" must be a list')).map((value, i): NewsTemplate => {
    if (!isObj(value) || typeof value.headline !== 'string' || typeof value.body !== 'string') return fail(`sniped ${i} needs a headline and a body`);
    return { headline: value.headline, body: value.body };
  });
  return { rivals, taunts: texts('taunts'), overtaken: texts('overtaken'), tips: texts('tips'), sniped };
}
