/**
 * Repeatable jobs: the board keeps a few ordinary jobs against the
 * generated companies posted at all times, sized to the player's
 * rating, so there is always work between the hand-written contracts.
 * A job stays up for a while, then is taken down and replaced.
 */
import type { ContractDef, ServerDef } from '../content/schema';
import { NEW_KINDS, type NewKind } from '../content/companies';
import { fill } from './generate';
import { assignPatron } from './patrons';
import type { GameState, Job } from './state';
import type { Rng } from './rng';
import { stream } from './streams';
import type { Content } from './world';

/** The tier of company the board offers work against at this rating. `tierRatings` is the lowest rating for each tier. */
export function tierForRating(rating: number, tierRatings: readonly number[]): number {
  let tier = 1;
  tierRatings.forEach((min, index) => {
    if (rating >= min) tier = index + 1;
  });
  return tier;
}

/** Every company a job on the board right now touches, over all of its steps. */
function touchedServers(state: GameState): Set<string> {
  const ids = new Set<string>();
  for (const job of state.contracts.jobs) {
    ids.add(job.targetId);
    for (const stage of job.stages ?? []) ids.add(stage.targetId);
  }
  return ids;
}

/** True for a job from the board's pool, as opposed to a hand-written contract. */
export const isJob = (contract: ContractDef): contract is Job => 'expiresMs' in contract;

// The board makes only these three kinds of one-step job.
type Objective = Extract<ContractDef['objective'], { kind: 'steal' | 'destroy' | 'record' }>;

/** Every job that could be posted against a company right now. */
function possibleObjectives(state: GameState, server: ServerDef): Objective[] {
  const live = state.servers[server.id];
  if (!live) return [];
  const goals: Objective[] = [];
  for (const file of live.files) {
    if (file.access !== 'admin') continue;
    // A module installer or program file is loot, not what a client asks for.
    const written = server.files.find((item) => item.name === file.name);
    if (written?.part || written?.program) continue;
    // Only files whose copy the player would not already have.
    if (!state.player.files.some((own) => own.name === file.name)) goals.push({ kind: 'steal', file: file.name });
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

/**
 * Makes one new job against a company of about the right tier, or against
 * `at` if given (then on `rng`, and never with a first step). Undefined if
 * there is nothing to make.
 */
function makeJob(state: GameState, content: Content, at?: { server: ServerDef; rng: Rng }): Job | undefined {
  const pools = content.companies.jobs;
  const rng = at?.rng ?? stream(state, 'jobs');
  const tier = tierForRating(state.player.rating, content.rules.tierRatings);
  const busy = touchedServers(state);
  const companies = at
    ? [at.server].filter((server) => server.generated && !busy.has(server.id))
    : content.servers.filter((server) => server.generated && server.generated.tier <= tier && server.generated.tier >= tier - 1 && !busy.has(server.id));
  if (companies.length === 0 || pools.clients.length === 0) return undefined;
  const server = rng.pick(companies);
  const goals = possibleObjectives(state, server);
  if (goals.length === 0) return undefined;
  let objective = rng.pick(goals);
  if (objective.kind === 'record') {
    const key = objective.key;
    const current = state.servers[server.id]!.records.find((row) => row[0] === key)?.[1];
    const choices = content.companies.sectors.find((sector) => sector.id === server.generated!.sector)?.records?.values.filter((value) => value !== current) ?? [];
    if (choices.length === 0) return undefined;
    objective = { ...objective, value: rng.pick(choices) };
  }
  const wording = pools[objective.kind];
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
    title: rng.pick(wording.titles),
    client: rng.pick(pools.clients),
    targetId: server.id,
    pay: (content.rules.jobPay[serverTier - 1] ?? 0) + rng.int(0, 4) * 50,
    rating: content.rules.jobRatings[serverTier - 1] ?? 0,
    minRating: 0,
    summary: fill(rng.pick(wording.summaries), values),
    brief: fill(rng.pick(wording.briefs), values),
    objective,
    expiresMs: state.clock.gameTimeMs + content.rules.jobHours * 3_600_000,
  };
  // From the middle tiers up, some jobs gain a first step on another server.
  // Decided on a stream of its own, forked on where the jobs stream stands
  // (deterministic, and not on the job's id: an id would tie this to nextId,
  // so any new message or entity made elsewhere would reshuffle the board).
  const own = rng.fork(`staged:${server.id}:${rng.getState().state}`);
  // Some become one of the newer kinds of job, and some become a race (see kinds.ts). Forked the same way.
  const other = at ? undefined : newKind(state, content, job, server, values, rng.fork(`kind:${server.id}:${rng.getState().state}`));
  const made = other ?? (!at && pools.staged && serverTier >= 5 && own.chance(0.5) ? addFirstStep(state, content, job, server, values, own) : job);
  const raced = at ? made : maybeRace(content, made, serverTier, rng.fork(`race:${server.id}:${rng.getState().state}`));
  // Some jobs are a patron's, under their own name (see patrons.ts). Forked the same way, so the board's draws stay as they were.
  return assignPatron(state, content, raced, server, rng.fork(`patron:${server.id}:${rng.getState().state}`));
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
  const files = (state.servers[first.id]?.files ?? []).filter((file) => {
    if (file.access !== 'admin') return false;
    const written = first.files.find((item) => item.name === file.name);
    // A module installer or program file is loot, not a document a client would send you for.
    return !written?.part && !written?.program;
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
  // Jobs the news opened come on top of the usual number.
  const usual = () => state.contracts.jobs.filter((job) => !job.news).length;
  if (usual() >= content.rules.boardJobs && state.contracts.jobs.every(keep)) return;
  state.contracts.jobs = state.contracts.jobs.filter(keep);
  // A few tries per missing job, in case a pick has nothing left to ask for.
  for (let tries = 0; usual() < content.rules.boardJobs && tries < content.rules.boardJobs * 3; tries++) {
    const job = makeJob(state, content);
    if (job) state.contracts.jobs.push(job);
  }
}
