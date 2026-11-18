import { useState } from 'preact/hooks';
import { findServer, nextPointRating, pointsEarned, pointsFree, skillRank, unlearnPrice, whyNotLearn, type GameState } from '../../../core';
import type { SkillBranch, SkillDef } from '../../../core/content';
import { formatMoney } from '../../format';
import { useWorld } from '../../hooks';
import { content, session } from '../../session';
import { ConfirmButton } from '../ConfirmButton';
import { Window } from '../Window';

const BRANCHES: readonly (readonly [SkillBranch, string, string])[] = [
  ['intrusion', 'Intrusion', 'Breaking in faster'],
  ['ghost', 'Ghost', 'Staying out of sight'],
  ['engineering', 'Engineering', 'Getting more from your gear'],
];

/** A board the player is logged in to right now, where skills can be unlearned. */
const boardConnection = (game: GameState) =>
  game.connections.find((connection) => connection.user !== null && findServer(content, connection.serverId)?.kind === 'board');

function SkillCard({ game, skill, onRefused }: { game: GameState; skill: SkillDef; onRefused: (reason: string) => void }) {
  const rank = skillRank(game, skill.id);
  const full = rank >= skill.ranks;
  const reason = whyNotLearn(game, content, skill.id);
  const needs = skill.needs ? content.skills.find((other) => other.id === skill.needs) : undefined;
  const locked = needs !== undefined && skillRank(game, needs.id) === 0;
  const learn = () => {
    const result = session.dispatch({ type: 'learnSkill', skillId: skill.id });
    onRefused(result.ok ? '' : result.reason);
  };

  return (
    <li class={`skill${rank > 0 ? ' is-learned' : ''}${full ? ' is-full' : ''}${locked ? ' is-locked' : ''}${reason === null ? ' is-ready' : ''}`}>
      <div class="skill__head">
        <strong class="skill__name">{skill.name}</strong>
        <span class="skill__pips" aria-label={`Rank ${rank} of ${skill.ranks}`}>
          {Array.from({ length: skill.ranks }, (_, index) => (
            <span key={index} class={`skill__pip${index < rank ? ' is-on' : ''}`} />
          ))}
        </span>
      </div>
      <p class="skill__blurb">{skill.blurb}</p>
      <div class="skill__foot">
        <span class="skill__cost">
          {full ? 'Learned' : `${skill.cost} ${skill.cost === 1 ? 'point' : 'points'}`}
          {locked && needs ? <span class="row__dim"> · after {needs.name}</span> : null}
        </span>
        {!full && (
          <button type="button" class="btn btn--go" disabled={reason !== null} title={reason ?? undefined} onClick={learn}>
            {rank > 0 ? 'Next rank' : 'Learn'}
          </button>
        )}
      </div>
    </li>
  );
}

/**
 * The skill tree: three branches, a card per skill, and the points to
 * spend on them. Unlearning happens here too, but only while logged in
 * to the Backroom, which takes the fee.
 */
export function SkillsWindow() {
  const game = useWorld((state) => state);
  const [notice, setNotice] = useState('');
  const free = pointsFree(game, content);
  const earned = pointsEarned(game, content);
  const board = boardConnection(game);
  const price = unlearnPrice(game, content);
  const anything = Object.values(game.player.skills).some((rank) => rank > 0);

  const unlearn = () => {
    if (!board) return;
    const result = session.dispatch({ type: 'unlearnSkills', connectionId: board.id });
    setNotice(result.ok ? 'Forgotten. Your points are back to spend.' : result.reason);
  };

  return (
    <Window id="skills" note={`${free} of ${earned} ${earned === 1 ? 'point' : 'points'} free`}>
      <p class="skills__intro">
        {free > 0 ? (
          <>
            You have <strong class="skills__free data">{free}</strong> {free === 1 ? 'point' : 'points'} to spend.{' '}
          </>
        ) : null}
        Your next point comes at a best rating of <span class="data">{nextPointRating(game, content)}</span>.
      </p>
      <div class="skills">
        {BRANCHES.map(([branch, name, motto]) => (
          <section key={branch} class={`skills__branch skills__branch--${branch}`}>
            <h3 class="map__heading skills__title">
              {name} <span class="heading__note">{motto}</span>
            </h3>
            <ul class="skills__list">
              {content.skills
                .filter((skill) => skill.branch === branch)
                .sort((a, b) => a.row - b.row)
                .map((skill) => (
                  <SkillCard key={skill.id} game={game} skill={skill} onRefused={setNotice} />
                ))}
            </ul>
          </section>
        ))}
      </div>
      <div class="skills__unlearn">
        {board && anything ? (
          <ConfirmButton class="btn btn--danger" confirmLabel={`Pay ${formatMoney(price)}?`} onConfirm={unlearn}>
            Unlearn everything · {formatMoney(price)}
          </ConfirmButton>
        ) : (
          <span class="row__dim">
            {anything ? 'To unlearn your skills, log in to the Backroom. It charges for the favour.' : 'Skills you learn stay learned.'}
          </span>
        )}
      </div>
      {notice && (
        <p class="map__notice" role="status">
          {notice}
        </p>
      )}
    </Window>
  );
}
