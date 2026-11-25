/**
 * Written pools that ordinary companies are generated from: cities,
 * staff names, name stems, and one template per line of business with
 * its files, records and log lines. Also the wording of the repeatable
 * jobs posted against those companies. Written in companies.json;
 * checked here when the game starts.
 *
 * Files may name a `folder` (e.g. "finance/{year}") to sit in.
 *
 * Text may use these placeholders, filled in when a company or job is
 * made: {company} {city} {staff} {staff2} {year} {q} {n} {ip}, and in
 * jobs also {file} {key} {value} {column} {records} {tier}.
 */
import { ContentError, parsePart, parseProgramFile, ROLES, type PartDef, type ProgramFileDef, type Role } from './schema';

export interface CityDef {
  readonly city: string;
  readonly country: string;
  readonly lat: number;
  readonly lon: number;
  /** First two parts of the network addresses of companies there, e.g. "77.161". */
  readonly net: string;
}

export interface FileTemplate {
  readonly name: string;
  /** Smallest and largest size, in GB. */
  readonly sizeGb: readonly [number, number];
  /** Missing = admin. */
  readonly access?: Role;
  /** What the file says when opened. Files without it show as raw data. */
  readonly text?: string;
  /** The folder it sits in; may use placeholders. Missing = the top folder. */
  readonly folder?: string;
}

export interface RecordsTemplate {
  readonly title: string;
  /** Two columns: the key, and the value a job can change. */
  readonly columns: readonly [string, string];
  /** How a row's key is written, with {n} for a number. */
  readonly key: string;
  readonly values: readonly string[];
}

/**
 * A file some companies of a sector hold that is more than data: a
 * module installer (`part`) or a compiled program (`program`). Each
 * company has it with probability `chance`. Companies of tier 4 and 5
 * hold better modules: every grade is one higher, up to 3.
 */
export interface InstallerTemplate {
  readonly name: string;
  readonly sizeGb: readonly [number, number];
  readonly chance: number;
  readonly text?: string;
  readonly part?: PartDef;
  readonly program?: ProgramFileDef;
}

export interface SectorDef {
  readonly id: string;
  /** Put after a name stem: "Freight", "Clinic"... */
  readonly suffixes: readonly string[];
  readonly blurbs: readonly string[];
  /** Short tag used in host names, e.g. "DSP". */
  readonly tag: string;
  readonly files: readonly FileTemplate[];
  readonly installers?: readonly InstallerTemplate[];
  readonly records?: RecordsTemplate;
}

/** The newer kinds of job the board can post. */
export const NEW_KINDS = ['frame', 'guard', 'hold', 'hunt', 'swap'] as const;
export type NewKind = (typeof NEW_KINDS)[number];

export interface JobWording {
  readonly titles: readonly string[];
  readonly summaries: readonly string[];
  readonly briefs: readonly string[];
}

/** The three kinds of one-step job the board makes. */
export const PLAIN_KINDS = ['steal', 'destroy', 'record'] as const;
export type PlainKind = (typeof PLAIN_KINDS)[number];

/** More wording for jobs against one trade: added to the general lists when the company is in that trade. Any part may be missing. */
export type TradeWording = Readonly<Partial<Record<PlainKind, Partial<JobWording>>>>;

/**
 * A regular: a small client with a name, who posts ordinary board jobs in
 * their own voice and remembers the work done for them (see
 * core/regulars.ts). Lines may use {company} {city} and {times} ("second",
 * "third"...: how many times they have come to the player, this one
 * included).
 */
export interface RegularDef {
  readonly id: string;
  readonly name: string;
  /** Who they are, in a few words. */
  readonly blurb: string;
  /** The rating from which they post work. */
  readonly minRating: number;
  /** The trades they post work against. Missing = any. */
  readonly sectors?: readonly string[];
  /** What they open a brief with the first time. */
  readonly intros: readonly string[];
  /** What they open with once the player has worked for them. */
  readonly again: readonly string[];
  readonly signoff: string;
}

/**
 * Wording for board jobs of several steps. Placeholders as for one-step
 * jobs, plus {company2} {city2} {address2} {user} {steps}, and {goal}
 * for one step's goal in a few words.
 */
export interface StagedWording {
  readonly titles: readonly string[];
  readonly summaries: readonly string[];
  /** The brief shown on the board, before the first step. */
  readonly briefs: readonly string[];
  /** What the client writes as a later step begins. */
  readonly next: readonly string[];
  /** A note left on the first server that holds the login for the second. */
  readonly keyNotes: readonly string[];
  /** What a second buyer says at delivery. */
  readonly rivals: readonly string[];
}

/** A note a job leaves on a server. `name` may use {n}, a number that keeps it apart from other jobs' notes. */
export interface NoteTemplate {
  readonly name: string;
  readonly text: string;
}

/** The kinds of job in core/sideJobs.ts, in the order they open up. */
export const SIDE_KINDS = ['deliver', 'leak', 'wipe', 'round', 'borrow'] as const;
export type SideKind = (typeof SIDE_KINDS)[number];

/**
 * Wording for the side kinds of board job (see core/sideJobs.ts). All text
 * may use {company} {city} {tier}; each kind adds its own:
 * - deliver: {file}. `files` are names for what the client sends.
 * - leak: {a} {b} {c}, the three suspects. A `lead` says what leaked and
 *   who could have. Each of `clears` rules out {staff}; a job uses two.
 * - wipe: {who} {company2} {hours}. `lines` are what the runner left in the
 *   log, with {who} and {ip}. `next` is what the client says between servers.
 * - round: {company2} {company3} {each} {bonus} {hours}; `next` as above.
 * - borrow: {goal} for the job itself in a few words, {mark} {boss} {other}
 *   for the three people on the `lists` note. Each of `notes` holds one
 *   detail (`fact`, and how a letter would `mention` it); a job uses two.
 *   `asks` is what the letter asks for and what comes back.
 * - terms: the line a job with optional terms carries, with {bonus} and
 *   {minutes} (fast) or {relays} (light).
 */
export interface SideWording {
  readonly deliver: JobWording & { readonly files: readonly string[] };
  readonly leak: JobWording & { readonly leads: readonly NoteTemplate[]; readonly clears: readonly NoteTemplate[] };
  readonly wipe: JobWording & { readonly lines: readonly string[]; readonly next: readonly string[] };
  readonly round: JobWording & { readonly next: readonly string[] };
  readonly borrow: JobWording & {
    readonly lists: readonly NoteTemplate[];
    readonly notes: readonly (NoteTemplate & { readonly fact: string; readonly mention: string })[];
    readonly asks: readonly { readonly label: string; readonly text: string; readonly reply: string }[];
  };
  readonly terms: Readonly<Record<'quiet' | 'fast' | 'light', readonly string[]>>;
}

export interface JobPools {
  readonly clients: readonly string[];
  readonly steal: JobWording;
  readonly destroy: JobWording;
  readonly record: JobWording;
  /** Missing = the board posts only one-step jobs. */
  readonly staged?: StagedWording;
  /**
   * Wording for the newer kinds of job (see core/kinds.ts), by kind. A kind
   * left out is never posted. Briefs may use {who} and {address} (frame),
   * {seconds} (guard, hold) and {rival} (guard).
   */
  readonly kinds?: Readonly<Partial<Record<NewKind, JobWording>>>;
  /** Handles of hackers who race the player for a job, or attack a server they guard. */
  readonly racers?: readonly string[];
  /** Missing = the board posts none of the side kinds, and no job carries terms. */
  readonly side?: SideWording;
  /**
   * Wording for board heists (see core/heists.ts). Missing = the board posts
   * none. Text may use {company} {city} {file} and {holds}, a list of the
   * servers to hold. `notes` describe a held server by the layer it controls.
   */
  readonly heist?: JobWording & { readonly notes: Readonly<Record<'firewall' | 'monitor' | 'proxy', readonly string[]>> };
  /** Words for how strong a company's security is, by tier (1 first). */
  readonly tiers: readonly string[];
  /** More wording by trade, by sector id. */
  readonly trades?: Readonly<Record<string, TradeWording>>;
  /** The regular clients. */
  readonly regulars?: readonly RegularDef[];
}

export interface CompanyPools {
  /** How many companies each game gets. */
  readonly count: number;
  readonly cities: readonly CityDef[];
  readonly first: readonly string[];
  readonly last: readonly string[];
  readonly stems: readonly string[];
  readonly logs: readonly string[];
  readonly sectors: readonly SectorDef[];
  /**
   * A second batch of companies, made after the first and apart from it
   * (see core/generate.ts), so that adding to it never changes a company
   * of the first batch in a game already under way.
   */
  readonly more?: MorePools;
  readonly jobs: JobPools;
}

export interface MorePools {
  readonly count: number;
  readonly stems: readonly string[];
  /** Cities the second batch can be in, besides the first batch's. */
  readonly cities: readonly CityDef[];
  /** The trades of the second batch. */
  readonly sectors: readonly SectorDef[];
}

/** Every line of business a generated company can be in. */
export const sectorsOf = (pools: CompanyPools): readonly SectorDef[] => (pools.more ? [...pools.sectors, ...pools.more.sectors] : pools.sectors);

/** Pools that make nothing: for worlds without generated companies. */
export const NO_COMPANIES: CompanyPools = {
  count: 0,
  cities: [],
  first: [],
  last: [],
  stems: [],
  logs: [],
  sectors: [],
  jobs: { clients: [], steal: { titles: [], summaries: [], briefs: [] }, destroy: { titles: [], summaries: [], briefs: [] }, record: { titles: [], summaries: [], briefs: [] }, tiers: [] },
};

type Obj = Record<string, unknown>;

export function parseCompanies(data: unknown, file = 'companies.json'): CompanyPools {
  const fail = (problem: string): never => {
    throw new ContentError(file, problem);
  };
  const obj = (value: unknown, where: string): Obj =>
    typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Obj) : fail(`${where} must be an object`);
  const texts = (value: unknown, where: string, min = 1): string[] =>
    Array.isArray(value) && value.length >= min && value.every((item) => typeof item === 'string' && item.trim() !== '')
      ? (value as string[])
      : fail(`${where} must be a list of at least ${min} texts`);
  const text = (value: unknown, where: string): string =>
    typeof value === 'string' && value.trim() !== '' ? value : fail(`${where} must be a non-empty text`);
  const number = (value: unknown, where: string, min: number, max: number): number =>
    typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : fail(`${where} must be a number from ${min} to ${max}`);
  const list = (value: unknown, where: string): unknown[] => (Array.isArray(value) && value.length > 0 ? value : fail(`${where} must be a non-empty list`));

  const raw = obj(data, 'the file');
  const toCity = (value: unknown, i: number): CityDef => {
    const city = obj(value, `city ${i}`);
    const net = text(city.net, `city ${i} net`);
    if (!/^\d{1,3}\.\d{1,3}$/.test(net) || net.split('.').some((part) => Number(part) > 255)) fail(`city ${i}: net "${net}" must look like "77.161"`);
    return {
      city: text(city.city, `city ${i} city`),
      country: text(city.country, `city ${i} country`),
      lat: number(city.lat, `city ${i} lat`, -90, 90),
      lon: number(city.lon, `city ${i} lon`, -180, 180),
      net,
    };
  };
  const cities = list(raw.cities, 'cities').map(toCity);
  const toSector = (value: unknown, i: number): SectorDef => {
    const sector = obj(value, `sector ${i}`);
    const id = text(sector.id, `sector ${i} id`);
    const where = `sector "${id}"`;
    const files = list(sector.files, `${where} files`).map((item, j): FileTemplate => {
      const f = obj(item, `${where} file ${j}`);
      const size = f.sizeGb;
      if (!Array.isArray(size) || size.length !== 2) fail(`${where} file ${j}: sizeGb must be [smallest, largest]`);
      const [low, high] = [number((size as unknown[])[0], `${where} file ${j} size`, 1, 1000), number((size as unknown[])[1], `${where} file ${j} size`, 1, 1000)];
      if (high < low) fail(`${where} file ${j}: sizeGb is the wrong way round`);
      const access = f.access === undefined ? undefined : text(f.access, `${where} file ${j} access`);
      if (access !== undefined && !(ROLES as readonly string[]).includes(access)) fail(`${where} file ${j}: access must be guest or admin`);
      return {
        name: text(f.name, `${where} file ${j} name`),
        sizeGb: [low, high],
        ...(access === undefined ? {} : { access: access as Role }),
        ...(f.text === undefined ? {} : { text: text(f.text, `${where} file ${j} text`) }),
        ...(f.folder === undefined ? {} : { folder: text(f.folder, `${where} file ${j} folder`) }),
      };
    });
    if (!files.some((f) => (f.access ?? 'admin') === 'admin')) fail(`${where} needs at least one admin file for jobs`);
    const installers = sector.installers === undefined ? [] : list(sector.installers, `${where} installers`).map((item, j): InstallerTemplate => {
      const f = obj(item, `${where} installer ${j}`);
      const name = text(f.name, `${where} installer ${j} name`);
      if (files.some((file) => file.name === name)) fail(`${where} installer "${name}" has the same name as a file`);
      const size = f.sizeGb;
      if (!Array.isArray(size) || size.length !== 2) fail(`${where} installer ${j}: sizeGb must be [smallest, largest]`);
      const [low, high] = [number((size as unknown[])[0], `${where} installer ${j} size`, 1, 1000), number((size as unknown[])[1], `${where} installer ${j} size`, 1, 1000)];
      if (high < low) fail(`${where} installer ${j}: sizeGb is the wrong way round`);
      if ((f.part === undefined) === (f.program === undefined)) fail(`${where} installer "${name}" must have either a part or a program`);
      return {
        name,
        sizeGb: [low, high],
        chance: number(f.chance, `${where} installer ${j} chance`, 0, 1),
        ...(f.text === undefined ? {} : { text: text(f.text, `${where} installer ${j} text`) }),
        ...(f.part === undefined ? {} : { part: parsePart(file, `${where} installer "${name}"`, f.part) }),
        ...(f.program === undefined ? {} : { program: parseProgramFile(file, `${where} installer "${name}"`, f.program) }),
      };
    });
    let records: RecordsTemplate | undefined;
    if (sector.records !== undefined) {
      const r = obj(sector.records, `${where} records`);
      const columns = texts(r.columns, `${where} records columns`, 2);
      if (columns.length !== 2) fail(`${where} records need exactly two columns`);
      const key = text(r.key, `${where} records key`);
      if (!key.includes('{n}')) fail(`${where} records key must contain {n}`);
      records = { title: text(r.title, `${where} records title`), columns: [columns[0]!, columns[1]!], key, values: texts(r.values, `${where} records values`, 2) };
    }
    return {
      id,
      suffixes: texts(sector.suffixes, `${where} suffixes`),
      blurbs: texts(sector.blurbs, `${where} blurbs`),
      tag: text(sector.tag, `${where} tag`),
      files,
      ...(installers.length > 0 ? { installers } : {}),
      ...(records ? { records } : {}),
    };
  };
  const sectors = list(raw.sectors, 'sectors').map(toSector);
  // The second batch of companies: its own stems and trades, and more cities and names to draw on.
  let more: MorePools | undefined;
  if (raw.more !== undefined) {
    const m = obj(raw.more, 'more');
    more = {
      count: number(m.count, 'more count', 0, 200),
      stems: texts(m.stems, 'more stems'),
      cities: m.cities === undefined ? [] : list(m.cities, 'more cities').map((value, i) => toCity(value, cities.length + i)),
      sectors: list(m.sectors, 'more sectors').map((value, i) => toSector(value, sectors.length + i)),
    };
    if (more.count > more.stems.length) fail(`more count is ${more.count} but there are only ${more.stems.length} more stems`);
    const stems = [...texts(raw.stems, 'stems'), ...more.stems];
    if (new Set(stems).size !== stems.length) fail('a stem is used twice');
    const ids = [...sectors, ...more.sectors].map((sector) => sector.id);
    if (new Set(ids).size !== ids.length) fail('a sector id is used twice');
  }
  const jobs = obj(raw.jobs, 'jobs');
  const wording = (key: string): JobWording => {
    const w = obj(jobs[key], `jobs ${key}`);
    return { titles: texts(w.titles, `jobs ${key} titles`), summaries: texts(w.summaries, `jobs ${key} summaries`), briefs: texts(w.briefs, `jobs ${key} briefs`) };
  };
  const pools: CompanyPools = {
    count: number(raw.count, 'count', 0, 200),
    cities,
    first: texts(raw.first, 'first'),
    last: texts(raw.last, 'last'),
    stems: texts(raw.stems, 'stems'),
    logs: texts(raw.logs, 'logs'),
    sectors,
    ...(more ? { more } : {}),
    jobs: {
      clients: texts(jobs.clients, 'jobs clients'),
      steal: wording('steal'),
      destroy: wording('destroy'),
      record: wording('record'),
      ...(jobs.staged === undefined
        ? {}
        : (() => {
            const w = obj(jobs.staged, 'jobs staged');
            const staged: StagedWording = {
              titles: texts(w.titles, 'jobs staged titles'),
              summaries: texts(w.summaries, 'jobs staged summaries'),
              briefs: texts(w.briefs, 'jobs staged briefs'),
              next: texts(w.next, 'jobs staged next'),
              keyNotes: texts(w.keyNotes, 'jobs staged keyNotes'),
              rivals: texts(w.rivals, 'jobs staged rivals'),
            };
            return { staged };
          })()),
      tiers: texts(jobs.tiers, 'jobs tiers', 5),
      ...(jobs.kinds === undefined
        ? {}
        : {
            kinds: Object.fromEntries(
              Object.keys(obj(jobs.kinds, 'jobs kinds')).map((kind) => {
                if (!(NEW_KINDS as readonly string[]).includes(kind)) fail(`jobs kinds: "${kind}" is not one of ${NEW_KINDS.join(', ')}`);
                const w = obj((jobs.kinds as Record<string, unknown>)[kind], `jobs kinds ${kind}`);
                return [kind, { titles: texts(w.titles, `jobs kinds ${kind} titles`), summaries: texts(w.summaries, `jobs kinds ${kind} summaries`), briefs: texts(w.briefs, `jobs kinds ${kind} briefs`) }];
              }),
            ),
          }),
      ...(jobs.racers === undefined ? {} : { racers: texts(jobs.racers, 'jobs racers') }),
      ...(jobs.trades === undefined
        ? {}
        : {
            trades: Object.fromEntries(
              Object.entries(obj(jobs.trades, 'jobs trades')).map(([sector, value]) => {
                if (![...sectors, ...(more?.sectors ?? [])].some((item) => item.id === sector)) fail(`jobs trades: there is no trade "${sector}"`);
                const kinds = obj(value, `jobs trades ${sector}`);
                const wording: Partial<Record<PlainKind, Partial<JobWording>>> = {};
                for (const [kind, lines] of Object.entries(kinds)) {
                  if (!(PLAIN_KINDS as readonly string[]).includes(kind)) fail(`jobs trades ${sector}: "${kind}" is not one of ${PLAIN_KINDS.join(', ')}`);
                  const w = obj(lines, `jobs trades ${sector} ${kind}`);
                  const where = `jobs trades ${sector} ${kind}`;
                  wording[kind as PlainKind] = {
                    ...(w.titles === undefined ? {} : { titles: texts(w.titles, `${where} titles`) }),
                    ...(w.summaries === undefined ? {} : { summaries: texts(w.summaries, `${where} summaries`) }),
                    ...(w.briefs === undefined ? {} : { briefs: texts(w.briefs, `${where} briefs`) }),
                  };
                }
                return [sector, wording];
              }),
            ),
          }),
      ...(jobs.regulars === undefined
        ? {}
        : {
            regulars: list(jobs.regulars, 'jobs regulars').map((value, i): RegularDef => {
              const r = obj(value, `regular ${i}`);
              const id = text(r.id, `regular ${i} id`);
              const where = `regular "${id}"`;
              const own = r.sectors === undefined ? undefined : texts(r.sectors, `${where} sectors`);
              for (const sector of own ?? []) if (![...sectors, ...(more?.sectors ?? [])].some((item) => item.id === sector)) fail(`${where}: there is no trade "${sector}"`);
              return {
                id,
                name: text(r.name, `${where} name`),
                blurb: text(r.blurb, `${where} blurb`),
                minRating: number(r.minRating, `${where} minRating`, 0, 1000),
                ...(own ? { sectors: own } : {}),
                intros: texts(r.intros, `${where} intros`),
                again: texts(r.again, `${where} again`),
                signoff: text(r.signoff, `${where} signoff`),
              };
            }),
          }),
      ...(jobs.side === undefined
        ? {}
        : (() => {
            const side = obj(jobs.side, 'jobs side');
            const part = (key: string) => obj(side[key], `jobs side ${key}`);
            const words = (key: string): JobWording => {
              const w = part(key);
              return { titles: texts(w.titles, `jobs side ${key} titles`), summaries: texts(w.summaries, `jobs side ${key} summaries`), briefs: texts(w.briefs, `jobs side ${key} briefs`) };
            };
            const notes = (value: unknown, where: string, min: number): NoteTemplate[] => {
              const items = list(value, where).map((item, i): NoteTemplate => {
                const n = obj(item, `${where} ${i}`);
                return { name: text(n.name, `${where} ${i} name`), text: text(n.text, `${where} ${i} text`) };
              });
              if (items.length < min) fail(`${where} needs at least ${min}`);
              if (new Set(items.map((item) => item.name)).size !== items.length) fail(`${where}: two notes share a name`);
              return items;
            };
            const borrow = part('borrow');
            const terms = part('terms');
            const wording: SideWording = {
              deliver: { ...words('deliver'), files: texts(part('deliver').files, 'jobs side deliver files') },
              leak: { ...words('leak'), leads: notes(part('leak').leads, 'jobs side leak leads', 1), clears: notes(part('leak').clears, 'jobs side leak clears', 2) },
              wipe: { ...words('wipe'), lines: texts(part('wipe').lines, 'jobs side wipe lines', 2), next: texts(part('wipe').next, 'jobs side wipe next') },
              round: { ...words('round'), next: texts(part('round').next, 'jobs side round next') },
              borrow: {
                ...words('borrow'),
                lists: notes(borrow.lists, 'jobs side borrow lists', 1),
                notes: list(borrow.notes, 'jobs side borrow notes').map((item, i) => {
                  const n = obj(item, `jobs side borrow note ${i}`);
                  return { name: text(n.name, `jobs side borrow note ${i} name`), text: text(n.text, `jobs side borrow note ${i} text`), fact: text(n.fact, `jobs side borrow note ${i} fact`), mention: text(n.mention, `jobs side borrow note ${i} mention`) };
                }),
                asks: list(borrow.asks, 'jobs side borrow asks').map((item, i) => {
                  const a = obj(item, `jobs side borrow ask ${i}`);
                  return { label: text(a.label, `jobs side borrow ask ${i} label`), text: text(a.text, `jobs side borrow ask ${i} text`), reply: text(a.reply, `jobs side borrow ask ${i} reply`) };
                }),
              },
              terms: { quiet: texts(terms.quiet, 'jobs side terms quiet'), fast: texts(terms.fast, 'jobs side terms fast'), light: texts(terms.light, 'jobs side terms light') },
            };
            if (wording.borrow.notes.length < 2) fail('jobs side borrow needs at least 2 notes');
            if (new Set(wording.borrow.notes.map((note) => note.name)).size !== wording.borrow.notes.length) fail('jobs side borrow: two notes share a name');
            return { side: wording };
          })()),
      ...(jobs.heist === undefined
        ? {}
        : (() => {
            const w = obj(jobs.heist, 'jobs heist');
            const notes = obj(w.notes, 'jobs heist notes');
            return {
              heist: {
                titles: texts(w.titles, 'jobs heist titles'),
                summaries: texts(w.summaries, 'jobs heist summaries'),
                briefs: texts(w.briefs, 'jobs heist briefs'),
                notes: { firewall: texts(notes.firewall, 'jobs heist notes firewall'), monitor: texts(notes.monitor, 'jobs heist notes monitor'), proxy: texts(notes.proxy, 'jobs heist notes proxy') },
              },
            };
          })()),
    },
  };
  const regularIds = (pools.jobs.regulars ?? []).map((regular) => regular.id);
  if (new Set(regularIds).size !== regularIds.length) fail('two regulars share an id');
  if (pools.count > pools.stems.length) fail(`count is ${pools.count} but there are only ${pools.stems.length} stems; each company needs its own`);
  return pools;
}
