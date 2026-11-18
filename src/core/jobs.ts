/**
 * Repeatable jobs: the board keeps a few ordinary jobs against the
 * generated companies posted at all times, sized to the player's
 * rating, so there is always work between the hand-written contracts.
 * A job stays up for a while, then is taken down and replaced.
 */
import type { ContractDef, ServerDef } from '../content/schema';
import { fill } from './generate';
import type { GameState, Job } from './state';
import { stream } from './streams';
import type { Content } from './world';

/** The tier of company the board offers work against at this rating. */
export function tierForRating(rating: number): number {
  return Math.max(1, Math.min(5, 1 + Math.floor(rating / 2)));
}

/** True for a job from the board's pool, as opposed to a hand-written contract. */
export const isJob = (contract: ContractDef): contract is Job => 'expiresMs' in contract;

type Objective = ContractDef['objective'];

/** Every job that could be posted against a company right now. */
function possibleObjectives(state: GameState, server: ServerDef): Objective[] {
  const live = state.servers[server.id];
  if (!live) return [];
  const goals: Objective[] = [];
  for (const file of live.files) {
    if (file.access !== 'admin') continue;
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
  const tier = tierForRating(state.player.rating);
  const busy = new Set(state.contracts.jobs.map((job) => job.targetId));
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
  return {
    id: `job-${state.nextId++}`,
    title: rng.pick(wording.titles),
    client: rng.pick(pools.clients),
    targetId: server.id,
    pay: content.rules.jobPayPerTier * serverTier + rng.int(0, 4) * 50,
    rating: 1,
    minRating: 0,
    summary: fill(rng.pick(wording.summaries), values),
    brief: fill(rng.pick(wording.briefs), values),
    objective,
    expiresMs: state.clock.gameTimeMs + content.rules.jobHours * 3_600_000,
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
