/**
 * Legend contracts: the work that is left once the top title is reached.
 *
 * One at a time, a new one each game day, the board posts a two-step job
 * against the hardest companies there are. It pays three times the usual
 * and carries the week's twist: a rule that makes the job harder in one
 * particular way while it is being worked on. The twist changes with the
 * game week, in an order set by the game's seed.
 *
 * This file reads only the state, so the rules it bends (trace.ts,
 * loadout.ts, world.ts) can ask it what is in force.
 */
import type { GameState, Job } from './state';

export const LEGEND_TWISTS = ['shortFuse', 'onGuard', 'travelLight', 'blindRun'] as const;
export type LegendTwist = (typeof LEGEND_TWISTS)[number];

export interface TwistDef {
  readonly name: string;
  /** What it does, as the board puts it. */
  readonly line: string;
}

/** A trace on the job's servers takes this share of its usual time. */
export const SHORT_FUSE = 2 / 3;
/** Memory there is to load while a Travel light job is open, in GB. */
export const TRAVEL_LIGHT_GB = 24;

export const TWISTS: Readonly<Record<LegendTwist, TwistDef>> = {
  shortFuse: { name: 'Short fuse', line: 'Their tracers have been told you are coming. A trace on this job runs in two thirds of the time.' },
  onGuard: { name: 'On guard', line: 'Every lock on this job has been turned up a level.' },
  travelLight: { name: 'Travel light', line: `The client wants no footprint. While this job is open your memory holds ${TRAVEL_LIGHT_GB} GB and no more.` },
  blindRun: { name: 'Blind run', line: 'Something on their side eats your readings. While this job is open no tracker or sensor shows how far a trace has got.' },
};

const DAY_MS = 86_400_000;
export const legendDay = (state: GameState): number => Math.floor(state.clock.gameTimeMs / DAY_MS);
export const legendWeek = (state: GameState): number => Math.floor(legendDay(state) / 7);

/** The twist every legend contract posted in a week carries. Each game runs through all four before one comes round again. */
export function twistOfWeek(seed: number, week: number): LegendTwist {
  return LEGEND_TWISTS[(((Math.abs(Math.floor(seed)) % LEGEND_TWISTS.length) + week) % LEGEND_TWISTS.length + LEGEND_TWISTS.length) % LEGEND_TWISTS.length]!;
}

/** The legend contract being worked on, if that is what the active job is. */
export function activeLegend(state: GameState): Job | undefined {
  const id = state.contracts?.activeId;
  if (!id) return undefined;
  return state.contracts.jobs.find((job) => job.id === id && job.legend !== undefined);
}

/** True while the active job is a legend contract with this twist. With a server: only if that server is one of the job's. */
export function twistOn(state: GameState, twist: LegendTwist, serverId?: string): boolean {
  const job = activeLegend(state);
  if (!job || job.legend!.twist !== twist) return false;
  if (serverId === undefined) return true;
  return job.targetId === serverId || (job.stages ?? []).some((stage) => stage.targetId === serverId);
}
