/**
 * Repeatable jobs: the board keeps a few ordinary jobs against the
 * generated companies posted at all times, sized to the player's
 * rating, so there is always work between the hand-written contracts.
 * A job stays up for a while, then is taken down and replaced.
 */
import type { ContractDef, ServerDef } from '../content/schema';
import { NEW_KINDS, sectorsOf, type NewKind } from '../content/companies';
import { fill } from './generate';
import { assignPatron } from './patrons';
import { assignRegular } from './regulars';
import type { GameState, Job } from './state';
import type { Rng } from './rng';
import { stream } from './streams';
import type { Content } from './world';
import { legendDay, legendWeek, twistOfWeek } from './legend';
import { maybeTerms, sideJob } from './sideJobs';

/** The tier of company the board offers work against at this rating. `tierRatings` is the lowest rating for each tier. */
export function tierForRating(rating: number, tierRatings: readonly number[]): number {
  let tier = 1;
  tierRatings.forEach((min, index) => {
    if (rating >= min) tier = index + 1;
  });
  return tier;
}

/** Every company a job on the board right now touches, over all of its steps. */
export function touchedServers(state: GameState): Set<string> {
  const ids = new Set<string>();
  for (const job of state.contracts.jobs) {
    ids.add(job.targetId);
    for (const stage of job.stages ?? []) ids.add(stage.targetId);
    for (const hold of job.heist?.holds ?? []) ids.add(hold.targetId);
  }
  return ids;
}

/**
 * Names of the files a copy job on the board already asks for, over all of its steps.
 * The gateway holds one file of a name, so a second job for the same name at another
 * company in the trade would be done by the first.
 */
export function claimedFiles(state: GameState): Set<string> {
  const names = new Set<string>();
  for (const job of state.contracts.jobs) {
    for (const objective of [job.objective, ...(job.stages ?? []).map((stage) => stage.objective)]) {
      if (objective.kind === 'steal') names.add(objective.file);
    }
  }
  return names;
}

/** True for a job from the board's pool, as opposed to a hand-written contract. */
export const isJob = (contract: ContractDef): contract is Job => 'expiresMs' in contract;

// The board makes only these three kinds of one-step job.
type Objective = Extract<ContractDef['objective'], { kind: 'steal' | 'destroy' | 'record' }>;

/** Every one-step job that could be posted against a company right now. */
export const boardObjectives = (state: GameState, server: ServerDef) => possibleObjectives(state, server);

/** Every job that could be posted against a company right now. */
function possibleObjectives(state: GameState, server: ServerDef): Objective[] {
  const live = state.servers[server.id];
  if (!live) return [];
  const goals: Objective[] = [];
  const claimed = claimedFiles(state);
  for (const file of live.files) {
    if (file.access !== 'admin') continue;
    // A module installer or program file is loot, not what a client asks for.
    const written = server.files.find((item) => item.name === file.name);
    if (written?.part || written?.program) continue;
    // Only files whose copy the player would not already have.
    if (!state.player.files.some((own) => own.name === file.name) && !claimed.has(file.name)) goals.push({ kind: 'steal', file: file.name });
    goals.push({ kind: 'destroy', file: file.name });
  }
  const records = server.records;
  if (records) {
    const column = records.columns[1]!;
    for (const row of live.records) {
      goals.push({ kind: 'record', key: row[0]!, column, value: '' });
    }
  }
  return goals;
}

/** Share of ordinary jobs worded for the company's trade, where the trade has wording of its own. */
export const TRADE_SHARE = 0.6;

/**
 * An ordinary one-step job against a company, with the values its wording
 * was filled from: what every board job starts as. `only` keeps it to some
 * kinds. Undefined if the company has nothing to ask for.
 */
export function plainJob(state: GameState, content: Content, server: ServerDef, rng: Rng, only?: readonly Objective['kind'][]): { job: Job; values: Record<string, string> } | undefined {
  const pools = content.companies.jobs;
  if (!server.generated || pools.clients.length === 0) return undefined;
  const goals = possibleObjectives(state, server).filter((goal) => !only || only.includes(goal.kind));
  if (goals.length === 0) return undefined;
  let objective = rng.pick(goals);
  if (objective.kind === 'record') {
    const key = objective.key;
    const current = state.servers[server.id]!.records.find((row) => row[0] === key)?.[1];
    const choices = sectorsOf(content.companies).find((sector) => sector.id === server.generated!.sector)?.records?.values.filter((value) => value !== current) ?? [];
    if (choices.length === 0) return undefined;
    objective = { ...objective, value: rng.pick(choices) };
  }
  const general = pools[objective.kind];
  // A company's trade may have wording of its own for this kind of job: used some of the time.
  // Decided on a fork, and each line still takes one draw, so the board's draws stay as they were.
  const trade = pools.trades?.[server.generated.sector]?.[objective.kind];
  const own = trade !== undefined && rng.fork(`trade:${server.id}:${rng.getState().state}`).chance(TRADE_SHARE);
  const lines = (name: 'titles' | 'summaries' | 'briefs'): readonly string[] => (own && trade[name] && trade[name].length > 0 ? trade[name] : general[name]);
  const values: Record<string, string> = {
    company: server.name,
    city: server.city,
    tier: pools.tiers[server.generated!.tier - 1] ?? '',
    ...(objective.kind === 'record'
      ? { key: objective.key, column: objective.column, value: objective.value, records: server.records?.title.toLowerCase() ?? 'records' }
      : { file: objective.file }),
  };
  const serverTier = server.generated!.tier;
  const job: Job = {
    id: `job-${state.nextId++}`,
    title: rng.pick(lines('titles')),
    client: rng.pick(pools.clients),
    targetId: server.id,
    pay: (content.rules.jobPay[serverTier - 1] ?? 0) + rng.int(0, 4) * 50,
    rating: content.rules.jobRatings[serverTier - 1] ?? 0,
    minRating: 0,
    summary: fill(rng.pick(lines('summaries')), values),
    brief: fill(rng.pick(lines('briefs')), values),
    objective,
    expiresMs: state.clock.gameTimeMs + content.rules.jobHours * 3_600_000,
  };
  return { job, values };
}

/**
 * Makes one new job against a company of about the right tier, or against
 * `at` if given (then on `rng`, and with a first step only if `staged`). Undefined if
 * there is nothing to make.
 */
function makeJob(state: GameState, content: Content, at?: { server: ServerDef; rng: Rng; staged?: boolean }): Job | undefined {
  const pools = content.companies.jobs;
  const rng = at?.rng ?? stream(state, 'jobs');
  const tier = tierForRating(state.player.rating, content.rules.tierRatings);
  const busy = touchedServers(state);
  const companies = at
    ? [at.server].filter((server) => server.generated && !busy.has(server.id))
    : content.servers.filter((server) => server.generated && server.generated.tier <= tier && server.generated.tier >= tier - 1 && !busy.has(server.id));
  if (companies.length === 0 || pools.clients.length === 0) return undefined;
  const server = rng.pick(companies);
  const plain = plainJob(state, content, server, rng);
  if (!plain) return undefined;
  const { job, values } = plain;
  const serverTier = server.generated!.tier;
  // From the middle tiers up, some jobs gain a first step on another server.
  // Decided on a stream of its own, forked on where the jobs stream stands
  // (deterministic, and not on the job's id: an id would tie this to nextId,
  // so any new message or entity made elsewhere would reshuffle the board).
  const own = rng.fork(`staged:${server.id}:${rng.getState().state}`);
  // Some become one of the newer kinds of job, and some become a race (see kinds.ts). Forked the same way.
  // Some become one of the side kinds (see sideJobs.ts). Forked the same way, and asked first.
  const side = at ? undefined : sideJob(state, content, job, server, values, rng.fork(`side:${server.id}:${rng.getState().state}`));
  // A job no patron takes may be a regular client's (see regulars.ts). Forked the same way.
  const regular = (job: Job, at: ServerDef): Job => (job.patron ? job : assignRegular(state, content, job, at, rng.fork(`regular:${server.id}:${rng.getState().state}`)));
  if (side) {
    const where = content.servers.find((item) => item.id === side.targetId) ?? server;
    return regular(assignPatron(state, content, side, where, rng.fork(`patron:${server.id}:${rng.getState().state}`)), where);
  }
  const other = at ? undefined : newKind(state, content, job, server, values, rng.fork(`kind:${server.id}:${rng.getState().state}`));
  const made = other ?? (pools.staged && (at ? at.staged === true : serverTier >= 5 && own.chance(0.5)) ? addFirstStep(state, content, job, server, values, own) : job);
  const racing = at ? made : maybeRace(content, made, serverTier, rng.fork(`race:${server.id}:${rng.getState().state}`));
  // Some ordinary jobs carry optional terms: a bonus for doing it a particular way.
  const raced = at ? racing : maybeTerms(state, content, racing, server, rng.fork(`terms:${server.id}:${rng.getState().state}`));
  // Some jobs are a patron's, under their own name (see patrons.ts). Forked the same way, so the board's draws stay as they were.
  const patron = assignPatron(state, content, raced, server, rng.fork(`patron:${server.id}:${rng.getState().state}`));
  return at ? patron : regular(patron, server);
}

/** Share of board jobs that are one of the newer kinds, once the tier allows any. */
export const NEW_KIND_SHARE = 0.3;
/** Share of copy and delete jobs, tier 2 up, that are races. */
export const RACE_SHARE = 0.15;
/** The lowest company tier each newer kind is posted against, and what it pays as a share of the usual. */
const KIND_RULES: Readonly<Record<NewKind, { tier: number; pay: number }>> = {
  swap: { tier: 1, pay: 1.1 },
  frame: { tier: 2, pay: 1.2 },
  hold: { tier: 2, pay: 1.0 },
  guard: { tier: 3, pay: 1.3 },
  hunt: { tier: 3, pay: 1.4 },
};

/** Maybe turns a fresh job into one of the newer kinds: frame, guard, stay in, find the hacker or swap. */
function newKind(state: GameState, content: Content, job: Job, server: ServerDef, values: Record<string, string>, rng: Rng): Job | undefined {
  const pools = content.companies.jobs;
  const tier = server.generated!.tier;
  const kinds = NEW_KINDS.filter((kind) => pools.kinds?.[kind] && tier >= KIND_RULES[kind].tier);
  if (kinds.length === 0 || !rng.chance(NEW_KIND_SHARE)) return undefined;
  const kind = rng.pick(kinds);
  const seconds = 30 + 10 * tier;
  const racers = pools.racers && pools.racers.length > 0 ? pools.racers : ['a rival'];
  let objective: ContractDef['objective'];
  const extra: Record<string, string> = {};
  switch (kind) {
    case 'frame': {
      const who = `${rng.pick(content.companies.first)} ${rng.pick(content.companies.last)}`;
      const address = `${rng.int(11, 223)}.${rng.int(1, 254)}.${rng.int(1, 254)}.${rng.int(2, 254)}`;
      objective = { kind, who, address };
      Object.assign(extra, { who, address });
      break;
    }
    case 'guard': {
      const rival = rng.pick(racers);
      objective = { kind, seconds, rival };
      Object.assign(extra, { seconds: String(seconds), rival });
      break;
    }
    case 'hold':
      objective = { kind, seconds };
      extra.seconds = String(seconds);
      break;
    case 'hunt': {
      const busy = touchedServers(state);
      const others = content.servers.filter((other) => other.generated && other.id !== server.id && !busy.has(other.id) && other.generated.tier <= tier);
      if (others.length < 2) return undefined;
      const trail = rng.shuffle([...others]).slice(0, 2).map((other) => other.id);
      objective = { kind, trail };
      break;
    }
    case 'swap': {
      if (job.objective.kind !== 'steal' && job.objective.kind !== 'destroy') return undefined;
      objective = { kind, file: job.objective.file };
      break;
    }
  }
  const wording = pools.kinds![kind]!;
  const all = { ...values, ...extra };
  return {
    ...job,
    title: rng.pick(wording.titles),
    summary: fill(rng.pick(wording.summaries), all),
    brief: fill(rng.pick(wording.briefs), all),
    pay: Math.round((job.pay * KIND_RULES[kind].pay) / 50) * 50,
    objective,
  };
}

/** Maybe makes a copy or delete job a race against another hacker: better pay, and a clock. */
function maybeRace(content: Content, job: Job, tier: number, rng: Rng): Job {
  const racers = content.companies.jobs.racers;
  if (!racers || racers.length === 0 || tier < 2 || job.stages || (job.objective.kind !== 'steal' && job.objective.kind !== 'destroy') || !rng.chance(RACE_SHARE)) return job;
  const rival = rng.pick(racers);
  return {
    ...job,
    title: `Race: ${job.title}`,
    pay: Math.round((job.pay * 1.3) / 50) * 50,
    brief: `${job.brief}

One more thing: ${rival} has been offered the same job. Whoever finishes first gets paid.`,
    race: { rival, minutes: 150 + 30 * tier },
  };
}

/**
 * Turns a one-step job into two: a first server to lift something from
 * before the real target. The simplest kind that always holds up: steal a
 * document from a second company, then do the original goal on the target.
 */
function addFirstStep(state: GameState, content: Content, job: Job, target: ServerDef, values: Record<string, string>, rng: Rng): Job {
  const staged = content.companies.jobs.staged!;
  const busy = touchedServers(state);
  const options = content.servers.filter(
    (server) =>
      server.generated &&
      server.id !== target.id &&
      !busy.has(server.id) &&
      Math.abs(server.generated.tier - target.generated!.tier) <= 1 &&
      (state.servers[server.id]?.files.some((file) => file.access === 'admin') ?? false),
  );
  if (options.length === 0) return job;
  const first = rng.pick(options);
  const claimed = claimedFiles(state);
  const files = (state.servers[first.id]?.files ?? []).filter((file) => {
    if (file.access !== 'admin') return false;
    const written = first.files.find((item) => item.name === file.name);
    // A module installer or program file is loot, not a document a client would send you for.
    if (written?.part || written?.program) return false;
    // Two companies in one trade keep files of the same name, and the gateway holds one file of a name:
    // never one the player already has, or the one the second step is going to ask for.
    if (state.player.files.some((own) => own.name === file.name) || claimed.has(file.name)) return false;
    return !('file' in job.objective && job.objective.file === file.name);
  });
  if (files.length === 0) return job;
  const file = rng.pick(files).name;
  const stageValues = { ...values, company2: first.name, city2: first.city, address2: first.address };
  return {
    ...job,
    pay: Math.round(job.pay * 1.8),
    rating: job.rating + 1,
    summary: fill(rng.pick(staged.summaries), stageValues),
    brief: fill(rng.pick(staged.briefs), stageValues),
    targetId: first.id,
    objective: { kind: 'steal', file },
    stages: [{ targetId: target.id, objective: job.objective, brief: fill(rng.pick(staged.next), values) }],
  };
}

/**
 * Posts a short-lived job against one company because of something in the
 * news (see news.ts). It pays `payFactor` times the usual and stays up for
 * `hours`. Returns the job, or undefined if the company has nothing to ask
 * for or is already the target of a job on the board.
 */
export function postNewsJob(state: GameState, content: Content, server: ServerDef, rng: Rng, hours: number, payFactor: number, headline: string): Job | undefined {
  const job = makeJob(state, content, { server, rng });
  if (!job) return undefined;
  const posted: Job = { ...job, pay: Math.round((job.pay * payFactor) / 50) * 50, expiresMs: state.clock.gameTimeMs + hours * 3_600_000, news: headline };
  state.contracts.jobs.push(posted);
  return posted;
}

/**
 * Takes down jobs that have run out or can no longer be done, and posts
 * new ones until the board has its usual number. The job being worked on
 * is never taken down. Cheap when there is nothing to do.
 */
export function refreshJobs(state: GameState, content: Content, stillPossible: (job: Job) => boolean): void {
  const now = state.clock.gameTimeMs;
  const keep = (job: Job) => job.id === state.contracts.activeId || (job.expiresMs > now && stillPossible(job));
  // Jobs the news opened, heists and legend contracts come on top of the usual number.
  const usual = () => state.contracts.jobs.filter((job) => !job.news && !job.heist && !job.legend).length;
  if (usual() >= content.rules.boardJobs && state.contracts.jobs.every(keep)) return;
  state.contracts.jobs = state.contracts.jobs.filter(keep);
  // A few tries per missing job, in case a pick has nothing left to ask for.
  for (let tries = 0; usual() < content.rules.boardJobs && tries < content.rules.boardJobs * 3; tries++) {
    const job = mixedJob(state, content);
    if (job) state.contracts.jobs.push(job);
  }
}

/** From this rating the board keeps its jobs unlike one another. Before it there are too few kinds to choose from. */
export const MIX_RATING = 10;
/** How many times the board draws again for a job unlike the ones it has, before it settles for what it drew. */
export const MIX_TRIES = 6;

/** What sort of work a job is, as the player would see it on the board: two jobs of one sort look alike. */
export function jobSort(job: Job): string {
  if (job.heist) return 'heist';
  if (job.stages && job.stages.length > 0) return 'two-step';
  return job.objective.kind;
}

/** True if a job would sit among the board's usual jobs beside one of its own sort, or under the same title. What the news, a heist or a legend brought is marked as such and does not count. */
export function alikeOnBoard(state: GameState, job: Job): boolean {
  const plain = (title: string) => title.replace(/^(Race|Legend): /, '');
  return state.contracts.jobs.some((other) => other.id !== job.id && !other.legend && !other.heist && !other.news && (jobSort(other) === jobSort(job) || plain(other.title) === plain(job.title)));
}

/** A new job for the board, drawn again a few times if it is like one already there. */
function mixedJob(state: GameState, content: Content): Job | undefined {
  let job = makeJob(state, content);
  if (state.player.rating < MIX_RATING) return job;
  for (let tries = 0; job && alikeOnBoard(state, job) && tries < MIX_TRIES; tries++) job = makeJob(state, content) ?? job;
  return job;
}

/** A legend contract pays this many times a job of its kind, and is worth this much rating. */
export const LEGEND_PAY = 3;
export const LEGEND_RATING = 3;
/** Hours a legend contract stays on the board. */
export const LEGEND_HOURS = 48;

/**
 * Posts a legend contract (see legend.ts) if the player has the rating for
 * them, a game day has turned since the last, and none is on the board:
 * a two-step job against the hardest company that is free, with the week's
 * twist. Cheap when there is nothing to do.
 */
export function postLegend(state: GameState, content: Content): void {
  const from = content.rules.legendRating;
  if (from === undefined || state.player.rating < from) return;
  const day = legendDay(state);
  if (state.contracts.legendDay >= day || state.contracts.jobs.some((job) => job.legend)) return;
  const rng = stream(state, 'legend');
  const busy = touchedServers(state);
  // The hardest companies first. There are only a few, and the board may have them all spoken for, so the next hardest stand in.
  const free = rng.shuffle(content.servers.filter((server) => server.generated && !busy.has(server.id)));
  const companies = [...free].sort((a, b) => b.generated!.tier - a.generated!.tier);
  for (const server of companies.slice(0, 8)) {
    const job = makeJob(state, content, { server, rng, staged: true });
    if (!job) continue;
    state.contracts.legendDay = day;
    const week = legendWeek(state);
    state.contracts.jobs.push({
      ...job,
      title: `Legend: ${job.title.replace(/^Race: /, '')}`,
      pay: Math.round((job.pay * LEGEND_PAY) / 50) * 50,
      rating: LEGEND_RATING,
      expiresMs: state.clock.gameTimeMs + LEGEND_HOURS * 3_600_000,
      legend: { twist: twistOfWeek(state.seed, week), week },
    });
    return;
  }
}
