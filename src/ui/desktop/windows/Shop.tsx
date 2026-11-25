import { CRACKDOWN_PRICES, isShut, rareToday, sellsOnly, shopOf, shutMarket, type GameState } from '../../../core';
import type { ServerDef } from '../../../core/content';
import { formatMoney } from '../../format';
import { content } from '../../session';

/** What a shop asks against the list price, in words. */
function priceWord(factor: number): string {
  const percent = Math.round(Math.abs(factor - 1) * 100);
  return percent === 0 ? 'list price' : `${percent}% ${factor < 1 ? 'under' : 'over'} list`;
}

/** Hours until the day's rare stock turns over. */
export const hoursLeftToday = (game: GameState): number =>
  Math.max(1, Math.ceil((86_400_000 - (game.clock.gameTimeMs % 86_400_000)) / 3_600_000));

/**
 * The sign over a shop's shelf: who they are and how they price. With
 * `rare`, it also names what is in for today only (the Market has a lit
 * shelf for that instead).
 */
export function ShopSign({ game, server, rare: showRare = true }: { game: GameState; server: ServerDef; rare?: boolean }) {
  const shut = isShut(game, server.id);
  // While a crackdown has another market shut, this one charges more.
  const factor = shopOf(server).priceFactor * (shutMarket(game) !== undefined && !shut ? CRACKDOWN_PRICES : 1);
  const rare = rareToday(game, server);
  const hoursLeft = hoursLeftToday(game);
  const nameOf = (line: (typeof rare)[number]) =>
    line.kind === 'program'
      ? content.programs.find((program) => program.id === line.id)?.name
      : line.kind === 'hardware'
        ? content.hardware.find((part) => part.id === line.id)?.name
        : `${content.modules.find((module) => module.id === line.id)?.name ?? line.id}${line.grade ? ` ${line.grade}` : ''}`;
  return (
    <div class={`shopsign shopsign--${server.id}`}>
      <div class="shopsign__top">
        <span class="shopsign__place">
          {server.city} · {sellsOnly(server) ? 'sells only' : 'board and shop'}
        </span>
        <span class={`shopsign__price${factor < 1 ? ' is-cheap' : factor > 1 ? ' is-dear' : ''}`}>{shut ? 'shut' : priceWord(factor)}</span>
      </div>
      <p class="shopsign__blurb">{shut ? 'Shut. This market was raided and its shelf is empty until it reopens. The other sellers are open, at a price.' : server.blurb}</p>
      {showRare && !shut && (
        <p class="shopsign__rare">
          {rare.length > 0 ? (
            <>
              <span class="row__tag row__tag--rare shopsign__tag">today only</span>
              {rare.map(nameOf).filter(Boolean).join(', ')}
              <span class="row__dim"> · gone in {hoursLeft} h</span>
            </>
          ) : (
            <span class="row__dim">Nothing rare on the shelf today. It changes in {hoursLeft} h.</span>
          )}
        </p>
      )}
    </div>
  );
}

/** A shop's price, with the list price struck through beside it when the two differ. */
export function Price({ base, price }: { base: number; price: number }) {
  return (
    <span class="data contract__pay price">
      {price !== base && base > 0 && <s class="price__list">{formatMoney(base)}</s>}
      {price > 0 ? formatMoney(price) : 'free'}
    </span>
  );
}
