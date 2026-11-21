/**
 * Patrons: named clients who post work under their own names and
 * remember the player (see core/patrons.ts). Written in patrons.json;
 * checked here when the game starts.
 *
 * Text in intros may use {company} and {city}; letters may use {handle}
 * and, in the favour letter, {who}.
 */
import { ContentError, type ContractDef, type ServerDef } from './schema';

/** The one thing a patron does for a player in their inner circle. */
export const FAVOURS = ['raidWarning', 'fineCut', 'scanTargets', 'lieLowCut'] as const;
export type Favour = (typeof FAVOURS)[number];

export const LETTERS = ['met', 'trusted', 'inner', 'cold', 'favour'] as const;
export type LetterKey = (typeof LETTERS)[number];

export interface PatronLetter {
  readonly subject: string;
  readonly body: string;
}

export interface PatronDef {
  readonly id: string;
  /** The name their jobs carry on the board, and that signs their letters. */
  readonly name: string;
  /** One line: who they are. */
  readonly title: string;
  readonly blurb: string;
  /** True for a patron the player never sees listed: standing moves, nothing shows. */
  readonly hidden?: boolean;
  /** Lowest rating at which they post work on the board. */
  readonly minRating: number;
  /** Lines of business (companies.json sectors) they post jobs against. */
  readonly targets: readonly string[];
  /** Lines of business they look after: work against them costs standing. */
  readonly protects: readonly string[];
  /** Id of the shop that gives a discount to a player they trust. */
  readonly shop?: string;
  readonly favour?: Favour;
  /** Opening lines put before the brief of a job they post. One is picked. */
  readonly intro: readonly string[];
  readonly signoff: string;
  readonly letters: Readonly<Partial<Record<LetterKey, PatronLetter>>>;
}

type Obj = Record<string, unknown>;
const isObj = (value: unknown): value is Obj => typeof value === 'object' && value !== null && !Array.isArray(value);

export function parsePatrons(data: unknown, file = 'patrons.json'): PatronDef[] {
  const fail = (message: string): never => {
    throw new ContentError(file, message);
  };
  if (!Array.isArray(data)) return fail('must be a list of patrons');
  const seen = new Set<string>();
  return data.map((value, index): PatronDef => {
    if (!isObj(value)) return fail(`entry ${index} must be an object`);
    const text = (key: string, where = `entry ${index}`): string => {
      const raw = value[key];
      return typeof raw === 'string' && raw.trim() !== '' ? raw : fail(`${where} needs non-empty text "${key}"`);
    };
    const texts = (key: string): string[] => {
      const raw = value[key];
      if (!Array.isArray(raw) || raw.some((item) => typeof item !== 'string' || item.trim() === '')) return fail(`entry ${index} "${key}" must be a list of text`);
      return raw as string[];
    };
    const id = text('id');
    if (seen.has(id)) fail(`patron id "${id}" is used twice`);
    seen.add(id);
    const where = `patron "${id}"`;
    const minRating = value.minRating;
    if (typeof minRating !== 'number' || minRating < 0) fail(`${where} needs a "minRating" of 0 or more`);
    const favour = value.favour;
    if (favour !== undefined && !(FAVOURS as readonly unknown[]).includes(favour)) fail(`${where}: favour must be one of ${FAVOURS.join(', ')}`);
    const letters: Partial<Record<LetterKey, PatronLetter>> = {};
    if (!isObj(value.letters)) fail(`${where} needs "letters"`);
    for (const [key, letter] of Object.entries(value.letters as Obj)) {
      if (!(LETTERS as readonly string[]).includes(key)) fail(`${where}: unknown letter "${key}"`);
      if (!isObj(letter) || typeof letter.subject !== 'string' || typeof letter.body !== 'string') fail(`${where}: letter "${key}" needs a subject and a body`);
      letters[key as LetterKey] = { subject: (letter as Obj).subject as string, body: (letter as Obj).body as string };
    }
    const hidden = value.hidden === true;
    const intro = texts('intro');
    const targets = texts('targets');
    if (!hidden && targets.length > 0 && intro.length === 0) fail(`${where} posts jobs, so it needs at least one "intro"`);
    if (favour === 'raidWarning' && !letters.favour) fail(`${where}: a raid warning needs a "favour" letter`);
    return {
      id,
      name: text('name'),
      title: text('title'),
      blurb: text('blurb'),
      ...(hidden ? { hidden } : {}),
      minRating: minRating as number,
      targets,
      protects: texts('protects'),
      ...(value.shop === undefined ? {} : { shop: text('shop') }),
      ...(favour === undefined ? {} : { favour: favour as Favour }),
      intro,
      signoff: text('signoff'),
      letters,
    };
  });
}

/** Checks that patrons point at real shops and sectors, and that contracts point at real patrons. */
export function checkPatrons(patrons: readonly PatronDef[], servers: readonly ServerDef[], sectors: readonly string[], contracts: readonly ContractDef[], file = 'patrons.json'): void {
  const ids = new Set(patrons.map((patron) => patron.id));
  for (const patron of patrons) {
    if (patron.shop && !servers.some((server) => server.id === patron.shop && server.kind === 'board')) {
      throw new ContentError(file, `patron "${patron.id}" names shop "${patron.shop}", which is not a board`);
    }
    for (const sector of [...patron.targets, ...patron.protects]) {
      if (!sectors.includes(sector)) throw new ContentError(file, `patron "${patron.id}" names unknown sector "${sector}"`);
    }
  }
  for (const contract of contracts) {
    if (contract.patron && !ids.has(contract.patron)) throw new ContentError('contracts.json', `contract "${contract.id}" names unknown patron "${contract.patron}"`);
    for (const choice of contract.choices ?? []) {
      for (const id of Object.keys(choice.standing ?? {})) {
        if (!ids.has(id)) throw new ContentError('contracts.json', `contract "${contract.id}" choice "${choice.id}" names unknown patron "${id}"`);
      }
    }
    const conditions = [contract.when, ...(contract.heist?.holds ?? []).map((hold) => hold.ally?.when)];
    for (const condition of conditions) {
      for (const id of [...Object.keys(condition?.standing ?? {}), ...Object.keys(condition?.below ?? {})]) {
        if (!ids.has(id)) throw new ContentError('contracts.json', `contract "${contract.id}" has a condition on unknown patron "${id}"`);
      }
      for (const id of Object.keys(condition?.choices ?? {})) {
        if (!contracts.some((other) => other.id === id)) throw new ContentError('contracts.json', `contract "${contract.id}" has a condition on unknown contract "${id}"`);
      }
    }
  }
}
