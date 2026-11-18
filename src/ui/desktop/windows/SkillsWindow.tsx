import { useEffect, useRef, useState } from 'preact/hooks';
import { findServer, nextPointRating, pointsEarned, pointsFree, skillRank, unlearnPrice, whyNotLearn, type GameState } from '../../../core';
import { tuning } from '../../../content';
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

/** A small drawing for each branch: a bolt, an eye, a nut. */
function BranchMark({ branch }: { branch: SkillBranch }) {
  return (
    <svg class="skills__mark" viewBox="0 0 24 24" aria-hidden="true">
      {branch === 'intrusion' ? (
        <path d="M13.5 2 5 13.5h5.5L9.5 22 19 10h-5.5z" />
      ) : branch === 'ghost' ? (
        <>
          <path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z" />
          <circle cx="12" cy="12" r="2.6" />
        </>
      ) : (
        <>
          <path d="M12 2.5 20.2 7.2v9.6L12 21.5l-8.2-4.7V7.2z" />
          <circle cx="12" cy="12" r="3.2" />
        </>
      )}
    </svg>
  );
}

function SkillCard({ game, skill, onRefused }: { game: GameState; skill: SkillDef; onRefused: (reason: string) => void }) {
  const rank = skillRank(game, skill.id);
  // A rank learned while the window is open lights the card up once.
  const seen = useRef(rank);
  const fresh = rank > seen.current;
  useEffect(() => {
    const timer = setTimeout(() => (seen.current = rank), 1000);
    return () => clearTimeout(timer);
  }, [rank]);
  const full = rank >= skill.ranks;
  const reason = whyNotLearn(game, content, skill.id);
  const needs = skill.needs ? content.skills.find((other) => other.id === skill.needs) : undefined;
  const locked = needs !== undefined && skillRank(game, needs.id) === 0;
  const learn = () => {
    const result = session.dispatch({ type: 'learnSkill', skillId: skill.id });
    onRefused(result.ok ? '' : result.reason);
  };

  return (
    <li
      class={`skill skill--row${skill.row}${rank > 0 ? ' is-learned' : ''}${full ? ' is-full' : ''}${locked ? ' is-locked' : ''}${reason === null ? ' is-ready' : ''}${fresh ? ' is-fresh' : ''}`}
    >
      <span class="skill__node" aria-hidden="true" />
      <div class="skill__head">
        <strong class="skill__name">{skill.name}</strong>
        <span class="skill__pips" aria-label={`Rank ${rank} of ${skill.ranks}`}>
          {Array.from({ length: skill.ranks }, (_, index) => (
            <span key={`${index}${index < rank ? 'on' : ''}`} class={`skill__pip${index < rank ? ' is-on' : ''}${fresh && index === rank - 1 ? ' is-new' : ''}`} />
          ))}
        </span>
      </div>
      <p class="skill__blurb">{skill.blurb}</p>
      <div class="skill__foot">
        <span class="skill__cost">
          {full ? (
            <span class="skill__done">Learned</span>
          ) : (
            <>
              <span class="skill__price" aria-hidden="true">
                {Array.from({ length: skill.cost }, (_, index) => (
                  <i key={index} />
                ))}
              </span>
              {skill.cost} {skill.cost === 1 ? 'point' : 'points'}
            </>
          )}
          {locked && needs ? <span class="skill__after">After {needs.name}</span> : null}
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
  const next = nextPointRating(game, content);
  const step = tuning.skillPointRating;

  const unlearn = () => {
    if (!board) return;
    const result = session.dispatch({ type: 'unlearnSkills', connectionId: board.id });
    setNotice(result.ok ? 'Forgotten. Your points are back to spend.' : result.reason);
  };

  return (
    <Window id="skills" note={`${free} of ${earned} ${earned === 1 ? 'point' : 'points'} free`}>
      <div class={`skills__bank${free > 0 ? ' has-free' : ''}`}>
        <div class="skills__count">
          <strong key={free} class="skills__free data">
            {free}
          </strong>
          <span>{free === 1 ? 'point to spend' : 'points to spend'}</span>
        </div>
        <div class="skills__points" aria-label={`${earned - free} spent, ${free} free`}>
          {Array.from({ length: earned }, (_, index) => (
            <span key={index} class={`skills__point${index < earned - free ? ' is-spent' : ' is-free'}`} />
          ))}
          {earned === 0 && <span class="skills__none">No points yet</span>}
        </div>
        <div class="skills__next">
          <span>
            Next point at a best rating of <span class="data">{next}</span>
          </span>
          <span class="skills__meter" aria-hidden="true">
            {Array.from({ length: step }, (_, index) => (
              <i key={index} class={index < step - (next - game.player.bestRating) ? 'is-on' : ''} />
            ))}
          </span>
        </div>
      </div>
      <div class="skills">
        {BRANCHES.map(([branch, name, motto]) => (
          <section key={branch} class={`skills__branch skills__branch--${branch}`}>
            <h3 class="skills__title">
              <BranchMark branch={branch} />
              <span class="skills__name">{name}</span>
              <span class="skills__motto">{motto}</span>
              <span class="skills__spent data" title="Points spent in this branch">
                {content.skills.filter((skill) => skill.branch === branch).reduce((sum, skill) => sum + skill.cost * skillRank(game, skill.id), 0)}
              </span>
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
