/**
 * The case file: what the player has learned of the story, written in
 * casefile.json and shown in the Messages window. Every entry has a
 * condition (see ConditionDef) and only shows once it holds, so nothing
 * is told before it is learned. What is shown is worked out in
 * core/casefile.ts.
 */
import { ContentError, parseCondition, type ConditionDef } from './schema';

export interface CaseLine {
  readonly when?: ConditionDef;
  readonly text: string;
}

/** Someone met in the story. Shown once their first line holds; the last line that holds is what the card says. */
export interface CasePerson {
  readonly id: string;
  readonly name: string;
  readonly lines: readonly CaseLine[];
}

/** What one side of the story is after, tied to a story line (see story.json). */
export interface CaseThread {
  readonly id: string;
  /** The story line it follows: shown once that line has sent something, closed once it is over. */
  readonly line: string;
  readonly title: string;
  readonly text: string;
  /** Later words, when the side's wants change. */
  readonly lines?: readonly CaseLine[];
}

export interface CaseName {
  /** Pieces of the hidden name in order, each shown once found. */
  readonly blocks: readonly { readonly text: string; readonly when: ConditionDef }[];
  /** When the whole name may be shown. */
  readonly full: ConditionDef;
  readonly note: string;
  readonly fullNote: string;
}

export interface CaseFileDef {
  readonly people: readonly CasePerson[];
  readonly threads: readonly CaseThread[];
  readonly name: CaseName;
  /** One sentence per choice made at the end of a job: contract id -> choice id ("default" for the usual way) -> sentence. */
  readonly choices: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

type Raw = Record<string, unknown>;

export function parseCaseFile(data: unknown, storyLines: readonly string[], file = 'casefile.json'): CaseFileDef {
  const obj = (value: unknown, where: string): Raw => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new ContentError(file, `${where} must be an object`);
    return value as Raw;
  };
  const text = (raw: Raw, key: string, where: string): string => {
    const value = raw[key];
    if (typeof value !== 'string' || value.trim() === '') throw new ContentError(file, `${where} needs a non-empty text "${key}"`);
    return value;
  };
  const array = (raw: Raw, key: string, where: string): unknown[] => {
    const value = raw[key];
    if (!Array.isArray(value)) throw new ContentError(file, `${where} needs a list "${key}"`);
    return value;
  };
  const lines = (raw: Raw, where: string): CaseLine[] =>
    array(raw, 'lines', where).map((item, index) => {
      const line = obj(item, `${where} line ${index}`);
      return { text: text(line, 'text', `${where} line ${index}`), ...(line.when === undefined ? {} : { when: parseCondition(file, `${where} line ${index}`, line.when) }) };
    });
  const root = obj(data, 'the file');
  const seen = new Set<string>();
  const once = (id: string, where: string) => {
    if (seen.has(id)) throw new ContentError(file, `${where} "${id}" is listed twice`);
    seen.add(id);
  };
  const people = array(root, 'people', 'the file').map((item, index): CasePerson => {
    const raw = obj(item, `person ${index}`);
    const id = text(raw, 'id', `person ${index}`);
    once(`person:${id}`, 'person');
    const all = lines(raw, `person "${id}"`);
    if (all.length === 0) throw new ContentError(file, `person "${id}" needs at least one line`);
    return { id, name: text(raw, 'name', `person "${id}"`), lines: all };
  });
  const threads = array(root, 'threads', 'the file').map((item, index): CaseThread => {
    const raw = obj(item, `thread ${index}`);
    const id = text(raw, 'id', `thread ${index}`);
    once(`thread:${id}`, 'thread');
    const line = text(raw, 'line', `thread "${id}"`);
    if (!storyLines.includes(line)) throw new ContentError(file, `thread "${id}" follows story line "${line}", which story.json does not have`);
    return {
      id,
      line,
      title: text(raw, 'title', `thread "${id}"`),
      text: text(raw, 'text', `thread "${id}"`),
      ...(raw.lines === undefined ? {} : { lines: lines(raw, `thread "${id}"`) }),
    };
  });
  const nameRaw = obj(root.name, 'name');
  const name: CaseName = {
    blocks: array(nameRaw, 'blocks', 'name').map((item, index) => {
      const raw = obj(item, `name block ${index}`);
      return { text: text(raw, 'text', `name block ${index}`), when: parseCondition(file, `name block ${index}`, raw.when) };
    }),
    full: parseCondition(file, 'name full', nameRaw.full),
    note: text(nameRaw, 'note', 'name'),
    fullNote: text(nameRaw, 'fullNote', 'name'),
  };
  const choicesRaw = obj(root.choices ?? {}, 'choices');
  const choices: Record<string, Record<string, string>> = {};
  for (const [contractId, map] of Object.entries(choicesRaw)) {
    const entries = obj(map, `choices for "${contractId}"`);
    choices[contractId] = {};
    for (const [choiceId, sentence] of Object.entries(entries)) {
      if (typeof sentence !== 'string' || sentence.trim() === '') throw new ContentError(file, `choice "${contractId}/${choiceId}" must be a sentence`);
      choices[contractId]![choiceId] = sentence;
    }
  }
  return { people, threads, name, choices };
}
