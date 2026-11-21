/**
 * The Continental Wire's pages, built from the editions the game has
 * printed (see core/news.ts). The written feature stories in sites.json
 * stay as they are and are linked from the front page.
 */
import type { BlockDef, LinkDef, PageDef, SiteDef } from '../../content';
import { editionTimeMs, type Edition, type GameState } from '../../core';
import { formatLongDay } from '../format';

export const WIRE = 'wire.news';

const paragraphs = (body: string): BlockDef[] => body.split(/\n\s*\n/).map((p) => ({ p: p.trim() }));
const back: LinkDef = { text: 'Back to the front page', to: `${WIRE}/` };

/** The written links on the site's own front page: the features that are not from an edition. */
function features(site: SiteDef | undefined): LinkDef[] {
  const front = site?.pages.find((page) => page.path === '/');
  return front?.blocks.flatMap((block) => ('links' in block ? [...block.links] : [])) ?? [];
}

function editionBlocks(edition: Edition, site: SiteDef | undefined, latest: boolean, older: readonly Edition[]): BlockDef[] {
  const date = formatLongDay(editionTimeMs(edition.day));
  const yours = edition.items.filter((item) => item.kind === 'you');
  const rest = edition.items.filter((item) => item.kind !== 'you');
  const link = (id: string, headline: string): LinkDef => ({ text: headline, to: `${WIRE}/story/${id}` });
  const blocks: BlockDef[] = [{ h: 'The Continental Wire' }, { p: `${date} · Morning edition` }];
  if (edition.items.length === 0) blocks.push({ p: 'A quiet night. Nothing to report.' });
  // The stories about breaches lead, the way a paper would run them.
  if (yours.length + rest.length > 0) blocks.push({ links: [...yours, ...rest].map((item) => link(item.id, item.headline)) });
  if (latest) {
    const written = features(site);
    if (written.length > 0) blocks.push({ h: 'Features' }, { links: written });
  }
  if (edition.weather) blocks.push({ p: `Weather: ${edition.weather}` });
  const others = older.filter((other) => other.day !== edition.day);
  if (others.length > 0) {
    blocks.push({ h: 'Earlier editions' }, { links: [...others].reverse().map((other) => ({ text: formatLongDay(editionTimeMs(other.day)), to: `${WIRE}/day/${other.day}` })) });
  }
  if (!latest) blocks.push({ links: [back] });
  return blocks;
}

/**
 * The page at an address on the Wire, as the game stands, or undefined to
 * fall back to the written pages (the features).
 */
export function wirePage(state: GameState, site: SiteDef | undefined, address: string): PageDef | undefined {
  if (address !== WIRE && !address.startsWith(`${WIRE}/`)) return undefined;
  const path = address.slice(WIRE.length) || '/';
  const editions = state.news.editions;
  const latest = editions[editions.length - 1];
  if (path === '/' && latest) return { path, title: 'The Continental Wire', blocks: editionBlocks(latest, site, true, editions) };
  const day = /^\/day\/(\d+)$/.exec(path);
  if (day) {
    const edition = editions.find((item) => item.day === Number(day[1]));
    return edition ? { path, title: 'The Continental Wire', blocks: editionBlocks(edition, site, edition === latest, editions) } : { path, title: 'Not found', blocks: [{ p: 'That edition has gone from the archive.' }, { links: [back] }] };
  }
  const story = /^\/story\/(\w+)$/.exec(path);
  if (story) {
    const edition = editions.find((item) => item.items.some((entry) => entry.id === story[1]));
    const item = edition?.items.find((entry) => entry.id === story[1]);
    if (!edition || !item) return { path, title: 'Not found', blocks: [{ p: 'That story has gone from the archive.' }, { links: [back] }] };
    const tag = item.kind === 'story' ? 'In brief' : item.jobId ? 'News · there is work in this' : 'News';
    return {
      path,
      title: item.headline,
      blocks: [{ h: item.headline }, { p: `${formatLongDay(editionTimeMs(edition.day))} · ${tag}` }, ...paragraphs(item.body), { links: [back] }],
    };
  }
  return undefined;
}
