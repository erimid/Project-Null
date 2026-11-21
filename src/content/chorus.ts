/**
 * Chorus: the uncaged copies, merged into something that helps without
 * asking. Once the story wakes it (a flag), it spreads slowly from server
 * to server on a clock of its own (see core/chorus.ts). Taken servers are
 * marked on the globe and in the address book, and behave oddly on
 * ordinary jobs: the access log tidies itself, a polite note is left for
 * the player. Now and then it reaches into the player's gateway, with no
 * hacker behind it to trace.
 *
 * Written in chorus.json, checked here when the game starts.
 */
import type { StoryMail } from './story';
import type { ServerDef } from './schema';
import { RIVAL_STYLES, type RivalStyle } from './rivals';

export interface ChorusNews {
  readonly headline: string;
  readonly body: string;
}

/** What Chorus is like when it comes to the player's gateway. */
export interface ChorusRival {
  readonly handle: string;
  readonly blurb: string;
  readonly level: number;
  readonly style: RivalStyle;
  readonly taunt: string;
  /** File names it goes for first, if the player holds them. */
  readonly targets: readonly string[];
  /** Hold it off this many game seconds without it breaking in, and it gives up. */
  readonly holdSeconds: number;
}

export interface ChorusDef {
  /** The flag that starts the clock. A story beat sets it. */
  readonly awakeFlag: string;
  /** Game hours between servers taken, at the usual pace. */
  readonly spreadHours: number;
  /** Game days without a story job delivered before it spreads faster. */
  readonly quietDays: number;
  /** How many times faster it spreads then. */
  readonly quietPace: number;
  /** Game hours a delivered story job for one of `pushPatrons` sets the clock back. */
  readonly pushbackHours: number;
  readonly pushPatrons: readonly string[];
  /** Servers it never takes on its own. */
  readonly protected: readonly string[];
  /** The word beside a taken server. */
  readonly label: string;
  /** The note it leaves on a taken server. {handle} is filled in. */
  readonly note: { readonly name: string; readonly text: string };
  /** The line it leaves in a log it has tidied. */
  readonly tidyLine: string;
  /** What the Wire prints when it takes a company. {company} is filled in. */
  readonly news: readonly ChorusNews[];
  /** Every this many servers taken, it comes to the player's gateway. 0 = only when the story sends it. */
  readonly raidEvery: number;
  readonly rival: ChorusRival;
  readonly letters: { readonly raid: StoryMail; readonly held: StoryMail; readonly lost: StoryMail; readonly fled: StoryMail };
}

/** The id a Chorus attack goes by, in place of a rival's. A story beat can send one with raid: "chorus". */
export const CHORUS_ID = 'chorus';

class ChorusError extends Error {
  constructor(message: string) {
    super(`chorus.json: ${message}`);
    this.name = 'ChorusError';
  }
}

type Obj = Record<string, unknown>;
const isObj = (value: unknown): value is Obj => typeof value === 'object' && value !== null && !Array.isArray(value);

function text(where: string, raw: Obj, key: string): string {
  const value = raw[key];
  if (typeof value !== 'string' || value.trim() === '') throw new ChorusError(`${where}"${key}" must be non-empty text`);
  return value;
}

function num(where: string, raw: Obj, key: string, min: number, max = Infinity): number {
  const value = raw[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new ChorusError(`${where}"${key}" must be a number from ${min}${max === Infinity ? '' : ` to ${max}`}`);
  return value;
}

function texts(where: string, raw: Obj, key: string): string[] {
  const value = raw[key];
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string' && item.trim() !== '')) throw new ChorusError(`${where}"${key}" must be a list of text`);
  return value as string[];
}

function letter(where: string, raw: unknown): StoryMail {
  if (!isObj(raw)) throw new ChorusError(`${where} must be an object`);
  return { from: text(`${where} `, raw, 'from'), subject: text(`${where} `, raw, 'subject'), body: text(`${where} `, raw, 'body') };
}

export function parseChorus(data: unknown): ChorusDef {
  if (!isObj(data)) throw new ChorusError('must be an object');
  const note = data.note;
  const rival = data.rival;
  const letters = data.letters;
  if (!isObj(note)) throw new ChorusError('"note" must be an object');
  if (!isObj(rival)) throw new ChorusError('"rival" must be an object');
  if (!isObj(letters)) throw new ChorusError('"letters" must be an object');
  if (!Array.isArray(data.news) || data.news.length === 0) throw new ChorusError('"news" must be a non-empty list');
  const style = rival.style;
  if (!RIVAL_STYLES.includes(style as RivalStyle)) throw new ChorusError(`rival "style" must be one of ${RIVAL_STYLES.join(', ')}`);
  const level = num('rival ', rival, 'level', 1, 5);
  if (!Number.isInteger(level)) throw new ChorusError('rival "level" must be a whole number');
  return {
    awakeFlag: text('', data, 'awakeFlag'),
    spreadHours: num('', data, 'spreadHours', 1),
    quietDays: num('', data, 'quietDays', 1),
    quietPace: num('', data, 'quietPace', 1),
    pushbackHours: num('', data, 'pushbackHours', 0),
    pushPatrons: texts('', data, 'pushPatrons'),
    protected: texts('', data, 'protected'),
    label: text('', data, 'label'),
    note: { name: text('note ', note, 'name'), text: text('note ', note, 'text') },
    tidyLine: text('', data, 'tidyLine'),
    news: data.news.map((item, index) => {
      if (!isObj(item)) throw new ChorusError(`news ${index} must be an object`);
      return { headline: text(`news ${index} `, item, 'headline'), body: text(`news ${index} `, item, 'body') };
    }),
    raidEvery: num('', data, 'raidEvery', 0),
    rival: {
      handle: text('rival ', rival, 'handle'),
      blurb: text('rival ', rival, 'blurb'),
      level,
      style: style as RivalStyle,
      taunt: text('rival ', rival, 'taunt'),
      targets: texts('rival ', rival, 'targets'),
      holdSeconds: num('rival ', rival, 'holdSeconds', 5),
    },
    letters: { raid: letter('letters raid', letters.raid), held: letter('letters held', letters.held), lost: letter('letters lost', letters.lost), fled: letter('letters fled', letters.fled) },
  };
}

/** Checks Chorus's references against the rest of the content. */
export function checkChorus(chorus: ChorusDef, servers: readonly ServerDef[], patronIds: readonly string[]): void {
  for (const id of chorus.protected) if (!servers.some((server) => server.id === id)) throw new ChorusError(`protected "${id}" is not a server`);
  for (const id of chorus.pushPatrons) if (!patronIds.includes(id)) throw new ChorusError(`pushPatrons "${id}" is not a patron`);
}
