/**
 * Rules for the side kinds of board job (made in sideJobs.ts) while one is
 * being worked on:
 *
 * - One clock for a whole job (`window`): a round of three companies, a
 *   trail to wipe before the morning audit. Out of time, the job is lost.
 * - A round pays for each stop as it is finished.
 * - Optional terms: a condition a client pays a bonus for. Breaking it
 *   costs the bonus and nothing else.
 * - Find the leak: the job is handed in by naming one of the suspects.
 * - The people a borrowed-login job puts within reach of a letter.
 */
import type { ContractDef, ObjectiveDef, TermsDef } from '../content/schema';
import type { PeopleDef } from '../content/people';
import type { GameState } from './state';
import type { Content } from './world';

type Goal<K extends ObjectiveDef['kind']> = Extract<ObjectiveDef, { kind: K }>;

/** A wrong name on a leak job pays this share. */
export const LEAK_WRONG_PAY = 0.5;

const steps = (contract: ContractDef) => [{ targetId: contract.targetId, objective: contract.objective, twists: contract.twists }, ...(contract.stages ?? [])];

/** The contract being worked on: a written one, or a job from the board. */
function active(state: GameState, content: Content): ContractDef | undefined {
  const id = state.contracts?.activeId;
  if (!id) return undefined;
  return content.contracts.find((item) => item.id === id) ?? state.contracts.jobs.find((job) => job.id === id);
}

/** Every server a job sends the player to. */
export const jobServers = (contract: ContractDef): string[] => [...new Set(steps(contract).map((step) => step.targetId))];

/** Starts a job's own clocks as it is taken. */
export function beginSide(state: GameState, contract: ContractDef): void {
  const now = state.clock.gameTimeMs;
  state.contracts.takenMs = now;
  state.contracts.windowUntilMs = contract.window ? now + contract.window.minutes * 60_000 : 0;
  state.contracts.termsBroken = false;
}

/** Clears them when the job is over, however it ended. */
export function endSide(state: GameState): void {
  state.contracts.takenMs = 0;
  state.contracts.windowUntilMs = 0;
  state.contracts.termsBroken = false;
}

/** True once a job's one clock has run out. */
export function windowPassed(state: GameState, contract: ContractDef): boolean {
  return contract.window !== undefined && state.contracts.windowUntilMs > 0 && state.clock.gameTimeMs > state.contracts.windowUntilMs;
}

/** Game minutes left on a job's one clock, or undefined if it has none. */
export function windowMinutesLeft(state: GameState, contract: ContractDef): number | undefined {
  if (!contract.window || state.contracts.activeId !== contract.id || state.contracts.windowUntilMs === 0) return undefined;
  return Math.max(0, Math.round((state.contracts.windowUntilMs - state.clock.gameTimeMs) / 60_000));
}

/** Pays one stop of a round as it is finished. The last stop is paid at delivery. */
export function payRoundStop(state: GameState, contract: ContractDef): void {
  if (contract.round) state.player.balance += contract.round.each;
}

/** What a round pays over all its stops, bonus included. */
export const roundTotal = (contract: ContractDef): number => contract.pay + (contract.round ? contract.round.each * (contract.stages?.length ?? 0) : 0);

/** The leak a job asks the player to name, if that is what its last step is. */
export function leakOf(contract: ContractDef): Goal<'leak'> | undefined {
  const all = steps(contract);
  const goal = all[all.length - 1]!.objective;
  return goal.kind === 'leak' ? goal : undefined;
}

/** How to name a suspect when handing a leak job in: the choice id for the suspect at `index`. */
export const nameChoice = (index: number): string => `name:${index}`;

/** The suspect a choice id names, or undefined. */
export function namedSuspect(goal: Goal<'leak'>, choiceId: string | undefined): string | undefined {
  const match = /^name:(\d+)$/.exec(choiceId ?? '');
  return match ? goal.suspects[Number(match[1])] : undefined;
}

/** Takes a finished job's notes off its servers: whoever asked has what they wanted, and tidies up. */
export function tidyNotes(state: GameState, contract: ContractDef): void {
  if (!leakOf(contract) && !contract.phish) return;
  for (const step of steps(contract)) {
    const dropped = (step.twists ?? []).flatMap((twist) => (twist.kind === 'drop' ? [twist.file] : []));
    const server = state.servers[step.targetId];
    if (server && dropped.length > 0) server.files = server.files.filter((file) => !dropped.includes(file.name));
    state.flags = state.flags.filter((flag) => !dropped.some((name) => flag === `read:${step.targetId}/${name}`));
  }
}

/** The job's terms, while they can still be kept. */
function liveTerms(state: GameState, content: Content): { contract: ContractDef; terms: TermsDef } | undefined {
  const contract = active(state, content);
  if (!contract?.terms || state.contracts.termsBroken) return undefined;
  return { contract, terms: contract.terms };
}

/**
 * Watches the active job's terms: a trace under way on one of its servers
 * breaks "quiet", a long route to one breaks "light". Cheap when the job
 * has no terms. "Fast" is judged at delivery.
 */
export function watchTerms(state: GameState, content: Content): void {
  const live = liveTerms(state, content);
  if (!live || live.terms.kind === 'fast') return;
  const servers = jobServers(live.contract);
  const terms = live.terms;
  const broken = state.connections.some(
    (connection) => servers.includes(connection.serverId) && (terms.kind === 'quiet' ? connection.trace.status === 'active' : connection.route.length > terms.relays),
  );
  if (broken) state.contracts.termsBroken = true;
}

/** Whether the active job's terms stand right now. Undefined if it has none. */
export function termsKept(state: GameState, contract: ContractDef): boolean | undefined {
  const terms = contract.terms;
  if (!terms) return undefined;
  if (state.contracts.activeId !== contract.id) return true;
  if (state.contracts.termsBroken) return false;
  if (terms.kind === 'fast') return state.clock.gameTimeMs - state.contracts.takenMs <= terms.minutes * 60_000;
  return true;
}

/** Game minutes left to hand a "fast" job in for its bonus, or undefined. */
export function termsMinutesLeft(state: GameState, contract: ContractDef): number | undefined {
  const terms = contract.terms;
  if (terms?.kind !== 'fast' || state.contracts.activeId !== contract.id) return undefined;
  return Math.max(0, Math.round((state.contracts.takenMs + terms.minutes * 60_000 - state.clock.gameTimeMs) / 60_000));
}

/** The line a job's terms are shown as. */
export function termsLine(content: Content, terms: TermsDef): string {
  const lines = content.companies.jobs.side?.terms[terms.kind] ?? [];
  const values: Record<string, string> = { bonus: String(terms.bonus), minutes: terms.kind === 'fast' ? String(terms.minutes) : '', relays: terms.kind === 'light' ? String(terms.relays) : '' };
  const line = lines[terms.bonus % Math.max(1, lines.length)] ?? TERMS_FALLBACK[terms.kind];
  return line.replace(/\{(\w+)\}/g, (whole, name: string) => values[name] ?? whole);
}

const TERMS_FALLBACK: Readonly<Record<TermsDef['kind'], string>> = {
  quiet: 'Bonus of {bonus} credits if no trace gets under way on this job.',
  fast: 'Bonus of {bonus} credits if it is handed in within {minutes} game minutes.',
  light: 'Bonus of {bonus} credits if you never use more than {relays} relays.',
};

export const TERMS_NAMES: Readonly<Record<TermsDef['kind'], string>> = { quiet: 'Quietly', fast: 'Quickly', light: 'Short route' };

const NOBODY: PeopleDef = { people: [], facts: [], asks: [] };

/**
 * Everyone there is to write to: the written people, and whoever the job
 * being worked on has put within reach. Without a state, the written ones.
 */
export function peopleOf(content: Content, state?: GameState): PeopleDef {
  const extra = (state && active(state, content)?.phish) || NOBODY;
  if (extra === NOBODY) return content.people;
  return { people: [...content.people.people, ...extra.people], facts: [...content.people.facts, ...extra.facts], asks: [...content.people.asks, ...extra.asks] };
}
