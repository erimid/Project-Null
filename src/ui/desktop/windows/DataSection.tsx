import { CLIENT_FILE, findServer, priceBoard, quote } from '../../../core';
import { formatMoney } from '../../format';
import { content } from '../../session';
import { ConfirmButton } from '../ConfirmButton';
import { Icon } from '../Icon';
import type { View } from './serverView';

export { DATA_BOARD } from '../../../core';

/**
 * Lowtide's data desk: today's prices by kind of file, and what it would
 * pay for each file on the gateway. Selling the file a client is waiting
 * for pays double and loses the job.
 */
export function DataDesk({ game, connection, act }: View) {
  const board = priceBoard(game, content);
  const files = game.player.files.filter((file) => file.from !== CLIENT_FILE);
  return (
    <div class="datadesk">
      <h3 class="map__heading">Today's prices</h3>
      <ul class="datadesk__prices">
        {board.map(({ kind, today, yesterday }) => {
          const trend = today > yesterday + 0.02 ? 'up' : today < yesterday - 0.02 ? 'down' : 'flat';
          return (
            <li key={kind.id} class={`datadesk__kind is-${trend}`} data-tip={kind.blurb}>
              <span class="datadesk__kind-name">{kind.name}</span>
              <span class="data datadesk__swing">
                ×{today.toFixed(2)} <span aria-label={trend === 'up' ? 'up since yesterday' : trend === 'down' ? 'down since yesterday' : 'about the same as yesterday'}>{trend === 'up' ? '▲' : trend === 'down' ? '▼' : '·'}</span>
              </span>
            </li>
          );
        })}
      </ul>
      <p class="row__dim">Fresh data sells best. A file loses half its value in about four days, and half again if its owner turns up in the Wire.</p>

      <h3 class="map__heading">Sell from your gateway</h3>
      {files.length === 0 && <p class="empty">Nothing on your gateway that Lowtide would buy.</p>}
      <ul class="rows datadesk__files">
        {files.map((file) => {
          const offer = quote(game, content, file);
          const source = findServer(content, file.from);
          const sell = () => act({ type: 'sellData', connectionId: connection.id, name: file.name, from: file.from });
          return (
            <li key={`${file.from}:${file.name}`} class="datadesk__file">
              <span class="datadesk__what">
                <span class="data">{file.name}</span>
                <span class="row__dim">
                  {source?.name ?? file.from} · {file.sizeGq} GB
                  {typeof offer !== 'string' && (
                    <>
                      {' '}· {offer.kind.name.toLowerCase()} · {offer.heldDays === 0 ? 'taken today' : `held ${offer.heldDays} ${offer.heldDays === 1 ? 'day' : 'days'}`}
                    </>
                  )}
                </span>
                {typeof offer !== 'string' && offer.inNews && <span class="row__tag row__tag--warn">owner in the news</span>}
                {typeof offer !== 'string' && file.encrypted ? <span class="row__tag">encrypted, half price</span> : null}
              </span>
              {typeof offer === 'string' ? (
                <span class="row__dim datadesk__no">{offer}</span>
              ) : offer.betrays ? (
                <ConfirmButton
                  class="btn btn--danger"
                  confirmLabel={`Sell out ${offer.betrays.client}?`}
                  tip={`${offer.betrays.client} is waiting for this file. Lowtide pays double, but the job is lost and they will remember.`}
                  onConfirm={sell}
                >
                  <Icon name="coin" size={14} /> {formatMoney(offer.price)}
                </ConfirmButton>
              ) : (
                <button type="button" class="btn btn--go" data-tip="Sell it. The file leaves your gateway." onClick={sell}>
                  <Icon name="coin" size={14} /> {formatMoney(offer.price)}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
