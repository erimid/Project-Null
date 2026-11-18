/**
 * People you can write to, and what you can know about them. Written in
 * people.json; checked here when the game starts.
 *
 * A message that works is one from the right person, mentioning the
 * right details. The player learns both by reading files on servers.
 */
import { ContentError, type ServerDef } from './schema';

/** A file on a server. Opening it is how the player learns what it holds. */
export interface FileRef {
  readonly serverId: string;
  readonly file: string;
}

export interface PersonDef {
  readonly id: string;
  readonly name: string;
  /** Job title and where, e.g. "Abuse desk, Polar Mesh Exchange". */
  readonly title: string;
  readonly address: string;
  /** The file that names this person. Missing = known from the start. */
  readonly source?: FileRef;
}

/** Something worth mentioning in a message. */
export interface FactDef {
  readonly id: string;
  readonly text: string;
  readonly source: FileRef;
}

/** What a convinced person sends back. */
export type RewardDef =
  /** The password of an account on a server. */
  | { readonly kind: 'password'; readonly serverId: string; readonly user: string }
  /** The address of a server that is not listed anywhere. */
  | { readonly kind: 'address'; readonly serverId: string };

/** One thing the player can ask one person for. */
export interface AskDef {
  readonly id: string;
  /** Id of the person being asked. */
  readonly markId: string;
  /** What is being asked for, in a few words. */
  readonly label: string;
  /** The request as it is written in the message. */
  readonly text: string;
  /** Id of the person the message has to seem to come from. */
  readonly senderId: string;
  /** Ids of the details the message has to mention. */
  readonly needs: readonly string[];
  readonly reward: RewardDef;
  /** What the person writes back when they believe it. */
  readonly reply: string;
}

export interface PeopleDef {
  readonly people: readonly PersonDef[];
  readonly facts: readonly FactDef[];
  readonly asks: readonly AskDef[];
}

type Obj = Record<string, unknown>;
const FILE = 'people.json';

function obj(value: unknown, where: string): Obj {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new ContentError(FILE, `${where} must be an object`);
  return value as Obj;
}

function text(item: Obj, key: string, where: string): string {
  const value = item[key];
  if (typeof value !== 'string' || value.trim() === '') throw new ContentError(FILE, `${where} needs a non-empty text "${key}"`);
  return value;
}

function items(data: Obj, key: string): Obj[] {
  const value = data[key];
  if (!Array.isArray(value)) throw new ContentError(FILE, `needs a list "${key}"`);
  return value.map((item, index) => obj(item, `${key} ${index}`));
}

function fileRef(value: unknown, where: string): FileRef {
  const item = obj(value, `${where} source`);
  return { serverId: text(item, 'serverId', where), file: text(item, 'file', where) };
}

function unique(kind: string, ids: readonly string[]): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) throw new ContentError(FILE, `${kind} id "${id}" is used twice`);
    seen.add(id);
  }
}

export function parsePeople(data: unknown): PeopleDef {
  const root = obj(data, 'the file');
  const people = items(root, 'people').map((item): PersonDef => {
    const id = text(item, 'id', 'person');
    const where = `person "${id}"`;
    return {
      id,
      name: text(item, 'name', where),
      title: text(item, 'title', where),
      address: text(item, 'address', where),
      ...(item['source'] === undefined ? {} : { source: fileRef(item['source'], where) }),
    };
  });
  const facts = items(root, 'facts').map((item): FactDef => {
    const id = text(item, 'id', 'fact');
    return { id, text: text(item, 'text', `fact "${id}"`), source: fileRef(item['source'], `fact "${id}"`) };
  });
  const asks = items(root, 'asks').map((item): AskDef => {
    const id = text(item, 'id', 'ask');
    const where = `ask "${id}"`;
    const needs = item['needs'];
    if (!Array.isArray(needs) || needs.length === 0 || !needs.every((need) => typeof need === 'string')) {
      throw new ContentError(FILE, `${where} needs a list "needs" of fact ids`);
    }
    const raw = obj(item['reward'], `${where} reward`);
    const kind = text(raw, 'kind', `${where} reward`);
    let reward: RewardDef;
    if (kind === 'password') reward = { kind, serverId: text(raw, 'serverId', where), user: text(raw, 'user', where) };
    else if (kind === 'address') reward = { kind, serverId: text(raw, 'serverId', where) };
    else throw new ContentError(FILE, `${where}: reward kind must be password or address`);
    return {
      id,
      markId: text(item, 'markId', where),
      label: text(item, 'label', where),
      text: text(item, 'text', where),
      senderId: text(item, 'senderId', where),
      needs: needs as string[],
      reward,
      reply: text(item, 'reply', where),
    };
  });
  unique('person', people.map((person) => person.id));
  unique('fact', facts.map((fact) => fact.id));
  unique('ask', asks.map((ask) => ask.id));
  return { people, facts, asks };
}

/** Checks that everything people.json points at exists. `maxDetails` is how many details one message can mention. */
export function checkPeople(people: PeopleDef, servers: readonly ServerDef[], maxDetails: number): void {
  const hasFile = (ref: FileRef) => servers.find((server) => server.id === ref.serverId)?.files.some((file) => file.name === ref.file);
  for (const person of people.people) {
    if (person.source && !hasFile(person.source)) throw new ContentError(FILE, `person "${person.id}": no file ${person.source.serverId}/${person.source.file}`);
  }
  for (const fact of people.facts) {
    if (!hasFile(fact.source)) throw new ContentError(FILE, `fact "${fact.id}": no file ${fact.source.serverId}/${fact.source.file}`);
  }
  const isPerson = (id: string) => people.people.some((person) => person.id === id);
  for (const ask of people.asks) {
    const where = `ask "${ask.id}"`;
    if (!isPerson(ask.markId) || !isPerson(ask.senderId)) throw new ContentError(FILE, `${where} names someone who is not in people`);
    if (ask.markId === ask.senderId) throw new ContentError(FILE, `${where}: nobody writes to themselves`);
    if (ask.needs.length > maxDetails) throw new ContentError(FILE, `${where} needs more details than one message can mention`);
    for (const need of ask.needs) {
      if (!people.facts.some((fact) => fact.id === need)) throw new ContentError(FILE, `${where} needs "${need}", which is not a fact`);
    }
    const server = servers.find((item) => item.id === ask.reward.serverId);
    if (!server) throw new ContentError(FILE, `${where}: reward server "${ask.reward.serverId}" does not exist`);
    if (ask.reward.kind === 'password') {
      const user = ask.reward.user;
      if (!server.accounts.some((account) => account.user === user)) {
        throw new ContentError(FILE, `${where}: ${server.id} has no account "${user}"`);
      }
    }
  }
}
