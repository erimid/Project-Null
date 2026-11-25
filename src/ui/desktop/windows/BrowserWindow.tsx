import { useEffect, useRef, useState } from 'preact/hooks';
import { findPage, sites, type BlockDef, type Net } from '../../../content';
import { useGame, useWorld } from '../../hooks';
import { latestEdition } from '../../../core';
import { WIRE, wirePage } from '../../news/wire';
import { darkPage } from '../../news/dark';
import { content, session } from '../../session';
import { formatLongDay } from '../../format';
import { Window } from '../Window';
import { browserStore } from '../browserStore';

/** The two networks the browser reaches. Each has its own home page, and pages only link within their own network. */
const NETS: Readonly<Record<Net, { name: string; tip: string; home: string; scheme: string }>> = {
  web: { name: 'Lumen', tip: 'The public web: news, company sites and the Open Relay Registry', home: 'start.lumen/', scheme: 'net://' },
  dark: { name: 'Undertow', tip: 'The hidden network: rumours, tools and people who do not want to be found', home: 'index.veil/', scheme: 'veil://' },
};
const NET_IDS: readonly Net[] = ['web', 'dark'];

/** Pages visited on one network, and which of them is showing. */
interface Trail {
  readonly pages: readonly string[];
  readonly at: number;
}

/**
 * The in-game browser: one window for both networks, picked by the tabs
 * under its title. Each network keeps its own place and its own Back and
 * Forward. There is nothing to type: pages are reached by their links.
 * It does not load anything from the real internet.
 */
export function BrowserWindow() {
  const [net, setNet] = useState<Net>('web');
  const [trails, setTrails] = useState<Readonly<Record<Net, Trail>>>({
    web: { pages: [NETS.web.home], at: 0 },
    dark: { pages: [NETS.dark.home], at: 0 },
  });
  const browser = NETS[net];
  const { pages, at } = trails[net];
  const body = useRef<HTMLDivElement>(null);
  const address = pages[at] ?? browser.home;
  const today = useGame((game) => formatLongDay(game.clock.gameTimeMs));
  // The Wire is printed from the game each morning; a new edition re-draws it.
  useGame((game) => latestEdition(game)?.day ?? -1);
  const wire = useWorld((game) => (net === 'web' ? wirePage(game, sites.find((site) => site.net === 'web' && site.address === WIRE), address) : undefined));
  // The darknet's pages carry whatever is happening there now.
  const dark = useWorld((game) => (net === 'dark' ? darkPage(game, content, sites, address) : undefined));
  const found = wire ? { site: sites.find((site) => site.address === WIRE)!, page: wire } : (dark ?? findPage(sites, net, address));

  const setAt = (next: number) => setTrails({ ...trails, [net]: { pages, at: next } });
  const go = (to: string) => {
    if (to === address) return;
    setTrails({ ...trails, [net]: { pages: [...pages.slice(0, at + 1), to], at: at + 1 } });
  };
  // Another window can ask for a page: the route map opens a Wire story this way.
  useEffect(() => {
    const take = () => {
      const asked = browserStore.take();
      if (!asked) return;
      setNet('web');
      setTrails((current) => {
        const web = current.web;
        if (web.pages[web.at] === asked) return current;
        return { ...current, web: { pages: [...web.pages.slice(0, web.at + 1), asked], at: web.at + 1 } };
      });
    };
    take();
    return browserStore.subscribe(take);
  }, []);
  // A new page starts at its top.
  useEffect(() => body.current?.scrollTo(0, 0), [net, address]);

  return (
    <Window
      id="web"
      note={found?.site.name}
      tabs={NET_IDS.map((id) => (
        <button key={id} type="button" class={`tabbtn tabbtn--${id}${id === net ? ' is-current' : ''}`} aria-pressed={id === net} data-tip={NETS[id].tip} onClick={() => setNet(id)}>
          {NETS[id].name}
        </button>
      ))}
    >
      <div class={`browser browser--${net}`}>
        <div class="browser__bar">
          <button type="button" class="browser__nav" aria-label="Back" disabled={at === 0} onClick={() => setAt(at - 1)}>
            ‹
          </button>
          <button type="button" class="browser__nav" aria-label="Forward" disabled={at >= pages.length - 1} onClick={() => setAt(at + 1)}>
            ›
          </button>
          <button type="button" class="browser__nav" aria-label="Home" data-tip={`${browser.name}'s home page`} onClick={() => go(browser.home)}>
            ⌂
          </button>
          <span class="browser__address data">
            <span class="browser__scheme">{browser.scheme}</span>
            {address.replace(/\/$/, '')}
          </span>
        </div>
        <div class="browser__page" ref={body} key={`${net}:${address}`}>
          {found ? (
            found.page.blocks.map((block, index) => <Block key={index} block={block} go={go} today={today} />)
          ) : (
            <p class="empty">Nothing answers at this address.</p>
          )}
        </div>
      </div>
    </Window>
  );
}

function Block({ block, go, today }: { block: BlockDef; go: (to: string) => void; today: string }) {
  if ('h' in block) return <h2 class="page__heading">{block.h}</h2>;
  if ('p' in block) return <p class="page__text">{block.p.replace('{date}', today)}</p>;
  if ('quote' in block) {
    return (
      <blockquote class="page__quote">
        <span class="page__by">{block.by}</span>
        {block.quote}
      </blockquote>
    );
  }
  if ('list' in block) {
    return (
      <ul class="page__list">
        {block.list.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    );
  }
  if ('button' in block) {
    const { text, does, off } = block.button;
    const action = does === 'bid' ? ({ type: 'eventBid' } as const) : does === 'buy' ? ({ type: 'eventBuy' } as const) : ({ type: 'eventReport' } as const);
    return (
      <p class="page__text">
        <button type="button" class="btn" disabled={off !== undefined} data-tip={off} onClick={() => session.dispatch(action)}>
          {text}
        </button>
      </p>
    );
  }
  return (
    <ul class="page__links">
      {block.links.map((link) => (
        <li key={link.to}>
          <button type="button" class="page__link" onClick={() => go(link.to)}>
            {link.text}
          </button>
        </li>
      ))}
    </ul>
  );
}
