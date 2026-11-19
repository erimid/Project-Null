/**
 * Repeatable jobs: the board keeps a few ordinary jobs against the
 * generated companies posted at all times, sized to the player's
 * rating, so there is always work between the hand-written contracts.
 * A job stays up for a while, then is taken down and replaced.
 */
import type { ContractDef, ServerDef } from '../content/schema';
import { fill } from './generate';
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

/** Makes one new job against a company of about the right tier. Undefined if there is nothing to make. */
function makeJob(state: GameState, content: Content): Job | undefined {
  const pools = content.companies.jobs;
  const rng = stream(state, 'jobs');
  const tier = tierForRating(state.player.rating, content.rules.tierRatings);
  const busy = touchedServers(state);
  const companies = content.servers.filter(
    (server) => server.generated && server.generated.tier <= tier && server.generated.tier >= tier - 1 && !busy.has(server.id),
  );
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
  if (pools.staged && serverTier >= 5 && own.chance(0.5)) return addFirstStep(state, content, job, server, values, own);
  return job;
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
 * Takes down jobs that have run out or can no longer be done, and posts
 * new ones until the board has its usual number. The job being worked on
 * is never taken down. Cheap when there is nothing to do.
 */
export function refreshJobs(state: GameState, content: Content, stillPossible: (job: Job) => boolean): void {
  const now = state.clock.gameTimeMs;
  const keep = (job: Job) => job.id === state.contracts.activeId || (job.expiresMs > now && stillPossible(job));
  if (state.contracts.jobs.length >= content.rules.boardJobs && state.contracts.jobs.every(keep)) return;
  state.contracts.jobs = state.contracts.jobs.filter(keep);
  // A few tries per missing job, in case a pick has nothing left to ask for.
  for (let tries = 0; state.contracts.jobs.length < content.rules.boardJobs && tries < content.rules.boardJobs * 3; tries++) {
    const job = makeJob(state, content);
    if (job) state.contracts.jobs.push(job);
  }
}
