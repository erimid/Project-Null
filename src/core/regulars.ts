/**
 * Regular clients: small named clients who post ordinary board jobs in
 * their own voice (see RegularDef). They remember: the first job opens
 * one way, later ones another, and from the second job on they pay a
 * little more each time, up to a limit.
 *
 * A regular never takes a patron's job, a race, a heist or a job the
 * news or the darknet brought. Decided on a stream forked from where the
 * board's own stands, so the board's other draws stay as they were.
 */
import type { RegularDef } from '../content/companies';
import type { ContractDef, ServerDef } from '../content/schema';
import { fill } from './generate';
import type { Rng } from './rng';
import type { GameState, Job } from './state';
import type { Content } from './world';

/** Share of ordinary board jobs a regular posts, once any is about. */
export const REGULAR_SHARE = 0.3;
/** Each job done for a regular adds this share to what their next pays, up to `REGULAR_MOST`. */
export const REGULAR_STEP = 0.05;
export const REGULAR_MOST = 0.15;

const TIMES = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];

export const regularsOf = (content: Content): readonly RegularDef[] => content.companies.jobs.regulars ?? [];

/** Jobs delivered for a regular so far. */
export const jobsFor = (state: GameState, regularId: string): number => state.contracts.regulars[regularId] ?? 0;

/** The regular a job is from, if any. */
export function regularOf(content: Content, contract: ContractDef): RegularDef | undefined {
  const id = (contract as Job).regular;
  return id === undefined ? undefined : regularsOf(content).find((regular) => regular.id === id);
}

/** Maybe makes a fresh board job one of a regular's. */
export function assignRegular(state: GameState, content: Content, job: Job, server: ServerDef, rng: Rng): Job {
  const sector = server.generated?.sector;
  if (job.patron || job.race || job.heist || job.news || job.legend) return job;
  // One job from each regular on the board at a time.
  const posting = new Set(state.contracts.jobs.map((item) => item.regular));
  const able = regularsOf(content).filter((regular) => state.player.rating >= regular.minRating && !posting.has(regular.id) && (!regular.sectors || (sector !== undefined && regular.sectors.includes(sector))));
  if (able.length === 0 || !rng.chance(REGULAR_SHARE)) return job;
  const regular = rng.pick(able);
  const done = jobsFor(state, regular.id);
  const values = { company: server.name, city: server.city, times: TIMES[Math.min(done, TIMES.length - 1)]! };
  const opening = fill(rng.pick(done === 0 ? regular.intros : regular.again), values);
  const more = Math.min(REGULAR_MOST, done * REGULAR_STEP);
  return {
    ...job,
    client: regular.name,
    regular: regular.id,
    pay: Math.round((job.pay * (1 + more)) / 50) * 50,
    brief: `${opening}\n\n${job.brief}\n\n${regular.signoff}`,
  };
}

/** A job was delivered. A regular remembers theirs. */
export function noteRegular(state: GameState, contract: ContractDef): void {
  const id = (contract as Job).regular;
  if (id !== undefined) state.contracts.regulars[id] = jobsFor(state, id) + 1;
}
