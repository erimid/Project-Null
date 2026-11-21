/**
 * The story, as lines of beats. Each line runs on its own: it opens when
 * its condition holds, then walks its beats in order, each arriving on its
 * own clock (a rating, a gap since the line's last beat, a contract done,
 * a condition). Lines run side by side, so Act 3's four doors can be
 * worked in any order. Arriving can send a message, put a story contract
 * on the board, or set an enemy hacker on the player. A contract beat
 * waits to be delivered before the line moves on; a beat with no contract
 * passes straight on. See core/story.ts for the director that runs them.
 *
 * Acts 1 and 2 are the line "main". A story.json with a bare "beats" list
 * is read as that one line.
 *
 * The missions themselves are ordinary contracts in contracts.json marked
 * `story: true`, so every lookup and check already handles them. A beat
 * only names one by id.
 *
 * Every beat that passes sets the flag `story:<beat id>`, so any condition
 * anywhere (another line, a contract's `when`, a heist ally) can wait on it.
 */
import { parseCondition, type ConditionDef, type ContractDef, type ServerDef } from './schema';
import type { RivalDef } from './rivals';

/** One message a beat sends to the player's inbox when it arrives. */
export interface StoryMail {
  readonly from: string;
  readonly subject: string;
  readonly body: string;
}

/**
 * What happens if a beat that has arrived is left undone too long: a timed
 * turn. It fires once. `withdraw` takes the beat's contract off the board
 * and moves the line on without it (the beat's own flag is not set).
 */
export interface StoryLapse {
  /** Game hours after the beat arrived. */
  readonly hours: number;
  readonly mail?: StoryMail;
  /** Flags set when it fires, e.g. "station-taken". */
  readonly set?: readonly string[];
  /** Flags cleared when it fires. */
  readonly clear?: readonly string[];
  readonly withdraw?: boolean;
  /** Servers Chorus takes when it fires (see content/chorus.ts). */
  readonly take?: readonly string[];
}

/** One step of the story. */
export interface StoryBeat {
  readonly id: string;
  /** Rating the player must have reached before this beat can arrive. */
  readonly minRating?: number;
  /** In-game hours that must pass after the line's previous beat (or its opening) before this one can arrive. */
  readonly afterHours?: number;
  /** A contract (any id) that must be completed before this beat can arrive. */
  readonly requires?: string;
  /** The beat waits until this holds. */
  readonly when?: ConditionDef;
  /** Decided when the line reaches the beat: if this does not hold, the beat is skipped (no flag, no message). */
  readonly if?: ConditionDef;
  /** A message sent when the beat arrives. */
  readonly mail?: StoryMail;
  /** A story contract (id in contracts.json, marked story) put on the board when the beat arrives. The beat waits for its delivery. */
  readonly contractId?: string;
  /** A rival hacker (id in rivals.json) set on the player when the beat arrives. */
  readonly raid?: string;
  /** Flags set when the beat passes (after its contract, if any, is delivered). */
  readonly set?: readonly string[];
  /** Flags cleared when the beat passes: how a timed turn is undone. */
  readonly clear?: readonly string[];
  /** Standing moved with patrons when the beat passes, by patron id. The AIs' hidden trust is the patron "ais". */
  readonly standing?: Readonly<Record<string, number>>;
  /** Servers Chorus takes when the beat passes. */
  readonly take?: readonly string[];
  /** Servers won back from Chorus when the beat passes. */
  readonly free?: readonly string[];
  /** Game hours the beat sets Chorus's clock back when it passes, on top of the usual. */
  readonly chorus?: number;
  /** A timed turn: what happens if the beat is left undone too long. */
  readonly lapse?: StoryLapse;
  /** True for a beat where the name is glimpsed. Nothing in the rules depends on it. */
  readonly reveal?: boolean;
}

/** A run of beats that moves on its own. */
export interface StoryLine {
  readonly id: string;
  /** The line opens once this holds. Missing = from the start. */
  readonly when?: ConditionDef;
  /** Rating at which the line opens. */
  readonly minRating?: number;
  readonly beats: readonly StoryBeat[];
}

export interface StoryDef {
  /** Every beat of every line, line by line. Handy for lookups. */
  readonly beats: readonly StoryBeat[];
  /** The lines. Missing = one line, "main", holding `beats`. */
  readonly lines?: readonly StoryLine[];
}

/** The line Acts 1 and 2 run on, and the one a save from before lines is moved onto. */
export const MAIN_LINE = 'main';

/** The flag a passed beat sets. */
export const beatFlag = (beatId: string): string => `story:${beatId}`;

/** A story's lines, whichever way it was written. */
export function linesOf(story: StoryDef): readonly StoryLine[] {
  return story.lines ?? [{ id: MAIN_LINE, beats: story.beats }];
}

/** Builds a story from lines, filling in the flat list of beats. */
export function storyOf(lines: readonly StoryLine[]): StoryDef {
  return { lines, beats: lines.flatMap((line) => line.beats) };
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

function flagList(where: string, raw: Record<string, unknown>, key: string): readonly string[] | undefined {
  const value = raw[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0 || !value.every((item) => typeof item === 'string' && /^[a-z0-9:/-]+$/.test(item))) {
    throw new StoryError(`${where}: "${key}" must be a list of flags (a-z, 0-9, -, : and /)`);
  }
  return value as string[];
}

function idList(where: string, raw: Record<string, unknown>, key: string): readonly string[] | undefined {
  const value = raw[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0 || !value.every((item) => typeof item === 'string' && item.length > 0)) throw new StoryError(`${where}: "${key}" must be a list of server ids`);
  return value as string[];
}

function standingDeltas(where: string, value: unknown): Record<string, number> {
  if (!isObj(value)) throw new StoryError(`${where}: "standing" must be an object`);
  for (const [id, delta] of Object.entries(value)) {
    if (typeof delta !== 'number' || !Number.isInteger(delta) || Math.abs(delta) > 20) throw new StoryError(`${where}: standing for "${id}" must be a whole number from -20 to 20`);
  }
  return value as Record<string, number>;
}

const condition = (where: string, value: unknown): ConditionDef => parseCondition('story.json', where, value);

function parseLapse(where: string, raw: unknown): StoryLapse {
  if (!isObj(raw)) throw new StoryError(`${where}: lapse must be an object`);
  const hours = optNum(`${where} lapse`, raw, 'hours', 1);
  if (hours === undefined) throw new StoryError(`${where}: lapse needs "hours"`);
  const set = flagList(`${where} lapse`, raw, 'set');
  const clear = flagList(`${where} lapse`, raw, 'clear');
  const take = idList(`${where} lapse`, raw, 'take');
  if (raw.mail === undefined && set === undefined && clear === undefined && take === undefined && raw.withdraw !== true) {
    throw new StoryError(`${where}: a lapse must do something (mail, set, clear, take or withdraw)`);
  }
  return {
    hours,
    ...(raw.mail === undefined ? {} : { mail: parseMail(`${where} lapse`, raw.mail) }),
    ...(set === undefined ? {} : { set }),
    ...(clear === undefined ? {} : { clear }),
    ...(raw.withdraw === true ? { withdraw: true } : {}),
    ...(take === undefined ? {} : { take }),
  };
}

const BEAT_KEYS = ['id', 'minRating', 'afterHours', 'requires', 'when', 'if', 'mail', 'contractId', 'raid', 'set', 'clear', 'standing', 'take', 'free', 'chorus', 'lapse', 'reveal'];

function parseBeat(raw: unknown, index: number, seen: Set<string>): StoryBeat {
  if (!isObj(raw)) throw new StoryError(`beat ${index} must be an object`);
  const id = str(`beat ${index}`, raw, 'id');
  const where = `beat "${id}"`;
  if (!/^[a-z0-9-]+$/.test(id)) throw new StoryError(`${where}: id may only use a-z, 0-9 and -`);
  if (seen.has(id)) throw new StoryError(`${where}: id is used twice`);
  seen.add(id);
  for (const key of Object.keys(raw)) if (!BEAT_KEYS.includes(key)) throw new StoryError(`${where}: unknown part "${key}"`);
  if (raw.mail === undefined && raw.contractId === undefined && raw.raid === undefined && raw.set === undefined && raw.clear === undefined && raw.standing === undefined && raw.take === undefined && raw.free === undefined) {
    throw new StoryError(`${where}: a beat must do something (mail, contractId, raid, set, clear, standing, take or free)`);
  }
  if (raw.lapse !== undefined && raw.contractId === undefined) throw new StoryError(`${where}: only a beat with a contract can lapse`);
  const minRating = optNum(where, raw, 'minRating', 0);
  const afterHours = optNum(where, raw, 'afterHours', 0);
  const set = flagList(where, raw, 'set');
  const clear = flagList(where, raw, 'clear');
  const take = idList(where, raw, 'take');
  const free = idList(where, raw, 'free');
  const chorus = optNum(where, raw, 'chorus', 0);
  return {
    id,
    ...(minRating === undefined ? {} : { minRating }),
    ...(afterHours === undefined ? {} : { afterHours }),
    ...(raw.requires === undefined ? {} : { requires: str(where, raw, 'requires') }),
    ...(raw.when === undefined ? {} : { when: condition(where, raw.when) }),
    ...(raw.if === undefined ? {} : { if: condition(`${where} if`, raw.if) }),
    ...(raw.mail === undefined ? {} : { mail: parseMail(where, raw.mail) }),
    ...(raw.contractId === undefined ? {} : { contractId: str(where, raw, 'contractId') }),
    ...(raw.raid === undefined ? {} : { raid: str(where, raw, 'raid') }),
    ...(set === undefined ? {} : { set }),
    ...(clear === undefined ? {} : { clear }),
    ...(raw.standing === undefined ? {} : { standing: standingDeltas(where, raw.standing) }),
    ...(take === undefined ? {} : { take }),
    ...(free === undefined ? {} : { free }),
    ...(chorus === undefined ? {} : { chorus }),
    ...(raw.lapse === undefined ? {} : { lapse: parseLapse(where, raw.lapse) }),
    ...(raw.reveal === undefined ? {} : { reveal: raw.reveal === true }),
  };
}

export function parseStory(data: unknown): StoryDef {
  if (!isObj(data)) throw new StoryError('must be an object with a "lines" list');
  const rawLines: unknown[] = Array.isArray(data.lines) ? data.lines : Array.isArray(data.beats) ? [{ id: MAIN_LINE, beats: data.beats }] : [];
  if (rawLines.length === 0) throw new StoryError('must be an object with a "lines" list');
  const seen = new Set<string>();
  const lineIds = new Set<string>();
  let index = 0;
  const lines = rawLines.map((raw, at): StoryLine => {
    if (!isObj(raw) || !Array.isArray(raw.beats) || raw.beats.length === 0) throw new StoryError(`line ${at} must be an object with a non-empty "beats" list`);
    const id = str(`line ${at}`, raw, 'id');
    if (!/^[a-z0-9-]+$/.test(id)) throw new StoryError(`line "${id}": id may only use a-z, 0-9 and -`);
    if (lineIds.has(id)) throw new StoryError(`line "${id}": id is used twice`);
    lineIds.add(id);
    const minRating = optNum(`line "${id}"`, raw, 'minRating', 0);
    return {
      id,
      ...(raw.when === undefined ? {} : { when: condition(`line "${id}"`, raw.when) }),
      ...(minRating === undefined ? {} : { minRating }),
      beats: raw.beats.map((beat) => parseBeat(beat, index++, seen)),
    };
  });
  if (!lineIds.has(MAIN_LINE)) throw new StoryError(`there must be a line "${MAIN_LINE}"`);
  return storyOf(lines);
}

/** Every condition in a story, with where it is, for checking. */
function conditionsOf(story: StoryDef): { where: string; condition: ConditionDef }[] {
  return linesOf(story).flatMap((line) => [
    ...(line.when ? [{ where: `story line "${line.id}"`, condition: line.when }] : []),
    ...line.beats.flatMap((beat) => [
      ...(beat.when ? [{ where: `story beat "${beat.id}"`, condition: beat.when }] : []),
      ...(beat.if ? [{ where: `story beat "${beat.id}" if`, condition: beat.if }] : []),
    ]),
  ]);
}

/** Checks a story's references against the rest of the content. Throws on the first problem. */
export function checkStory(
  story: StoryDef,
  servers: readonly ServerDef[],
  contracts: readonly ContractDef[],
  rivals: readonly RivalDef[],
  patronIds?: readonly string[],
): void {
  const contractById = new Map(contracts.map((contract) => [contract.id, contract]));
  const beatIds = new Set(story.beats.map((beat) => beat.id));
  const offeredBy = new Map<string, string>();
  const checkFlags = (where: string, flags: readonly string[] | undefined) => {
    for (const flag of flags ?? []) {
      if (flag.startsWith('story:') && !beatIds.has(flag.slice(6))) throw new StoryError(`${where}: flag "${flag}" names a beat that does not exist`);
    }
  };
  const checkPatrons = (where: string, ids: Iterable<string>) => {
    if (!patronIds) return;
    for (const id of ids) if (!patronIds.includes(id)) throw new StoryError(`${where}: "${id}" is not a patron`);
  };
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
      const other = offeredBy.get(beat.contractId);
      if (other) throw new StoryError(`${where}: contract "${beat.contractId}" is already offered by beat "${other}"`);
      offeredBy.set(beat.contractId, beat.id);
    }
    for (const id of [...(beat.take ?? []), ...(beat.free ?? []), ...(beat.lapse?.take ?? [])]) {
      if (!servers.some((server) => server.id === id)) throw new StoryError(`${where}: "${id}" is not a server`);
    }
    if (beat.raid !== undefined && beat.raid !== 'chorus' && !rivals.some((rival) => rival.id === beat.raid)) {
      throw new StoryError(`${where}: raid "${beat.raid}" is not a rival`);
    }
    checkFlags(where, beat.set);
    checkFlags(where, beat.clear);
    checkFlags(`${where} lapse`, beat.lapse?.set);
    checkPatrons(where, Object.keys(beat.standing ?? {}));
  }
  for (const { where, condition } of conditionsOf(story)) {
    checkFlags(where, condition.flags);
    checkFlags(where, condition.notFlags);
    checkPatrons(where, [...Object.keys(condition.standing ?? {}), ...Object.keys(condition.below ?? {})]);
    for (const id of Object.keys(condition.choices ?? {})) {
      if (!contractById.get(id)?.choices?.length) throw new StoryError(`${where}: choices names "${id}", which is not a contract with choices`);
    }
  }
}
