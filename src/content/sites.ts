/**
 * The in-game internet: pages for the web browser and the darknet
 * browser. Written in sites.json; checked here when the game starts.
 */
import { ContentError } from './schema';

export const NETS = ['web', 'dark'] as const;
/** web = the ordinary internet; dark = the hidden one. A browser only opens its own. */
export type Net = (typeof NETS)[number];

/** `to` is an address and a path, e.g. "wire.news/port". */
export interface LinkDef {
  readonly text: string;
  readonly to: string;
}

/** One piece of a page, top to bottom. */
export type BlockDef =
  | { readonly h: string }
  | { readonly p: string }
  | { readonly list: readonly string[] }
  | { readonly quote: string; readonly by: string }
  | { readonly links: readonly LinkDef[] };

export interface PageDef {
  /** Starts with "/". The site's front page is "/". */
  readonly path: string;
  readonly title: string;
  readonly blocks: readonly BlockDef[];
}

export interface SiteDef {
  readonly id: string;
  readonly net: Net;
  /** What the address bar shows, e.g. "wire.news". */
  readonly address: string;
  readonly name: string;
  readonly pages: readonly PageDef[];
}

/** The page an address points at, if there is one on that network. */
export function findPage(sites: readonly SiteDef[], net: Net, to: string): { site: SiteDef; page: PageDef } | undefined {
  const slash = to.indexOf('/');
  const address = slash < 0 ? to : to.slice(0, slash);
  const path = slash < 0 ? '/' : to.slice(slash);
  const site = sites.find((item) => item.net === net && item.address === address);
  const page = site?.pages.find((item) => item.path === path);
  return site && page ? { site, page } : undefined;
}

const FILE = 'sites.json';
type Obj = Record<string, unknown>;
const isObj = (value: unknown): value is Obj => typeof value === 'object' && value !== null && !Array.isArray(value);

function words(where: string, value: unknown, key: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new ContentError(FILE, `${where} needs a non-empty text "${key}"`);
  return value;
}

function parseBlock(where: string, value: unknown): BlockDef {
  if (!isObj(value)) throw new ContentError(FILE, `${where} must be an object`);
  if ('h' in value) return { h: words(where, value['h'], 'h') };
  if ('p' in value) return { p: words(where, value['p'], 'p') };
  if ('quote' in value) return { quote: words(where, value['quote'], 'quote'), by: words(where, value['by'], 'by') };
  if (Array.isArray(value['list'])) return { list: value['list'].map((item) => words(where, item, 'list item')) };
  if (Array.isArray(value['links'])) {
    return {
      links: value['links'].map((item) => {
        if (!isObj(item)) throw new ContentError(FILE, `${where}: a link must be an object`);
        return { text: words(where, item['text'], 'text'), to: words(where, item['to'], 'to') };
      }),
    };
  }
  throw new ContentError(FILE, `${where} must be one of h, p, list, quote, links`);
}

export function parseSites(data: unknown): SiteDef[] {
  if (!Array.isArray(data)) throw new ContentError(FILE, 'must be a list of sites');
  const sites = data.map((value, index): SiteDef => {
    if (!isObj(value)) throw new ContentError(FILE, `entry ${index} must be an object`);
    const id = words(`entry ${index}`, value['id'], 'id');
    const where = `site "${id}"`;
    const net = value['net'];
    if (!(NETS as readonly unknown[]).includes(net)) throw new ContentError(FILE, `${where}: net must be one of ${NETS.join(', ')}`);
    if (!Array.isArray(value['pages']) || value['pages'].length === 0) throw new ContentError(FILE, `${where} needs at least one page`);
    const pages = value['pages'].map((raw, i): PageDef => {
      if (!isObj(raw) || !Array.isArray(raw['blocks'])) throw new ContentError(FILE, `${where} page ${i} needs a list "blocks"`);
      const path = words(`${where} page ${i}`, raw['path'], 'path');
      if (!path.startsWith('/')) throw new ContentError(FILE, `${where} page ${i}: path must start with "/"`);
      return {
        path,
        title: words(`${where} page ${path}`, raw['title'], 'title'),
        blocks: raw['blocks'].map((block, b) => parseBlock(`${where} page ${path} block ${b}`, block)),
      };
    });
    if (!pages.some((page) => page.path === '/')) throw new ContentError(FILE, `${where} needs a front page with path "/"`);
    return { id, net: net as Net, address: words(where, value['address'], 'address'), name: words(where, value['name'], 'name'), pages };
  });

  const addresses = sites.map((site) => `${site.net}:${site.address}`);
  if (new Set(addresses).size !== addresses.length) throw new ContentError(FILE, 'two sites share an address');
  // Every link must lead somewhere, on the same network as the page it is on.
  for (const site of sites) {
    for (const page of site.pages) {
      for (const block of page.blocks) {
        if (!('links' in block)) continue;
        for (const link of block.links) {
          if (!findPage(sites, site.net, link.to)) {
            throw new ContentError(FILE, `site "${site.id}" page ${page.path}: link "${link.to}" leads nowhere`);
          }
        }
      }
    }
  }
  return sites;
}
