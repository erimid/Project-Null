/**
 * Side stories: a few written contracts for one client, offered one after
 * another (see core/series.ts). Each part is an ordinary contract in
 * contracts.json; this file only says which follow which, and what the
 * client writes when the next one is ready. Written in series.json;
 * checked here when the game starts.
 */
import { ContentError, type ContractDef } from './schema';

export interface SeriesPartDef {
  /** Id of the contract. */
  readonly contract: string;
  /** The letter the client sends when this part comes onto the board. {handle} is the player's. */
  readonly invite?: { readonly subject: string; readonly body: string };
  /** Game hours after the part before it was delivered before this one is offered. Missing = the usual gap. */
  readonly gapHours?: number;
}

export interface SeriesDef {
  readonly id: string;
  /** The story's name, shown beside each part. */
  readonly name: string;
  /** Who the letters come from. */
  readonly client: string;
  readonly parts: readonly SeriesPartDef[];
}

type Obj = Record<string, unknown>;
const isObj = (value: unknown): value is Obj => typeof value === 'object' && value !== null && !Array.isArray(value);

export function parseSeries(data: unknown, contracts: readonly ContractDef[], file = 'series.json'): SeriesDef[] {
  const fail = (problem: string): never => {
    throw new ContentError(file, problem);
  };
  if (!Array.isArray(data)) return fail('must be a list of side stories');
  const text = (value: unknown, where: string): string => (typeof value === 'string' && value.trim() !== '' ? value : fail(`${where} must be non-empty text`));
  const used = new Set<string>();
  const all = data.map((value, i): SeriesDef => {
    if (!isObj(value)) return fail(`entry ${i} must be an object`);
    const id = text(value['id'], `entry ${i} id`);
    const where = `side story "${id}"`;
    if (!Array.isArray(value['parts']) || value['parts'].length < 2) fail(`${where} needs at least two parts`);
    const parts = (value['parts'] as unknown[]).map((raw, j): SeriesPartDef => {
      if (!isObj(raw)) return fail(`${where} part ${j + 1} must be an object`);
      const contract = text(raw['contract'], `${where} part ${j + 1} contract`);
      const found = contracts.find((item) => item.id === contract);
      if (!found) fail(`${where} part ${j + 1}: there is no contract "${contract}"`);
      if (found!.story) fail(`${where} part ${j + 1}: "${contract}" is a story mission; the story director offers those`);
      if (used.has(contract)) fail(`${where} part ${j + 1}: "${contract}" is already part of a side story`);
      used.add(contract);
      const invite = raw['invite'];
      if (invite !== undefined && !isObj(invite)) fail(`${where} part ${j + 1}: invite must be a letter`);
      const gap = raw['gapHours'];
      if (gap !== undefined && !(typeof gap === 'number' && gap >= 0)) fail(`${where} part ${j + 1}: gapHours must be a number of hours`);
      return {
        contract,
        ...(isObj(invite) ? { invite: { subject: text(invite['subject'], `${where} part ${j + 1} invite subject`), body: text(invite['body'], `${where} part ${j + 1} invite body`) } } : {}),
        ...(typeof gap === 'number' ? { gapHours: gap } : {}),
      };
    });
    // Each part must be within reach once the one before it is done: never a lower rating than its place.
    for (let j = 1; j < parts.length; j++) {
      const before = contracts.find((item) => item.id === parts[j - 1]!.contract)!;
      const here = contracts.find((item) => item.id === parts[j]!.contract)!;
      if (here.minRating < before.minRating) fail(`${where} part ${j + 1} asks for a lower rating than the part before it`);
    }
    return { id, name: text(value['name'], `${where} name`), client: text(value['client'], `${where} client`), parts };
  });
  const ids = all.map((series) => series.id);
  if (new Set(ids).size !== ids.length) fail('two side stories share an id');
  return all;
}
