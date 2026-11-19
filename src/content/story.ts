/**
 * Act 1 story beats. A beat arrives on its own clock (a rating and a gap
 * since the last beat), disguised among ordinary work. Arriving can send a
 * message, put a story contract on the board, or set an enemy hacker on the
 * player. A contract beat waits to be delivered before the next beat; a
 * beat with no contract passes straight on. See core/story.ts for the
 * director that runs them.
 *
 * The missions themselves are ordinary contracts in contracts.json marked
 * `story: true`, so every lookup and check already handles them. A beat
 * only names one by id.
 */
import type { ContractDef, ServerDef } from './schema';
import type { RivalDef } from './rivals';

/** One message a beat sends to the player's inbox when it arrives. */
export interface StoryMail {
  readonly from: string;
  readonly subject: string;
  readonly body: string;
}

/** One step of the story. */
export interface StoryBeat {
  readonly id: string;
  /** Rating the player must have reached before this beat can arrive. */
  readonly minRating?: number;
  /** In-game hours that must pass after the previous beat before this one can arrive. */
  readonly afterHours?: number;
  /** A contract (any id) that must be completed before this beat can arrive. */
  readonly requires?: string;
  /** A message sent when the beat arrives. */
  readonly mail?: StoryMail;
  /** A story contract (id in contracts.json, marked story) put on the board when the beat arrives. The beat waits for its delivery. */
  readonly contractId?: string;
  /** A rival hacker (id in rivals.json) set on the player when the beat arrives. */
  readonly raid?: string;
  /** True for the beat where the name is first glimpsed. Nothing in the rules depends on it; it marks the end of the act. */
  readonly reveal?: boolean;
}

export interface StoryDef {
  readonly beats: readonly StoryBeat[];
}

class StoryError extends Error {
  constructor(message: string) {
    super(`story.json: ${message}`);
    this.name = 'StoryError';
  }
}

function isObj(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(where: string, raw: Record<string, unknown>, key: string): string {
  const value = raw[key];
  if (typeof value !== 'string' || value.length === 0) throw new StoryError(`${where}: "${key}" must be a non-empty string`);
  return value;
}

function optNum(where: string, raw: Record<string, unknown>, key: string, min: number): number | undefined {
  const value = raw[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min) throw new StoryError(`${where}: "${key}" must be a number >= ${min}`);
  return value;
}

function parseMail(where: string, raw: unknown): StoryMail {
  if (!isObj(raw)) throw new StoryError(`${where}: mail must be an object`);
  return { from: str(where, raw, 'from'), subject: str(where, raw, 'subject'), body: str(where, raw, 'body') };
}

export function parseStory(data: unknown, file = 'story.json'): StoryDef {
  if (!isObj(data) || !Array.isArray(data.beats)) throw new StoryError('must be an object with a "beats" list');
  const seen = new Set<string>();
  const beats = data.beats.map((raw, index): StoryBeat => {
    if (!isObj(raw)) throw new StoryError(`beat ${index} must be an object`);
    const id = str(`beat ${index}`, raw, 'id');
    const where = `beat "${id}"`;
    if (!/^[a-z0-9-]+$/.test(id)) throw new StoryError(`${where}: id may only use a-z, 0-9 and -`);
    if (seen.has(id)) throw new StoryError(`${where}: id is used twice`);
    seen.add(id);
    if (raw.mail === undefined && raw.contractId === undefined && raw.raid === undefined) {
      throw new StoryError(`${where}: a beat must do something (mail, contractId or raid)`);
    }
    return {
      id,
      ...(optNum(where, raw, 'minRating', 0) === undefined ? {} : { minRating: optNum(where, raw, 'minRating', 0) }),
      ...(optNum(where, raw, 'afterHours', 0) === undefined ? {} : { afterHours: optNum(where, raw, 'afterHours', 0) }),
      ...(raw.requires === undefined ? {} : { requires: str(where, raw, 'requires') }),
      ...(raw.mail === undefined ? {} : { mail: parseMail(where, raw.mail) }),
      ...(raw.contractId === undefined ? {} : { contractId: str(where, raw, 'contractId') }),
      ...(raw.raid === undefined ? {} : { raid: str(where, raw, 'raid') }),
      ...(raw.reveal === undefined ? {} : { reveal: raw.reveal === true }),
    };
  });
  void (file);
  return { beats };
}

/** Checks a story's references against the rest of the content. Throws on the first problem. */
export function checkStory(story: StoryDef, servers: readonly ServerDef[], contracts: readonly ContractDef[], rivals: readonly RivalDef[]): void {
  const contractById = new Map(contracts.map((contract) => [contract.id, contract]));
  for (const beat of story.beats) {
    const where = `story beat "${beat.id}"`;
    if (beat.requires !== undefined && !contractById.has(beat.requires)) {
      throw new StoryError(`${where}: requires "${beat.requires}", which is not a contract`);
    }
    if (beat.contractId !== undefined) {
      const contract = contractById.get(beat.contractId);
      if (!contract) throw new StoryError(`${where}: contractId "${beat.contractId}" is not a contract`);
      if (!contract.story) throw new StoryError(`${where}: contract "${beat.contractId}" must be marked story: true`);
      if (!servers.some((server) => server.id === contract.targetId)) {
        throw new StoryError(`${where}: contract "${beat.contractId}" targets a server that does not exist`);
      }
    }
    if (beat.raid !== undefined && !rivals.some((rival) => rival.id === beat.raid)) {
      throw new StoryError(`${where}: raid "${beat.raid}" is not a rival`);
    }
  }
}
