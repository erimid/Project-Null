import { useEffect, useRef, useState } from 'preact/hooks';
import { HARDWARE_SLOT_LABELS, assetPrice, findPart, freeStorageGb, rackStorageGb, rareToday, sellsHardware, shopFor, shopPrice } from '../../../core';
import type { AssetDef, HardwareDef, HardwareSlot } from '../../../core/content';
import { content } from '../../session';
import { GatewayBoard, SLOT_BLURBS, partStats, slotLabel, type SlotMark } from '../GatewayBoard';
import { IconTile, Pips, StatBar } from '../Gear';
import { Icon, slotIcon, type IconName } from '../Icon';
import { uiSound } from '../../sfx';
import type { View } from './serverView';
import { Price, ShopSign } from './Shop';

/** One part on the counter, measured against what is fitted now. */
function PartCard({ part, fitted, scale, rare, view, onFitted }: { part: HardwareDef; fitted: HardwareDef | undefined; scale: number[]; rare: boolean; view: View; onFitted: () => void }) {
  const { game, server, connection, act } = view;
  const price = shopPrice(shopFor(game, content, server), part.price);
  const extraGb = part.slot === 'rack' ? (part.sizeGb ?? 0) - rackStorageGb(game, content) : 0;
  const tooBig = extraGb > freeStorageGb(game, content);
  const poor = game.player.balance < price;
  const now = partStats(part.slot, fitted);
  const tiers = content.hardware.filter((item) => item.slot === part.slot).length;
  return (
    <li class={`card card--part${rare ? ' is-rare' : ''}`}>
      <div class="card__head">
        <IconTile icon={slotIcon(part.slot)} tone={rare ? 'rare' : undefined} />
        <div class="card__title">
          <strong>{part.name}</strong>
          <span class="card__sub">
            <span class="card__version">
              <span class="data">tier {part.tier}</span>
              <Pips on={part.tier} of={tiers} label={`tier ${part.tier} of ${tiers}`} />
            </span>
          </span>
        </div>
        {rare && <span class="row__tag row__tag--rare card__tag">today only</span>}
      </div>
      <p class="card__blurb">{part.blurb}</p>
      <div class="card__stats card__stats--wide">
        {partStats(part.slot, part).map((stat, index) => {
          const mine = now[index]?.value ?? 0;
          const most = scale[index] || 1;
          const better = stat.lowerIsBetter ? stat.value < mine : stat.value > mine;
          const same = stat.value === mine;
          return (
            <StatBar
              key={stat.label}
              label={stat.label}
              share={stat.value / most}
              mine={fitted ? mine / most : undefined}
              value={stat.text}
              tone={same ? undefined : better ? 'better' : 'worse'}
              tip={fitted ? `Fitted now: ${now[index]?.text}` : 'Nothing fitted in this slot yet'}
            />
          );
        })}
      </div>
      <div class="card__foot">
        <Price base={part.price} price={price} />
        <button
          type="button"
          class="btn btn--go card__buy"
          disabled={poor || tooBig}
          title={tooBig ? 'Not enough room on your gateway for the model' : poor ? 'You cannot afford this yet' : undefined}
          data-tip="Pay and fit it straight away. It replaces what is in the slot."
          onClick={() => {
            if (act({ type: 'buyHardware', connectionId: connection.id, partId: part.id })) {
              uiSound('fitted');
              onFitted();
            }
          }}
        >
          Install
        </button>
      </div>
    </li>
  );
}

const ASSET_ICONS: Readonly<Record<AssetDef['effect'], IconName>> = { relay: 'route', safeHouse: 'shield', secondGateway: 'twin' };

/** One property on the broker's list: bought once, kept for good. */
function AssetCard({ asset, view }: { asset: AssetDef; view: View }) {
  const { game, server, connection, act } = view;
  const owned = game.player.assets.includes(asset.id);
  const price = assetPrice(game, content, server.id, asset.id);
  const locked = game.player.rating < asset.minRating;
  const poor = game.player.balance < price;
  return (
    <li class={`card card--asset${owned ? ' is-owned' : ''}${locked && !owned ? ' is-locked' : ''}`}>
      <div class="card__head">
        <IconTile icon={ASSET_ICONS[asset.effect]!} tone={owned ? 'good' : 'rare'} />
        <div class="card__title">
          <strong>{asset.name}</strong>
          <span class="card__sub">
            <Icon name="pin" size={13} /> {asset.where}
          </span>
        </div>
        {locked && !owned && (
          <span class="row__tag card__tag" data-tip="The broker sells to names they know. Your rating has to reach this first.">
            rating <span class="data">{asset.minRating}</span>+
          </span>
        )}
      </div>
      <p class="card__blurb">{asset.blurb}</p>
      <div class="card__foot">
        {owned ? (
          <span class="card__owned">
            <Icon name="check" size={15} /> Yours
          </span>
        ) : (
          <>
            <Price base={asset.price} price={price} />
            <button
              type="button"
              class="btn btn--go card__buy"
              disabled={locked || poor}
              title={locked ? `Needs a rating of ${asset.minRating}` : poor ? 'You cannot afford this yet' : undefined}
              data-tip="Pay once. It is yours from then on."
              onClick={() => {
                if (act({ type: 'buyAsset', connectionId: connection.id, assetId: asset.id })) uiSound('fitted');
              }}
            >
              Buy
            </button>
          </>
        )}
      </div>
    </li>
  );
}

/** The broker's list, under the parts: shown once the first of it is within reach, or anything on it is owned. */
function Property({ view }: { view: View }) {
  const assets = content.assets ?? [];
  const { game } = view;
  const first = Math.min(...assets.map((asset) => asset.minRating));
  if (assets.length === 0 || (game.player.rating < first && game.player.assets.length === 0)) return null;
  return (
    <section class="property" aria-label="Property">
      <h3 class="map__heading">Property</h3>
      <p class="slotpanel__note">
        <Icon name="person" size={15} /> Placed by Ilse Maran, under names that are not yours. Each is bought once and kept.
      </p>
      <ul class="cards">
        {assets.map((asset) => (
          <AssetCard key={asset.id} asset={asset} view={view} />
        ))}
      </ul>
    </section>
  );
}

/**
 * The Hardware counter: your gateway drawn as a board. Click a slot to
 * see what is fitted and the parts this shop has for it, each measured
 * against yours. Parts install as soon as they are paid for.
 */
export function Hardware(view: View) {
  const { game, server } = view;
  const shop = shopFor(game, content, server);
  const rareIds = new Set(rareToday(game, server).filter((line) => line.kind === 'hardware').map((line) => line.id));
  const upgradesFor = (slot: HardwareSlot) =>
    content.hardware
      .filter((part) => part.slot === slot && part.tier > game.player.hardware[slot] && sellsHardware(game, server, part))
      .sort((a, b) => a.tier - b.tier);
  const slots = HARDWARE_SLOT_LABELS.map(([slot]) => slot);
  const stocked = slots.filter((slot) => upgradesFor(slot).length > 0);
  const [picked, setPicked] = useState<HardwareSlot | null>(null);
  const [fresh, setFresh] = useState<HardwareSlot | null>(null);
  const slot = picked ?? stocked[0] ?? 'cpu';
  // Picking a slot brings its parts into view: on a phone the board fills the screen.
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    const body = panel.current?.closest('.window__body');
    if (!picked || !panel.current || !body) return;
    // Only when the parts would otherwise start off screen.
    if (panel.current.getBoundingClientRect().top > body.getBoundingClientRect().bottom - 120) panel.current.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [picked]);

  const marks: Partial<Record<HardwareSlot, SlotMark>> = {};
  for (const id of slots) {
    const upgrades = upgradesFor(id);
    const top = !content.hardware.some((part) => part.slot === id && part.tier > game.player.hardware[id]);
    if (upgrades.some((part) => rareIds.has(part.id))) marks[id] = { text: 'today only', tone: 'rare' };
    else if (upgrades.length > 0) {
      const affordable = upgrades.some((part) => game.player.balance >= shopPrice(shop, part.price));
      marks[id] = { text: `${upgrades.length} in stock`, tone: affordable ? 'good' : undefined };
    } else marks[id] = { text: top ? 'top tier' : 'none here', tone: 'dim' };
  }

  const fitted = findPart(content, slot, game.player.hardware[slot]);
  const upgrades = upgradesFor(slot);
  const top = !content.hardware.some((part) => part.slot === slot && part.tier > game.player.hardware[slot]);
  // Bars are drawn against the best of what is on show, so a step up is easy to see.
  const scale = partStats(slot, fitted).map((stat, index) => Math.max(stat.value, ...upgrades.map((part) => partStats(slot, part)[index]?.value ?? 0)));
  const now = partStats(slot, fitted);

  return (
    <div class="hardware">
      <ShopSign game={game} server={server} rare={false} />
      <GatewayBoard
        hardware={game.player.hardware}
        selected={slot}
        onSelect={(next) => {
          setPicked(next);
          setFresh(null);
        }}
        marks={marks}
        fresh={fresh}
      />
      <section class="slotpanel" key={slot} ref={panel} aria-label={slotLabel(slot)}>
        <div class="slotpanel__head">
          <IconTile icon={slotIcon(slot)} tone={fitted ? 'good' : 'empty'} />
          <div class="slotpanel__title">
            <span class="slotpanel__slot">{slotLabel(slot)}</span>
            <strong>{fitted?.name ?? 'Nothing fitted'}</strong>
            <span class="slotpanel__blurb">{SLOT_BLURBS[slot]}</span>
          </div>
          <dl class="slotpanel__now">
            {now.map((stat) => (
              <div key={stat.label}>
                <dt>{stat.label}</dt>
                <dd class="data">{stat.text}</dd>
              </div>
            ))}
          </dl>
        </div>
        {upgrades.length === 0 ? (
          <p class="empty">
            {top
              ? 'This is the best there is. Nothing to add.'
              : stocked.length > 0
                ? `${server.name} has nothing better for this slot. Other shops carry other parts.`
                : `${server.name} has nothing better for your gateway today.`}
          </p>
        ) : (
          <>
            <p class="slotpanel__note">
              <Icon name="tools" size={15} /> Parts install the moment you pay. Nothing is bought back.
            </p>
            <ul class="cards">
              {upgrades.map((part) => (
                <PartCard key={part.id} part={part} fitted={fitted} scale={scale} rare={rareIds.has(part.id)} view={view} onFitted={() => setFresh(slot)} />
              ))}
            </ul>
          </>
        )}
      </section>
      <Property view={view} />
    </div>
  );
}
