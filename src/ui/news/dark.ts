/**
 * The darknet's pages as the game stands: the written sites (sites.json)
 * with whatever is happening now added to them (see core/events.ts). The
 * event has a page of its own on one site; that site's front page and the
 * index both link to it.
 */
import type { BlockDef, PageDef, SiteDef } from '../../content';
import { EVENT_PATH, eventPage, owedBy, type Content, type GameState } from '../../core';

const INDEX = 'index.veil';

/** The page at an address on the darknet, or undefined to fall back to the written page. */
export function darkPage(state: GameState, content: Content, sites: readonly SiteDef[], address: string): { site: SiteDef; page: PageDef } | undefined {
  const event = eventPage(state, content);
  const owed = owedBy(state, content);
  if (!event && owed.length === 0) return undefined;
  const slash = address.indexOf('/');
  const host = slash < 0 ? address : address.slice(0, slash);
  const path = slash < 0 ? '/' : address.slice(slash);
  const site = sites.find((item) => item.net === 'dark' && item.address === host);
  if (!site) return undefined;
  if (event && host === event.site && path === EVENT_PATH) {
    return { site, page: { path, title: event.title, blocks: [...event.blocks, { links: [{ text: 'back', to: `${host}/` }] }] } };
  }
  if (path !== '/') return undefined;
  const front = site.pages.find((page) => page.path === '/');
  if (!front) return undefined;
  const extra: BlockDef[] = [];
  if (event && (host === event.site || host === INDEX)) extra.push({ h: 'now' }, { links: [{ text: event.title, to: `${event.site}${EVENT_PATH}` }] });
  if (host === INDEX && owed.length > 0) extra.push({ p: `Owed to you: one favour from ${owed.join(', ')}.` });
  if (extra.length === 0) return undefined;
  // Under the site's own heading and first line, above the rest.
  const head = front.blocks.slice(0, 2);
  return { site, page: { ...front, blocks: [...head, ...extra, ...front.blocks.slice(2)] } };
}
