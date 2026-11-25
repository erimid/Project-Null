import { useEffect, useRef, useState } from 'preact/hooks';
import { GUIDED_JOB, TERMS_NAMES, TWISTS, roundTotal, termsLine, activeContract, availableContracts, contractRisk, findModule, isJob, isLyingLow, nextContractRating, openPatron, storyWaits, standingName, standingWith, stagesOf } from '../../../core';
import { findServer, type ContractDef } from '../../../core/content';
import { formatGameTime, formatMoney, formatRating } from '../../format';
import { useGame } from '../../hooks';
import { content } from '../../session';
import { IconTile, ModulePlate } from '../Gear';
import { Icon, objectiveIcon, type IconName } from '../Icon';
import { useGuide } from '../guide';
import { deskStore, useDesk } from '../deskStore';
import { globeSeen } from '../../globe/seen';
import { OBJECTIVE_WORDS, Place, RiskMeter } from './Place';
import { HeistPlan } from './HeistPlan';
import type { View } from './serverView';

type Filter = 'all' | 'story' | 'staged' | 'standing';
type Sort = 'board' | 'pay' | 'risk' | 'rating';

/** The filter and order last used, so the board looks the same on the next visit. */
let kept: { filter: Filter; sort: Sort; flipped: boolean } = { filter: 'all', sort: 'board', flipped: false };

const isStaged = (contract: ContractDef) => stagesOf(contract).length > 1;

/** The standing the player has with the patron who posted a job, if a named one did. */
function PatronChip({ contract }: { contract: ContractDef }) {
  const patron = openPatron(content, contract);
  const standing = useGame((game) => (patron ? standingWith(game, patron.id) : 0));
  if (!patron) return null;
  return (
    <span class={`jobcard__patron is-${standingName(standing).toLowerCase().replace(' ', '-')}`} data-tip={`${patron.title}. Your standing with them: ${standingName(standing)}. See Gateway › Contacts.`}>
      {standingName(standing)}
    </span>
  );
}

/** One job on the board: what kind it is, where, what it pays and how dangerous it looks. */
function JobCard({ contract, risk, blocked, onAccept }: { contract: ContractDef; risk: number; blocked: string | undefined; onAccept: () => void }) {
  const guide = useGuide();
  const stages = stagesOf(contract);
  const target = findServer(content, contract.targetId);
  const job = isJob(contract);
  const staged = stages.length > 1;
  const part = contract.part && findModule(content, contract.part.id);
  const minutes = contract.withinMinutes;
  const legend = job ? contract.legend : undefined;
  return (
    <li data-job={contract.id} class={`card jobcard${contract.story ? ' is-story' : ''}${job ? ' is-standing' : ''}${contract.heist ? ' is-heist' : ''}${legend ? ' is-legend' : ''}`}>
      <div class="card__head">
        <IconTile icon={contract.story ? 'star' : legend ? 'sparkle' : objectiveIcon(contract.objective.kind)} tone={contract.story ? 'rare' : job ? 'good' : undefined} />
        <div class="card__title">
          <strong>{contract.title}</strong>
          <span class="card__sub">
            <span class="jobcard__client">
              <Icon name="person" size={13} /> {contract.client}
            </span>
            <PatronChip contract={contract} />
          </span>
        </div>
        {contract.heist ? (
          <span class="row__tag row__tag--danger card__tag" data-tip="Several lines at once, several traces. Caught on any of them, the plan burns.">heist</span>
        ) : contract.story ? (
          <span class="row__tag row__tag--rare card__tag">story</span>
        ) : legend ? (
          <span class="row__tag row__tag--legend card__tag" data-tip="One a day, for those at the top: two steps against the hardest companies, three times the pay, and a condition that holds while the job is open.">legend</span>
        ) : job && 'news' in contract && contract.news ? (
          <span class="row__tag row__tag--warn card__tag" data-tip="The Wire carried a story about this company. The job is only up for a short while.">in the news</span>
        ) : job ? (
          <span class="row__tag row__tag--good card__tag">standing work</span>
        ) : null}
      </div>
      {job && 'news' in contract && contract.news && <p class="jobcard__news">“{contract.news}”</p>}
      {legend && (
        <p class="jobcard__twist" data-tip="This week's condition. It holds from the moment you accept until the job is delivered or given up.">
          <strong>{TWISTS[legend.twist].name}</strong>
          {TWISTS[legend.twist].line}
        </p>
      )}
      {contract.terms && (
        <p class="jobcard__twist" data-tip="Optional. Keep to it and the bonus is paid on top. Break it and the job pays as usual.">
          <strong>{TERMS_NAMES[contract.terms.kind]}</strong>
          {termsLine(content, contract.terms)}
        </p>
      )}
      <p class="card__blurb">{contract.summary}</p>
      {contract.heist && <HeistPlan contract={contract} live={false} />}
      {staged ? (
        <p class="jobcard__steps" title="A longer job. Each step comes once the one before is done.">
          <span class="card__fits-label">{stages.length} steps</span>
          {stages.map((stage, index) => (
            <span key={index} class="jobcard__step">
              {index > 0 && <span class="jobcard__then" aria-hidden="true" />}
              <span class="card__fit" title={OBJECTIVE_WORDS[stage.objective.kind]}>
                <Icon name={objectiveIcon(stage.objective.kind)} size={15} />
              </span>
            </span>
          ))}
        </p>
      ) : (
        <p class="jobcard__kind">
          <Icon name={objectiveIcon(contract.objective.kind)} size={15} /> {OBJECTIVE_WORDS[contract.objective.kind]}
        </p>
      )}
      <p class="jobcard__where">
        <Icon name="pin" size={15} />
        <span>
          {target ? <Place id={target.id}>{target.name}</Place> : contract.targetId}
          {target && <span class="jobcard__city"> · {target.city}</span>}
        </span>
      </p>
      <div class="jobcard__facts">
        <RiskMeter risk={risk} />
        {minutes !== undefined && (
          <span class="jobcard__fact is-warn" data-tip="The first step has to be done within this many game minutes of taking the job.">
            <Icon name="clock" size={14} /> {minutes} min
          </span>
        )}
        {contract.window && (
          <span class="jobcard__fact is-warn" data-tip="Every step has to be done within this many game hours of taking the job.">
            <Icon name="clock" size={14} /> {Math.round(contract.window.minutes / 60)} h for all of it
          </span>
        )}
        {job && (
          <span class="jobcard__fact" data-tip="When this job comes off the board">
            <Icon name="clock" size={14} /> until {formatGameTime(contract.expiresMs)}
          </span>
        )}
        {contract.minRating > 0 && (
          <span class="jobcard__fact" data-tip="The rating the board wants before it offers this job">
            rating {contract.minRating}+
          </span>
        )}
      </div>
      <div class="card__foot">
        <span class="jobcard__reward">
          <span class="data jobcard__pay">{formatMoney(roundTotal(contract))}</span>
          {contract.rating > 0 && (
            <span class="contract__rating" title="What delivering it adds to your rating">
              +<span class="data">{contract.rating}</span> rating
            </span>
          )}
          {part && contract.part && <ModulePlate module={part} grade={contract.part.grade} />}
        </span>
        <button type="button" class={`btn btn--go card__buy${guide?.id === 'accept' && contract.id === GUIDED_JOB ? ' is-guided' : ''}`} disabled={!!blocked} title={blocked} data-tip="Take this job. It shows at the top right of the screen." data-sfx="accepted" onClick={onAccept}>
          Accept
        </button>
      </div>
    </li>
  );
}

/** The contracts board: job cards with their kind, pay and risk at a glance, filters, and a choice of order. */
export function Contracts({ game, connection, act }: View) {
  const [view, setView] = useState(kept);
  const change = (next: Partial<typeof kept>) => {
    kept = { ...view, ...next };
    setView(kept);
  };
  const active = activeContract(game, content);
  const offers = availableContracts(game, content);
  const lyingLow = isLyingLow(game);
  const nextAt = nextContractRating(game, content);
  // A story job that is ready but for what the player has in hand: the board says what is missing, so nobody grinds for nothing.
  const waits = storyWaits(game, content);
  const blocked = active ? 'Finish or give up the contract you have first' : undefined;

  // Every job on the board has now been seen: the route map stops pulsing it.
  const offerKey = offers.map((contract) => contract.id).join();
  useEffect(() => globeSeen.mark(offers.map((contract) => `job:${contract.id}`)), [offerKey]);
  // A job asked for from the route map is brought into view and lit for a moment.
  const desk = useDesk();
  const cards = useRef<HTMLUListElement>(null);
  const wantedJob = desk.jobFocus && offers.some((contract) => contract.id === desk.jobFocus) ? desk.jobFocus : null;
  useEffect(() => {
    if (!wantedJob) return;
    deskStore.focusJob(null);
    // Show every kind of job, so the one asked for is not filtered out.
    if (kept.filter !== 'all') change({ filter: 'all' });
    setTimeout(() => {
      const card = cards.current?.querySelector<HTMLElement>(`[data-job="${CSS.escape(wantedJob)}"]`);
      if (!card) return;
      card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      card.classList.add('is-asked');
      setTimeout(() => card.classList.remove('is-asked'), 2400);
    }, 30);
  }, [wantedJob]);

  const risks = new Map(offers.map((contract) => [contract.id, contractRisk(game, content, contract)]));
  const counts: Record<Filter, number> = {
    all: offers.length,
    story: offers.filter((contract) => contract.story).length,
    staged: offers.filter(isStaged).length,
    standing: offers.filter(isJob).length,
  };
  const filter = counts[view.filter] > 0 ? view.filter : 'all';
  const passes = (contract: ContractDef) =>
    filter === 'all' || (filter === 'story' && !!contract.story) || (filter === 'staged' && isStaged(contract)) || (filter === 'standing' && isJob(contract));
  // Each order starts the way a player would want it: best pay first, safest first, most rating first. Press again to flip it.
  const order: Record<Sort, (a: ContractDef, b: ContractDef) => number> = {
    board: () => 0,
    pay: (a, b) => b.pay - a.pay,
    risk: (a, b) => (risks.get(a.id) ?? 0) - (risks.get(b.id) ?? 0) || b.pay - a.pay,
    rating: (a, b) => b.rating - a.rating || b.pay - a.pay,
  };
  const sorted = offers.filter(passes).sort(order[view.sort]);
  // Story jobs lead the board unless the player has asked for an order of their own.
  const shown = view.sort === 'board' ? [...sorted.filter((contract) => contract.story), ...sorted.filter((contract) => !contract.story)] : view.flipped ? sorted.reverse() : sorted;

  const filters: { id: Filter; label: string; icon: IconName }[] = [
    { id: 'all', label: 'All', icon: 'grid' },
    { id: 'story', label: 'Story', icon: 'star' },
    { id: 'staged', label: 'Staged', icon: 'steps' },
    { id: 'standing', label: 'Standing work', icon: 'repeat' },
  ];
  const sorts: { id: Sort; label: string; first: string; flippedFirst: string }[] = [
    { id: 'pay', label: 'Pay', first: 'best paid first', flippedFirst: 'lowest paid first' },
    { id: 'risk', label: 'Risk', first: 'safest first', flippedFirst: 'most dangerous first' },
    { id: 'rating', label: 'Rating', first: 'most rating first', flippedFirst: 'least rating first' },
  ];

  return (
    <div class="jobboard">
      {lyingLow && (
        <p class="board__warning">
          You are lying low until <span class="data">{formatGameTime(game.player.lieLowUntilMs)}</span>. You were traced, so only standing work is offered, and it pays less.
        </p>
      )}
      {active && (
        <p class="board__note jobboard__active">
          <Icon name="play" size={15} />
          <span>
            You are working on <strong>{active.title}</strong>. Deliver it or give it up before taking another.
          </span>
          <button type="button" class="btn" onClick={() => deskStore.showContract(true)}>
            Open it
          </button>
        </p>
      )}
      {nextAt !== undefined && (
        <p class="board__note">
          Your rating is <strong>{formatRating(game.player.rating)}</strong>. The next contract is held back until rating <strong>{nextAt}</strong>. Standing
          work raises it.
        </p>
      )}
      {waits.map((wait) => (
        <div key={wait.beatId} class="board__note jobboard__waits">
          <Icon name="star" size={15} />
          <div>
            <strong>A story job is waiting until you are ready.</strong> No other work is needed first.
            <ul class="jobboard__needs">
              {wait.needs.map((need) => (
                <li key={need.note} class={need.met ? 'is-met' : undefined}>
                  <span class="jobboard__tick" aria-label={need.met ? 'Done' : 'Still to do'}>{need.met ? '✓' : '○'}</span> {need.note}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ))}
      {offers.length > 0 && (
        <div class="shopbar jobboard__bar">
          <div class="shoptabs" role="tablist" aria-label="Kinds of job">
            {filters
              .filter((item) => item.id === 'all' || counts[item.id] > 0)
              .map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  class={`shoptab${item.id === filter ? ' is-current' : ''}${item.id === 'story' ? ' shoptab--rare' : ''}`}
                  aria-selected={item.id === filter}
                  data-sfx="tab"
                  onClick={() => change({ filter: item.id })}
                >
                  <Icon name={item.icon} size={18} />
                  <span>{item.label}</span>
                  <span class="shoptab__count data">{counts[item.id]}</span>
                </button>
              ))}
          </div>
          <div class="shopfilters">
            <span class="jobboard__sortlabel">Sort by</span>
            {sorts.map((item) => {
              const on = view.sort === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  class={`toggle toggle--sort${on ? ' is-on' : ''}`}
                  aria-pressed={on}
                  data-sfx="tab"
                  data-tip={`Order the board by ${item.label.toLowerCase()}. Press again to turn it round, once more to go back to the board's own order.`}
                  onClick={() => change(!on ? { sort: item.id, flipped: false } : view.flipped ? { sort: 'board', flipped: false } : { flipped: true })}
                >
                  {item.label}
                  {on && <span class="toggle__dir" aria-hidden="true">{view.flipped ? '↑' : '↓'}</span>}
                </button>
              );
            })}
            {view.sort !== 'board' && (
              <span class="shopfilters__note">{sorts.find((item) => item.id === view.sort)?.[view.flipped ? 'flippedFirst' : 'first']}</span>
            )}
          </div>
        </div>
      )}
      {offers.length === 0 && <p class="empty">Nothing on the board right now.</p>}
      <ul class="cards cards--jobs" ref={cards} key={`${filter}:${view.sort}:${view.flipped}`}>
        {shown.map((contract) => (
          <JobCard
            key={contract.id}
            contract={contract}
            risk={risks.get(contract.id) ?? 0}
            blocked={blocked}
            onAccept={() => {
              if (act({ type: 'acceptContract', connectionId: connection.id, contractId: contract.id })) deskStore.showContract(true);
            }}
          />
        ))}
      </ul>
    </div>
  );
}
