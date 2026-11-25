/**
 * Heists: big jobs done over several connections at once.
 *
 * The target is the vault. Some of its layers are run from other servers
 * (the holds). While a heist is under way, each of those layers sits at
 * the top level, and drops to nothing while the player is logged in on
 * the hold as its administrator, or while an ally holds it for them. So
 * the usual way in is: open a line to each hold, take its desk, keep it,
 * and lift the file from the vault on another line, with every one of
 * those lines traced on its own.
 *
 * Being caught anywhere while a heist is under way burns it: the job is
 * lost, a written heist is never offered again, and the client says so.
 * Giving it up burns it too.
 *
 * Written heists (contracts.json) and their holds may carry conditions,
 * so the story can decide who helps by what the player has done. The
 * board also posts its own heists, one at most, from the upper tiers.
 */
import type { ContractDef, HoldLayer } from '../content/schema';
import { MAX_LAYER_LEVEL } from '../content/schema';
import { fill } from './generate';
import { claimedFiles, touchedServers, tierForRating } from './jobs';
import { editionDay } from './news';
import { conditionMet } from './conditions';
import { noteFailure } from './patrons';
import { maxConnections } from './hardware';
import { stream } from './streams';
import { scheduleRaid } from './raid';
import type { ActiveHeist, GameState, Job } from './state';
import { heistHeld, type Content } from './world';

/** The level an unheld layer of the vault sits at during a heist. */
export const LOCKDOWN = MAX_LAYER_LEVEL;
/** The player's tier (see tierForRating) from which the board posts heists. */
export const HEIST_TIER = 4;
/** Chance each game day that the board posts a heist, when it has none. */
export const HEIST_CHANCE = 0.6;
/** What a board heist pays, and the rating it gives, as multiples of an ordinary job at the vault's tier. */
export const HEIST_PAY = 4;
export const HEIST_RATING = 3;
/** How long a board heist stays up, in game hours. */
export const HEIST_HOURS = 48;
/** Servers a board heist asks the player to hold. */
export const BOARD_HOLDS: readonly HoldLayer[] = ['firewall', 'monitor'];

export { conditionMet };

/** How the heist would stand if taken now: who holds what. Allies are decided here, once. */
export function planHeist(state: GameState, contract: ContractDef): ActiveHeist | undefined {
  if (!contract.heist) return undefined;
  const slow = (contract.heist.slow ?? []).filter((help) => conditionMet(state, help.when)).reduce((total, help) => total * help.factor, 1);
  return {
    vaultId: contract.targetId,
    holds: contract.heist.holds.map((hold) => ({
      targetId: hold.targetId,
      layer: hold.layer,
      ...(hold.ally && conditionMet(state, hold.ally.when) ? { ally: hold.ally.name, ...(hold.ally.seconds ? { allyMs: hold.ally.seconds * 1000 } : {}) } : {}),
    })),
    ...(slow !== 1 ? { slow } : {}),
  };
}

/** Lines the player needs open at once: one per hold nobody else keeps, and one for the vault. */
export function heistLines(state: GameState, contract: ContractDef): number {
  const plan = planHeist(state, contract);
  return plan ? plan.holds.filter((hold) => !hold.ally).length + 1 : 1;
}

/** Why the player cannot take a heist with the gateway they have, or null. */
export function heistRefusal(state: GameState, content: Content, contract: ContractDef): string | null {
  if (!contract.heist) return null;
  const need = heistLines(state, contract);
  const have = maxConnections(state, content);
  return have < need ? `This plan needs ${need} lines open at once. Your gateway holds ${have}.` : null;
}

/** The attacker a heist would send at the gateway if taken now, if any. */
export function heistAttacker(state: GameState, contract: ContractDef): string | undefined {
  return contract.heist?.attackers?.find((attacker) => conditionMet(state, attacker.when))?.rival;
}

/** Sets the heist up as it is taken, and sends whoever the player's past has set against them. */
export function beginHeist(state: GameState, content: Content, contract: ContractDef): void {
  state.contracts.heist = planHeist(state, contract) ?? null;
  const attacker = state.contracts.heist ? heistAttacker(state, contract) : undefined;
  if (attacker) scheduleRaid(state, content, attacker, true);
}

/** Each hold of the heist under way, and whether it is kept right now. */
export function heistStatus(state: GameState): { targetId: string; layer: HoldLayer; ally?: string; allyMs?: number; held: boolean }[] {
  return (state.contracts.heist?.holds ?? []).map((hold) => ({ ...hold, held: heistHeld(state, hold) }));
}

/**
 * Counts a timed ally's time down while the player has a line into the
 * vault (simulated time, like a trace). At zero they let go, and the
 * door is the player's to hold.
 */
export function advanceHeist(state: GameState, simMs: number): void {
  const heist = state.contracts.heist;
  if (!heist || !state.connections.some((connection) => connection.serverId === heist.vaultId)) return;
  for (const hold of heist.holds) {
    if (hold.ally !== undefined && hold.allyMs !== undefined && hold.allyMs > 0) hold.allyMs = Math.max(0, hold.allyMs - simMs);
  }
}

/** Who would have held each door of a heist, had the player's past been different: holds with an ally who is not coming. */
export function absentAllies(state: GameState, contract: ContractDef): { targetId: string; name: string }[] {
  return (contract.heist?.holds ?? []).flatMap((hold) => (hold.ally && !conditionMet(state, hold.ally.when) ? [{ targetId: hold.targetId, name: hold.ally.name }] : []));
}

/**
 * Burns the heist under way: the job is lost, a written one is never
 * offered again, and the client writes. Returns true if there was one.
 */
export function burnHeist(state: GameState, content: Content, contract: ContractDef | undefined): boolean {
  if (!state.contracts.heist || !contract?.heist) return false;
  noteFailure(state, content, contract, true);
  state.contracts.activeId = null;
  state.contracts.heist = null;
  // A story heist that must not be lost stays on the board, at a cost.
  const retry = contract.heist.retryFine;
  if (retry !== undefined) {
    const fine = Math.min(state.player.balance, retry);
    state.player.balance -= fine;
    state.messages.push({
      id: `m${state.nextId++}`,
      from: contract.client,
      subject: `Re: ${contract.title}`,
      body: `That went wrong, and it cost${fine > 0 ? ` ${fine} credits to cover our tracks` : ' us all a night'}. The job is still on your board. When you are ready, we go again.`,
      timeMs: state.clock.gameTimeMs,
      read: false,
    });
    return true;
  }
  state.contracts.jobs = state.contracts.jobs.filter((job) => job.id !== contract.id);
  if (!('expiresMs' in contract) && !state.contracts.burned.includes(contract.id)) state.contracts.burned.push(contract.id);
  state.messages.push({
    id: `m${state.nextId++}`,
    from: contract.client,
    subject: `Re: ${contract.title}`,
    body: 'The plan is burned. Everyone involved is walking away, and so should you.\n\nDo not contact us about this again.',
    timeMs: state.clock.gameTimeMs,
    read: false,
  });
  return true;
}

/**
 * Once a game day, from the upper tiers, maybe posts a heist on the board
 * against a company with something worth lifting. One at most at a time,
 * on top of the usual jobs.
 */
export function postHeist(state: GameState, content: Content): Job | undefined {
  const words = content.companies.jobs.heist;
  if (!words) return undefined;
  const now = state.clock.gameTimeMs;
  const day = editionDay(now);
  if (state.contracts.heistDay === day) return undefined;
  state.contracts.heistDay = day;
  const tier = tierForRating(state.player.rating, content.rules.tierRatings);
  if (tier < HEIST_TIER || state.contracts.jobs.some((job) => job.heist)) return undefined;
  const rng = stream(state, 'heists');
  if (!rng.chance(HEIST_CHANCE)) return undefined;
  const busy = touchedServers(state);
  for (const connection of state.connections) busy.add(connection.serverId);
  // Two companies in one trade keep files of the same name: never one a job on the board already asks for.
  const claimed = claimedFiles(state);
  const files = (serverId: string) =>
    (state.servers[serverId]?.files ?? []).filter((file) => {
      if (file.access !== 'admin' || claimed.has(file.name) || state.player.files.some((own) => own.name === file.name)) return false;
      const written = content.servers.find((server) => server.id === serverId)?.files.find((item) => item.name === file.name);
      return !written?.part && !written?.program;
    });
  const vaults = content.servers.filter((server) => server.generated && server.generated.tier >= tier - 1 && !busy.has(server.id) && files(server.id).length > 0);
  if (vaults.length === 0) return undefined;
  const vault = rng.pick(vaults);
  const vaultTier = vault.generated!.tier;
  const desks = rng.shuffle(
    content.servers.filter((server) => server.generated && server.id !== vault.id && !busy.has(server.id) && server.generated.tier <= vaultTier && server.accounts.some((account) => account.role === 'admin')),
  );
  if (desks.length < BOARD_HOLDS.length) return undefined;
  const file = rng.pick(files(vault.id)).name;
  const holds = BOARD_HOLDS.map((layer, i) => ({ targetId: desks[i]!.id, layer, note: rng.pick(words.notes[layer]) }));
  const values = { company: vault.name, city: vault.city, file, holds: holds.map((hold) => desks.find((desk) => desk.id === hold.targetId)!.name).join(' and ') };
  const job: Job = {
    id: `job-${state.nextId++}`,
    title: fill(rng.pick(words.titles), values),
    client: rng.pick(content.companies.jobs.clients),
    targetId: vault.id,
    pay: Math.round(((content.rules.jobPay[vaultTier - 1] ?? 0) * HEIST_PAY) / 50) * 50,
    rating: (content.rules.jobRatings[vaultTier - 1] ?? 1) * HEIST_RATING,
    minRating: 0,
    summary: fill(rng.pick(words.summaries), values),
    brief: fill(rng.pick(words.briefs), values),
    objective: { kind: 'steal', file },
    expiresMs: now + HEIST_HOURS * 3_600_000,
    heist: { holds },
  };
  state.contracts.jobs.push(job);
  return job;
}
