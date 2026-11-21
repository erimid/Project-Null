/**
 * The data market at Lowtide: what kinds of stolen file it buys and what
 * each is worth on an ordinary day. A file's kind comes from words in its
 * name (first kind that matches wins). Written in data.json; the rules
 * that price a file are in core/data.ts.
 */
import { ContentError } from './schema';

export interface DataKindDef {
  readonly id: string;
  readonly name: string;
  /** Price of a small file of this kind from a tier 1 company on an ordinary day. */
  readonly base: number;
  /** Words in a file's name that make it this kind. */
  readonly words: readonly string[];
  readonly blurb: string;
}

export interface DataMarketDef {
  /** Who buys: shown as the sender of letters. */
  readonly buyer: string;
  readonly kinds: readonly DataKindDef[];
  /** The kind of a file no other kind matches. */
  readonly other: DataKindDef;
}

type Obj = Record<string, unknown>;
const isObj = (value: unknown): value is Obj => typeof value === 'object' && value !== null && !Array.isArray(value);

export function parseData(data: unknown, file = 'data.json'): DataMarketDef {
  const fail = (message: string): never => {
    throw new ContentError(file, message);
  };
  const text = (value: unknown, where: string): string => (typeof value === 'string' && value.trim() !== '' ? value : fail(`${where} needs non-empty text`));
  const kind = (value: unknown, where: string): DataKindDef => {
    if (!isObj(value)) return fail(`${where} must be an object`);
    if (typeof value.base !== 'number' || !(value.base > 0)) fail(`${where} needs a positive "base"`);
    if (!Array.isArray(value.words)) fail(`${where} "words" must be a list`);
    return {
      id: text(value.id, `${where} id`),
      name: text(value.name, `${where} name`),
      base: value.base as number,
      words: (value.words as unknown[]).map((word, i) => text(word, `${where} word ${i}`).toLowerCase()),
      blurb: text(value.blurb, `${where} blurb`),
    };
  };
  if (!isObj(data)) return fail('must be an object');
  if (!Array.isArray(data.kinds) || data.kinds.length === 0) return fail('"kinds" must be a non-empty list');
  const kinds = data.kinds.map((value, i) => kind(value, `kind ${i}`));
  const other = kind(data.other, 'other');
  const ids = [...kinds.map((item) => item.id), other.id];
  if (new Set(ids).size !== ids.length) fail('kind ids must be different');
  for (const item of kinds) if (item.words.length === 0) fail(`kind "${item.id}" needs at least one word`);
  return { buyer: text(data.buyer, 'buyer'), kinds, other };
}
