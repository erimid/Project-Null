/**
 * The endings of the story, and what changes in the world after each.
 * An ending is reached by finishing the final job a certain way (a
 * contract's `ending`, or a choice's), or for Chorus by the player
 * leaving the story alone too long (see chorus.json `doom`). Reaching one
 * sets the flag `ending:<id>`, so story lines, contracts and conditions
 * can follow on from it. Play continues afterwards. See core/endings.ts.
 */
import type { ContractDef } from './schema';
import type { StoryMail } from './story';

export interface EndingNews {
  readonly headline: string;
  readonly body: string;
}

/** What happens to Chorus: freed = every taken server comes back and the clock stops; stop = it stays where it is; spread = it takes everything. */
export type EndingChorus = 'free' | 'stop' | 'spread';
export const ENDING_CHORUS: readonly EndingChorus[] = ['free', 'stop', 'spread'];

export interface EndingDef {
  readonly id: string;
  readonly name: string;
  /** What the player said, in one line, for the screen that marks the ending. */
  readonly line: string;
  /** How finishing the last job the usual way reads, where that brings this ending. */
  readonly way?: { readonly label: string; readonly note: string };
  readonly chorus: EndingChorus;
  /** Patrons who stop posting work and stop answering. */
  readonly gone: readonly string[];
  /** Standing moved as the ending lands. */
  readonly standing: Readonly<Record<string, number>>;
  /** Sent at once. {handle} is filled in. Fuller letters from each side are story beats on the ending's flag. */
  readonly mail: StoryMail;
  /** In the next morning's paper. */
  readonly news: readonly EndingNews[];
  /** One of these in every paper afterwards. */
  readonly paper: readonly EndingNews[];
}

/** The flag an ending sets. */
export const endingFlag = (id: string): string => `ending:${id}`;

class EndingError extends Error {
  constructor(message: string) {
    super(`endings.json: ${message}`);
    this.name = 'EndingError';
  }
}

type Obj = Record<string, unknown>;
const isObj = (value: unknown): value is Obj => typeof value === 'object' && value !== null && !Array.isArray(value);

function text(where: string, raw: Obj, key: string): string {
  const value = raw[key];
  if (typeof value !== 'string' || value.trim() === '') throw new EndingError(`${where}: "${key}" must be non-empty text`);
  return value;
}

function items(where: string, raw: Obj, key: string): EndingNews[] {
  const value = raw[key];
  if (!Array.isArray(value)) throw new EndingError(`${where}: "${key}" must be a list`);
  return value.map((item, index) => {
    if (!isObj(item)) throw new EndingError(`${where} ${key} ${index}: must be an object`);
    return { headline: text(`${where} ${key} ${index}`, item, 'headline'), body: text(`${where} ${key} ${index}`, item, 'body') };
  });
}

export function parseEndings(data: unknown): EndingDef[] {
  if (!Array.isArray(data) || data.length === 0) throw new EndingError('must be a non-empty list');
  const seen = new Set<string>();
  return data.map((raw, index): EndingDef => {
    if (!isObj(raw)) throw new EndingError(`entry ${index} must be an object`);
    const id = text(`entry ${index}`, raw, 'id');
    const where = `ending "${id}"`;
    if (!/^[a-z0-9-]+$/.test(id)) throw new EndingError(`${where}: id may only use a-z, 0-9 and -`);
    if (seen.has(id)) throw new EndingError(`${where}: id is used twice`);
    seen.add(id);
    const chorus = raw.chorus as EndingChorus;
    if (!ENDING_CHORUS.includes(chorus)) throw new EndingError(`${where}: "chorus" must be one of ${ENDING_CHORUS.join(', ')}`);
    const gone = raw.gone;
    if (!Array.isArray(gone) || !gone.every((item) => typeof item === 'string')) throw new EndingError(`${where}: "gone" must be a list of patron ids`);
    const standing = raw.standing;
    if (!isObj(standing) || !Object.values(standing).every((value) => typeof value === 'number' && Number.isInteger(value) && Math.abs(value) <= 20)) {
      throw new EndingError(`${where}: "standing" must map patron ids to whole numbers from -20 to 20`);
    }
    const mail = raw.mail;
    if (!isObj(mail)) throw new EndingError(`${where}: "mail" must be an object`);
    const paper = items(where, raw, 'paper');
    if (paper.length === 0) throw new EndingError(`${where}: "paper" needs at least one item`);
    return {
      id,
      name: text(where, raw, 'name'),
      line: text(where, raw, 'line'),
      ...(isObj(raw.way) ? { way: { label: text(`${where} way`, raw.way, 'label'), note: text(`${where} way`, raw.way, 'note') } } : {}),
      chorus,
      gone: gone as string[],
      standing: standing as Record<string, number>,
      mail: { from: text(`${where} mail`, mail, 'from'), subject: text(`${where} mail`, mail, 'subject'), body: text(`${where} mail`, mail, 'body') },
      news: items(where, raw, 'news'),
      paper,
    };
  });
}

/** Ways a contract can be finished that end the story, and whether each is always offered. */
export function endingOptions(contract: ContractDef): { ending: string; always: boolean }[] {
  return [
    ...(contract.ending ? [{ ending: contract.ending, always: true }] : []),
    ...(contract.choices ?? []).flatMap((choice) => (choice.ending ? [{ ending: choice.ending, always: choice.when === undefined }] : [])),
  ];
}

/**
 * Checks the endings against the rest of the content: every ending named
 * exists, every patron named exists, and a contract that can end the
 * story always offers at least two endings, so no save is ever stuck.
 */
export function checkEndings(endings: readonly EndingDef[], contracts: readonly ContractDef[], patronIds: readonly string[], doomEnding?: string): void {
  const ids = new Set(endings.map((ending) => ending.id));
  for (const ending of endings) {
    for (const id of [...ending.gone, ...Object.keys(ending.standing)]) if (!patronIds.includes(id)) throw new EndingError(`ending "${ending.id}": "${id}" is not a patron`);
  }
  if (doomEnding !== undefined && !ids.has(doomEnding)) throw new EndingError(`chorus.json doom ending "${doomEnding}" is not an ending`);
  for (const contract of contracts) {
    const options = endingOptions(contract);
    if (options.length === 0) continue;
    for (const option of options) if (!ids.has(option.ending)) throw new EndingError(`contract "${contract.id}": ending "${option.ending}" is not an ending`);
    if (new Set(options.filter((option) => option.always).map((option) => option.ending)).size < 2) {
      throw new EndingError(`contract "${contract.id}" can end the story, so it must always offer at least two endings`);
    }
  }
}
