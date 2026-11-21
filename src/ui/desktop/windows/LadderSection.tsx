import { addressPrice, findServer, ladderRival, ladderRows, type LadderOutcome } from '../../../core';
import { formatGameTime, formatMoney } from '../../format';
import { content } from '../../session';
import type { View } from './serverView';

/** The board that keeps the ladder. */
export const LADDER_BOARD = 'backroom';

const OUTCOME_WORDS: Readonly<Record<LadderOutcome, string>> = { sold: 'exposed', relay: 'your relay', truce: 'truce' };

/**
 * The rivals ladder: every handle on the Backroom by standing, the
 * player's among them, what happened lately, and a decision for each
 * raider the player has traced back.
 */
export function Ladder({ game, act }: View) {
  const rows = ladderRows(game, content);
  return (
    <div class="ladder">
      {game.ladder.beaten.map((id) => {
        const rival = ladderRival(content, id);
        const raider = content.rivals.find((item) => item.id === id);
        const home = raider && findServer(content, raider.homeId);
        if (!rival) return null;
        return (
          <div key={id} class="ladder__decide">
            <strong>You traced {rival.handle} back to {home?.name ?? 'their rig'}.</strong>
            <p>Their address is yours. What happens to it?</p>
            <div class="ladder__choices">
              <button type="button" class="btn" data-tip="Sell the address on. They lose a lot of standing, slow down and stop coming for you." onClick={() => act({ type: 'settleRival', rivalId: id, outcome: 'sold' })}>
                Sell the address <span class="data">{formatMoney(addressPrice(content, id))}</span>
              </button>
              <button type="button" class="btn" data-tip="Keep their rig as a private relay. It carries only your traffic, so it never warms up. They may still come for you." onClick={() => act({ type: 'settleRival', rivalId: id, outcome: 'relay' })}>
                Keep the rig as a relay
              </button>
              <button type="button" class="btn" data-tip="Call a truce. They stop raiding you and send the odd tip: an address you did not have." onClick={() => act({ type: 'settleRival', rivalId: id, outcome: 'truce' })}>
                Call a truce
              </button>
            </div>
          </div>
        );
      })}
      <ol class="ladder__list">
        {rows.map((row, index) => (
          <li key={row.id ?? 'you'} class={`ladder__row${row.id === null ? ' is-you' : ''}${row.outcome ? ` is-${row.outcome}` : ''}`} data-tip={row.id ? ladderRival(content, row.id)?.blurb : 'You.'}>
            <span class="ladder__place data">{index + 1}</span>
            <span class="ladder__handle">{row.handle}</span>
            {row.outcome && <span class="ladder__outcome">{OUTCOME_WORDS[row.outcome]}</span>}
            <span class="ladder__score data">{row.score}</span>
          </li>
        ))}
      </ol>
      {game.ladder.moves.length > 0 && (
        <>
          <h3 class="map__heading">Lately</h3>
          <ul class="ladder__moves">
            {game.ladder.moves.map((move, index) => (
              <li key={index}>
                <span class="data ladder__when">{formatGameTime(move.timeMs)}</span> {move.text}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
