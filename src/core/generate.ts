/**
 * The ordinary companies of one game, made from the written pools in
 * content/companies.json. They depend only on the game's seed, so they
 * are not saved: every load makes the same ones again. Their changeable
 * state (files, logs, records) is saved like any other server's.
 */
import type { CompanyPools, SectorDef } from '../content/companies';
import type { FileDef, LogDef, PartDef, ServerDef } from '../content/schema';
import { createRng, type Rng } from './rng';
import type { Content } from './world';

/** Security of a generated company by tier (1 to 5). Never above 3, so bought programs can always beat it. */
const SECURITY_BY_TIER = [
  { password: 1, proxy: 0, firewall: 0, monitor: 0 },
  { password: 1, proxy: 1, firewall: 1, monitor: 1 },
  { password: 2, proxy: 1, firewall: 2, monitor: 1 },
  { password: 2, proxy: 2, firewall: 2, monitor: 2 },
  { password: 3, proxy: 2, firewall: 3, monitor: 2 },
] as const;

/** Fills {placeholders} in a template; unknown ones are left as they are. */
export function fill(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => values[name] ?? whole);
}

const slug = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** One grade better for the better-defended companies, never past the best module grade. */
const bump = (part: PartDef, tier: number): PartDef => (tier >= 4 ? { ...part, grade: Math.min(3, part.grade + 1) } : part);

function makeFiles(rng: Rng, sector: SectorDef, values: Record<string, string>, tier: number): FileDef[] {
  const files: FileDef[] = [];
  for (const template of sector.files) {
    const name = fill(template.name, values);
    if (files.some((file) => file.name === name)) continue;
    files.push({
      name,
      sizeGq: rng.int(template.sizeGb[0], template.sizeGb[1]),
      access: template.access ?? 'admin',
      ...(template.text ? { content: { kind: 'text' as const, text: fill(template.text, values) } } : {}),
      ...(template.folder ? { folder: fill(template.folder, values) } : {}),
    });
  }
  // Module installers and program files come from their own streams, so adding or changing one
  // never moves anything else in the company, or in any other.
  for (const template of sector.installers ?? []) {
    const own = rng.fork(`installer:${values['company']}:${template.name}`);
    if (!own.chance(template.chance) || files.some((file) => file.name === template.name)) continue;
    files.push({
      name: template.name,
      sizeGq: own.int(template.sizeGb[0], template.sizeGb[1]),
      access: 'admin',
      folder: 'bin',
      ...(template.text ? { content: { kind: 'text' as const, text: fill(template.text, values) } } : {}),
      ...(template.part ? { part: bump(template.part, tier) } : {}),
      ...(template.program ? { program: { ...template.program, modules: template.program.modules.map((part) => bump(part, tier)) } } : {}),
    });
  }
  return files;
}

function makeCompany(rng: Rng, pools: CompanyPools, index: number, stem: string, taken: Set<string>): ServerDef {
  const sector = rng.pick(pools.sectors);
  const city = rng.pick(pools.cities);
  // Weaker companies are more common: tiers 1 and 2 make up about half.
  const tier = Math.min(5, 1 + Math.floor(rng.next() * rng.next() * 5 + rng.next() * 1.5));
  const name = `${stem} ${rng.pick(sector.suffixes)}`;
  const person = () => `${rng.pick(pools.first)} ${rng.pick(pools.last)}`;
  const staff = person();
  let staff2 = person();
  if (staff2 === staff) staff2 = `${rng.pick(pools.first)} ${rng.pick(pools.last)}`;
  let address: string;
  do address = `${city.net}.${rng.int(1, 254)}.${rng.int(2, 254)}`;
  while (taken.has(address));
  taken.add(address);
  const ip = () => `${city.net}.${rng.int(1, 254)}.${rng.int(2, 254)}`;
  const values: Record<string, string> = {
    company: name,
    city: city.city,
    staff,
    staff2,
    year: '2034',
    q: String(rng.int(1, 4)),
    n: String(rng.int(100, 999)),
  };
  const logs: LogDef[] = Array.from({ length: rng.int(3, 6) }, () => ({
    minutesAgo: rng.int(30, 4000),
    text: fill(rng.pick(pools.logs), { ...values, ip: ip() }),
  }));
  const records = sector.records && {
    title: sector.records.title,
    columns: [...sector.records.columns],
    rows: Array.from(new Set(Array.from({ length: 6 }, () => fill(sector.records!.key, { n: String(rng.int(1000, 9999)) })))).map((key) => [
      key,
      rng.pick(sector.records!.values),
    ]),
  };
  const initials = stem
    .split(' ')
    .map((word) => word[0])
    .join('')
    .toUpperCase();
  return {
    id: `co-${index + 1}-${slug(stem)}`,
    name,
    kind: 'company',
    owner: name,
    address,
    city: city.city,
    country: city.country,
    lat: city.lat + rng.range(-0.15, 0.15),
    lon: city.lon + rng.range(-0.15, 0.15),
    blurb: rng.pick(sector.blurbs),
    hostname: `${initials}${stem.length > 1 ? stem[1]!.toUpperCase() : ''}-${sector.tag}-${rng.int(1, 9)}`,
    listed: true,
    security: { ...SECURITY_BY_TIER[tier - 1]! },
    traceSecondsPerHop: 22 - Math.round(2.4 * tier),
    relayDelay: Math.round(rng.range(0.8, 1.3) * 10) / 10,
    banner: [name.toUpperCase(), `${city.city} · ${sector.tag} system`, 'Authorised users only. Activity on this system is logged.'],
    accounts: [
      { user: 'guest', role: 'guest', name: 'Public access' },
      { user: 'admin', role: 'admin', name: staff },
    ],
    files: makeFiles(rng, sector, values, tier),
    logs,
    ...(records ? { records } : {}),
    generated: { tier, sector: sector.id },
  };
}

/** The companies for a game with this seed. Addresses already in `taken` are never reused. */
export function generateCompanies(pools: CompanyPools, seed: number, taken: Iterable<string> = []): ServerDef[] {
  if (pools.count === 0 || pools.sectors.length === 0 || pools.cities.length === 0) return [];
  const rng = createRng(seed).fork('companies');
  const used = new Set(taken);
  const stems = rng.shuffle([...pools.stems]).slice(0, pools.count);
  return stems.map((stem, index) => makeCompany(rng, pools, index, stem, used));
}

const worlds = new WeakMap<Content, Map<number, Content>>();

/**
 * The content for one game: the written world plus that game's
 * generated companies. The same seed always gives the same content
 * object, so it is cheap to call often.
 */
export function worldFor(content: Content, seed: number): Content {
  let bySeed = worlds.get(content);
  if (!bySeed) worlds.set(content, (bySeed = new Map()));
  let world = bySeed.get(seed);
  if (!world) {
    const companies = generateCompanies(content.companies, seed, content.servers.map((server) => server.address));
    world = { ...content, servers: [...content.servers, ...companies] };
    bySeed.set(seed, world);
  }
  return world;
}

export const REGIONS = ['Americas', 'Europe', 'Africa & Middle East', 'Asia & Pacific'] as const;
export type Region = (typeof REGIONS)[number];

/** The part of the world a server is in, from where it is on the globe. */
export function regionOf(server: { readonly lat: number; readonly lon: number }): Region {
  if (server.lon < -30) return 'Americas';
  if (server.lon >= 60) return 'Asia & Pacific';
  if (server.lat >= 36 && server.lon < 45) return 'Europe';
  return 'Africa & Middle East';
}
