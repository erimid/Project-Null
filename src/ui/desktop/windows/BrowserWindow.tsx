import { useEffect, useRef, useState } from 'preact/hooks';
import { findPage, sites, type BlockDef, type Net } from '../../../content';
import { useGame } from '../../hooks';
import { formatLongDay } from '../../format';
import { Window } from '../Window';
import type { WindowId } from '../windowStore';

/** What differs between the two browsers. Each only opens pages on its own network. */
const BROWSERS: Readonly<Record<Net, { window: WindowId; home: string; scheme: string }>> = {
  web: { window: 'web', home: 'start.lumen/', scheme: 'net://' },
  dark: { window: 'dark', home: 'index.veil/', scheme: 'veil://' },
};

/**
 * An in-game browser. There is nothing to type: pages are reached by
 * their links, with Back, Forward and Home. It does not load anything
 * from the real internet.
 */
export function BrowserWindow({ net }: { net: Net }) {
  const browser = BROWSERS[net];
  // Pages visited, and which of them is showing.
  const [trail, setTrail] = useState<readonly string[]>([browser.home]);
  const [at, setAt] = useState(0);
  const body = useRef<HTMLDivElement>(null);
  const address = trail[at] ?? browser.home;
  const found = findPage(sites, net, address);
  const today = useGame((game) => formatLongDay(game.clock.gameTimeMs));

  const go = (to: string) => {
    if (to === address) return;
    setTrail([...trail.slice(0, at + 1), to]);
    setAt(at + 1);
  };
  // A new page starts at its top.
  useEffect(() => body.current?.scrollTo(0, 0), [address]);

  return (
    <Window id={browser.window} note={found?.site.name}>
      <div class={`browser browser--${net}`}>
        <div class="browser__bar">
          <button type="button" class="browser__nav" aria-label="Back" disabled={at === 0} onClick={() => setAt(at - 1)}>
            ‹
          </button>
          <button
            type="button"
            class="browser__nav"
            aria-label="Forward"
            disabled={at >= trail.length - 1}
            onClick={() => setAt(at + 1)}
          >
            ›
          </button>
          <button type="button" class="browser__nav" aria-label="Home" onClick={() => go(browser.home)}>
            ⌂
          </button>
          <span class="browser__address data">
            <span class="browser__scheme">{browser.scheme}</span>
            {address.replace(/\/$/, '')}
          </span>
        </div>
        <div class="browser__page" ref={body} key={address}>
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
