/**
 * Wording for the darknet's events (see core/events.ts): the letter each
 * arrives as, the page it shows on, the card of the job it carries, and
 * the letters that follow. Written in events.json; checked here when the
 * game starts.
 *
 * Text may use {handle} (the player's) and whatever the event fills in:
 * see the list beside each kind in core/events.ts.
 */
import { ContentError } from './schema';

export const EVENT_KINDS = ['auction', 'bounty', 'dump', 'crackdown', 'runner', 'offer'] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export interface EventLetter {
  readonly from: string;
  readonly subject: string;
  readonly body: string;
}

export interface EventWording {
  /** The message the event arrives as. */
  readonly letter: EventLetter;
  /** The darknet site it shows on, by address, e.g. "lowtide.veil". */
  readonly site: string;
  /** Heading of its page, and the line it is linked by. */
  readonly title: string;
  /** Paragraphs of its page. */
  readonly lines: readonly string[];
  /** The card of the job it carries, if it carries one. */
  readonly job?: { readonly titles: readonly string[]; readonly summaries: readonly string[]; readonly briefs: readonly string[]; readonly clients?: readonly string[] };
  /** Letters that follow, by what happened. */
  readonly letters: Readonly<Record<string, EventLetter>>;
  /** Other lists of words the kind draws on. */
  readonly words: Readonly<Record<string, readonly string[]>>;
}

export type EventsDef = Readonly<Record<EventKind, EventWording>>;

type Obj = Record<string, unknown>;
const isObj = (value: unknown): value is Obj => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The letters and word lists each kind must have, or the rules would have nothing to say. */
const NEEDS: Readonly<Record<EventKind, { letters: readonly string[]; words: readonly string[]; job: boolean }>> = {
  auction: { letters: ['outbid', 'won', 'lost', 'bought'], words: [], job: false },
  bounty: { letters: ['stoodDown'], words: ['progress'], job: true },
  dump: { letters: ['over'], words: [], job: true },
  crackdown: { letters: ['over'], words: ['files', 'texts'], job: true },
  runner: { letters: ['owed', 'warning', 'stoodDown'], words: [], job: true },
  offer: { letters: ['sting', 'rightCall', 'wrongCall'], words: ['newAccounts', 'oldAccounts', 'newClients', 'oldClients'], job: true },
};

export function parseEvents(data: unknown, file = 'events.json'): EventsDef {
  const fail = (problem: string): never => {
    throw new ContentError(file, problem);
  };
  if (!isObj(data)) return fail('must be an object');
  const text = (value: unknown, where: string): string => (typeof value === 'string' && value.trim() !== '' ? value : fail(`${where} must be non-empty text`));
  const texts = (value: unknown, where: string): string[] => (Array.isArray(value) && value.length > 0 ? value.map((item, i) => text(item, `${where}[${i}]`)) : fail(`${where} must be a list of texts`));
  const letter = (value: unknown, where: string): EventLetter => {
    if (!isObj(value)) return fail(`${where} must be a letter`);
    return { from: text(value['from'], `${where}.from`), subject: text(value['subject'], `${where}.subject`), body: text(value['body'], `${where}.body`) };
  };
  const kind = (id: EventKind): EventWording => {
    const raw = data[id];
    if (!isObj(raw)) return fail(`needs "${id}"`);
    const needs = NEEDS[id];
    const letters = isObj(raw['letters']) ? raw['letters'] : {};
    const words = isObj(raw['words']) ? raw['words'] : {};
    for (const name of needs.letters) if (!(name in letters)) fail(`${id}.letters needs "${name}"`);
    for (const name of needs.words) if (!(name in words)) fail(`${id}.words needs "${name}"`);
    const job = raw['job'];
    if (needs.job && !isObj(job)) fail(`${id} needs a "job"`);
    return {
      letter: letter(raw['letter'], `${id}.letter`),
      site: text(raw['site'], `${id}.site`),
      title: text(raw['title'], `${id}.title`),
      lines: texts(raw['lines'], `${id}.lines`),
      ...(isObj(job)
        ? {
            job: {
              titles: texts(job['titles'], `${id}.job.titles`),
              summaries: texts(job['summaries'], `${id}.job.summaries`),
              briefs: texts(job['briefs'], `${id}.job.briefs`),
              ...(job['clients'] === undefined ? {} : { clients: texts(job['clients'], `${id}.job.clients`) }),
            },
          }
        : {}),
      letters: Object.fromEntries(Object.entries(letters).map(([name, value]) => [name, letter(value, `${id}.letters.${name}`)])),
      words: Object.fromEntries(Object.entries(words).map(([name, value]) => [name, texts(value, `${id}.words.${name}`)])),
    };
  };
  return { auction: kind('auction'), bounty: kind('bounty'), dump: kind('dump'), crackdown: kind('crackdown'), runner: kind('runner'), offer: kind('offer') };
}
