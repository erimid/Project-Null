/**
 * Written pools that ordinary companies are generated from: cities,
 * staff names, name stems, and one template per line of business with
 * its files, records and log lines. Also the wording of the repeatable
 * jobs posted against those companies. Written in companies.json;
 * checked here when the game starts.
 *
 * Text may use these placeholders, filled in when a company or job is
 * made: {company} {city} {staff} {staff2} {year} {q} {n} {ip}, and in
 * jobs also {file} {key} {value} {column} {records} {tier}.
 */
import { ContentError, ROLES, type Role } from './schema';

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
}

export interface RecordsTemplate {
  readonly title: string;
  /** Two columns: the key, and the value a job can change. */
  readonly columns: readonly [string, string];
  /** How a row's key is written, with {n} for a number. */
  readonly key: string;
  readonly values: readonly string[];
}

export interface SectorDef {
  readonly id: string;
  /** Put after a name stem: "Freight", "Clinic"... */
  readonly suffixes: readonly string[];
  readonly blurbs: readonly string[];
  /** Short tag used in host names, e.g. "DSP". */
  readonly tag: string;
  readonly files: readonly FileTemplate[];
  readonly records?: RecordsTemplate;
}

export interface JobWording {
  readonly titles: readonly string[];
  readonly summaries: readonly string[];
  readonly briefs: readonly string[];
}

export interface JobPools {
  readonly clients: readonly string[];
  readonly steal: JobWording;
  readonly destroy: JobWording;
  readonly record: JobWording;
  /** Words for how strong a company's security is, by tier (1 first). */
  readonly tiers: readonly string[];
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
  readonly jobs: JobPools;
}

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
  const cities = list(raw.cities, 'cities').map((value, i): CityDef => {
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
  });
  const sectors = list(raw.sectors, 'sectors').map((value, i): SectorDef => {
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
      };
    });
    if (!files.some((f) => (f.access ?? 'admin') === 'admin')) fail(`${where} needs at least one admin file for jobs`);
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
      ...(records ? { records } : {}),
    };
  });
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
    jobs: {
      clients: texts(jobs.clients, 'jobs clients'),
      steal: wording('steal'),
      destroy: wording('destroy'),
      record: wording('record'),
      tiers: texts(jobs.tiers, 'jobs tiers', 5),
    },
  };
  if (pools.count > pools.stems.length) fail(`count is ${pools.count} but there are only ${pools.stems.length} stems; each company needs its own`);
  return pools;
}
