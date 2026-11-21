/**
 * The Continental Wire's daily paper: templates for headlines about the
 * player's own work (always from the victim's side, never naming the
 * player), how companies react, background events, and small story items
 * the public misreads. Written in news.json; checked here when the game
 * starts. The rules that print an edition are in core/news.ts.
 *
 * Text may use: {company} {city} {CITY} (upper case) {country} {weekday},
 * and where they apply {records} {layer} {company2} {city2} {handle}
 * {ocean}. Paragraphs in a body are split by a blank line.
 */
import { ContentError } from './schema';

export interface NewsTemplate {
  readonly headline: string;
  readonly body: string;
  /** If set, only used for companies in these lines of business (see companies.json). */
  readonly sectors?: readonly string[];
}

/** Kinds of the player's work that make the news, one list of templates each. */
export const NEWS_JOB_KINDS = ['steal', 'destroy', 'record', 'read', 'plant', 'frame', 'caught'] as const;
export type NewsJobKind = (typeof NEWS_JOB_KINDS)[number];

/** Something that happens in the world on its own. */
export interface NewsEventDef extends NewsTemplate {
  readonly id: string;
  /** If set, the event opens a short-lived job against the company on the board. */
  readonly job?: { readonly hours: number; readonly pay: number };
}

/** A small item printed once, in the first edition after a story beat has passed. */
export interface NewsStoryDef extends NewsTemplate {
  /** Id of the story beat (story.json) it follows. */
  readonly after: string;
}

export interface NewsDef {
  readonly jobs: Readonly<Record<NewsJobKind, readonly NewsTemplate[]>>;
  readonly reactions: { readonly guard: readonly NewsTemplate[]; readonly firm: readonly NewsTemplate[] };
  readonly events: readonly NewsEventDef[];
  readonly story: readonly NewsStoryDef[];
  /** Handles of hackers the police arrest in the background. Never the player's rivals. */
  readonly handles: readonly string[];
  readonly weather: readonly string[];
}

/** A paper with nothing to print. Tests and old content use it. */
export const NO_NEWS: NewsDef = {
  jobs: { steal: [], destroy: [], record: [], read: [], plant: [], frame: [], caught: [] },
  reactions: { guard: [], firm: [] },
  events: [],
  story: [],
  handles: [],
  weather: [],
};

type Obj = Record<string, unknown>;
const isObj = (value: unknown): value is Obj => typeof value === 'object' && value !== null && !Array.isArray(value);

export function parseNews(data: unknown, file = 'news.json'): NewsDef {
  const fail = (message: string): never => {
    throw new ContentError(file, message);
  };
  const text = (value: unknown, where: string): string => (typeof value === 'string' && value.trim() !== '' ? value : fail(`${where} needs non-empty text`));
  const texts = (value: unknown, where: string): string[] => (Array.isArray(value) ? value.map((item, i) => text(item, `${where} ${i}`)) : fail(`${where} must be a list`));
  const template = (value: unknown, where: string): NewsTemplate => {
    if (!isObj(value)) return fail(`${where} must be an object`);
    return {
      headline: text(value.headline, `${where} headline`),
      body: text(value.body, `${where} body`),
      ...(value.sectors === undefined ? {} : { sectors: texts(value.sectors, `${where} sectors`) }),
    };
  };
  const templates = (value: unknown, where: string): NewsTemplate[] =>
    Array.isArray(value) ? value.map((item, i) => template(item, `${where} ${i}`)) : fail(`${where} must be a list`);

  if (!isObj(data)) return fail('must be an object');
  if (!isObj(data.jobs)) return fail('needs "jobs"');
  const jobsRaw = data.jobs;
  const jobs = Object.fromEntries(NEWS_JOB_KINDS.map((kind) => [kind, templates(jobsRaw[kind], `jobs ${kind}`)])) as Record<NewsJobKind, NewsTemplate[]>;
  if (!isObj(data.reactions)) return fail('needs "reactions"');
  const reactions = { guard: templates(data.reactions.guard, 'reactions guard'), firm: templates(data.reactions.firm, 'reactions firm') };
  if (!Array.isArray(data.events)) return fail('"events" must be a list');
  const seen = new Set<string>();
  const events = data.events.map((value, i): NewsEventDef => {
    const where = `event ${i}`;
    const base = template(value, where);
    const raw = value as Obj;
    const id = text(raw.id, `${where} id`);
    if (seen.has(id)) fail(`event id "${id}" is used twice`);
    seen.add(id);
    let job: NewsEventDef['job'];
    if (raw.job !== undefined) {
      if (!isObj(raw.job) || typeof raw.job.hours !== 'number' || raw.job.hours <= 0 || typeof raw.job.pay !== 'number' || raw.job.pay <= 0) {
        fail(`${where} job needs positive "hours" and "pay"`);
      }
      const spec = raw.job as { hours: number; pay: number };
      job = { hours: spec.hours, pay: spec.pay };
    }
    return { ...base, id, ...(job ? { job } : {}) };
  });
  const story = (Array.isArray(data.story) ? data.story : fail('"story" must be a list')).map((value, i): NewsStoryDef => ({
    ...template(value, `story ${i}`),
    after: text((value as Obj).after, `story ${i} after`),
  }));
  return { jobs, reactions, events, story, handles: texts(data.handles, 'handles'), weather: texts(data.weather, 'weather') };
}

/** Checks that story items follow real beats and sector filters name real sectors. */
export function checkNews(news: NewsDef, beatIds: readonly string[], sectorIds: readonly string[], file = 'news.json'): void {
  for (const item of news.story) {
    if (!beatIds.includes(item.after)) throw new ContentError(file, `story item "${item.headline}" follows unknown beat "${item.after}"`);
  }
  const all = [...Object.values(news.jobs).flat(), ...news.reactions.guard, ...news.reactions.firm, ...news.events];
  for (const item of all) {
    for (const sector of item.sectors ?? []) {
      if (!sectorIds.includes(sector)) throw new ContentError(file, `"${item.headline}" names unknown sector "${sector}"`);
    }
  }
  // The player's name never reaches the paper.
  for (const item of [...all, ...news.story]) {
    if (/\{handle\}/.test(item.headline + item.body) && !news.events.includes(item as NewsEventDef)) {
      throw new ContentError(file, `"${item.headline}" may not use {handle} outside a background event`);
    }
  }
}
