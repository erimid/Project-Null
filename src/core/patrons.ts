/**
 * Patrons: named clients with standing. A few post work on the board
 * under their own names and remember the player. Good standing pays
 * better, opens a shop discount and, at the top, one favour. Working
 * against what a patron looks after costs standing with them.
 *
 * Also the record of choices: how the player finished every contract
 * that offered a choice, by contract id. The story reads it later.
 *
 * A patron can work through a front: a written contract whose client is
 * not the patron's own name. Standing still moves, but no letter is sent
 * and nothing is shown, so the player is never told who really paid.
 */
import type { Favour, LetterKey, PatronDef } from '../content/patrons';
import type { ChoiceDef, ContractDef, ServerDef } from '../content/schema';
import { fill } from './generate';
import type { Rng } from './rng';
import { stagesOf } from './stages';
import type { GameState } from './state';
import { findServer, type Content } from './world';

/** Standing at which a patron trusts the player: better pay and a shop discount. */
export const TRUSTED = 4;
/** Standing at which a patron does the player their favour. */
export const INNER = 10;
/** Standing never goes outside this range. */
export const STANDING_RANGE = [-10, 20] as const;
/** What a trusting patron's own jobs pay, as a multiple of the usual. */
export const TRUSTED_PAY = 1.25;
/** Off the price at a trusting patron's shop. */
export const SHOP_DISCOUNT = 0.1;
/** Chance a board job against a sector a patron works in is posted by that patron. */
export const PATRON_SHARE = 0.45;
/** Fines and lying low are cut to this share by the patrons whose favour it is. */
export const FAVOUR_CUT = 0.5;
/** A warned player's gateway holds an intruder up this much longer. */
export const WARNED_BREACH = 1.25;

/** The choice recorded for a contract finished the usual way. */
export const DEFAULT_CHOICE = 'default';

export const STANDING_NAMES = [
  { min: -Infinity, name: 'Cold' },
  { min: 0, name: 'Known' },
  { min: TRUSTED, name: 'Trusted' },
  { min: INNER, name: 'Inner circle' },
] as const;

const patronsOf = (content: Content): readonly PatronDef[] => content.patrons ?? [];

export function findPatron(content: Content, id: string | undefined): PatronDef | undefined {
  return id === undefined ? undefined : patronsOf(content).find((patron) => patron.id === id);
}

export function standingWith(state: GameState, patronId: string): number {
  return state.patrons.standing[patronId] ?? 0;
}

/** The name of a standing: Cold, Known, Trusted or Inner circle. */
export function standingName(standing: number): string {
  return [...STANDING_NAMES].reverse().find((level) => standing >= level.min)!.name;
}

/** True if a patron is in a mood to do the player their favour right now. */
export function hasFavour(state: GameState, content: Content, favour: Favour): boolean {
  return patronsOf(content).some((patron) => patron.favour === favour && standingWith(state, patron.id) >= INNER);
}

/** The patron who does a favour, if the player has earned it. */
export function favourOf(state: GameState, content: Content, favour: Favour): PatronDef | undefined {
  return patronsOf(content).find((patron) => patron.favour === favour && standingWith(state, patron.id) >= INNER);
}

/** The share taken off prices at a shop by the patrons who trust the player. 0 for none. */
export function shopDiscount(state: GameState, content: Content, shopId: string): number {
  return patronsOf(content).some((patron) => patron.shop === shopId && standingWith(state, patron.id) >= TRUSTED) ? SHOP_DISCOUNT : 0;
}

/** True if the client on a contract is the patron under their own name (not a front, not hidden). */
export function openPatron(content: Content, contract: ContractDef): PatronDef | undefined {
  const patron = findPatron(content, contract.patron);
  return patron && !patron.hidden && patron.name === contract.client ? patron : undefined;
}

/** Patrons the player has met and can see, in the order they are written. */
export function knownPatrons(state: GameState, content: Content): PatronDef[] {
  return patronsOf(content).filter((patron) => !patron.hidden && state.patrons.met.includes(patron.id));
}

function letter(state: GameState, patron: PatronDef, key: LetterKey, values: Record<string, string> = {}): void {
  const written = patron.letters[key];
  if (!written) return;
  const all = { handle: state.player.handle, ...values };
  state.messages.push({
    id: `m${state.nextId++}`,
    from: patron.name,
    subject: fill(written.subject, all),
    body: fill(written.body, all),
    timeMs: state.clock.gameTimeMs,
    read: false,
  });
}

/**
 * Moves standing with a patron. Crossing into Trusted, the inner circle or
 * Cold brings a letter, once each, if the player knows who they are.
 */
export function shiftStanding(state: GameState, content: Content, patronId: string, delta: number): void {
  const patron = findPatron(content, patronId);
  if (!patron || delta === 0) return;
  const before = standingWith(state, patronId);
  const after = Math.max(STANDING_RANGE[0], Math.min(STANDING_RANGE[1], before + delta));
  state.patrons.standing[patronId] = after;
  if (patron.hidden || !state.patrons.met.includes(patronId)) return;
  const crossed = (line: number) => before < line && after >= line;
  const note = (key: LetterKey) => {
    const flag = `patron:${patronId}:${key}`;
    if (state.flags.includes(flag)) return;
    state.flags.push(flag);
    letter(state, patron, key);
  };
  if (crossed(TRUSTED)) note('trusted');
  if (crossed(INNER)) note('inner');
  if (before >= 0 && after < 0) note('cold');
}

/** Standing a delivered contract earns with the patron behind it. */
function standingFor(content: Content, contract: ContractDef): number {
  if ('expiresMs' in contract) {
    const tier = findServer(content, contract.targetId)?.generated?.tier ?? 1;
    return tier >= 4 ? 2 : 1;
  }
  return 2;
}

/**
 * Notes a delivered contract: records how it was finished, moves standing
 * with the patron behind it and with any patron whose companies it hurt,
 * and sends a first letter if the player has just met a patron.
 */
export function noteDelivery(state: GameState, content: Content, contract: ContractDef, choice: ChoiceDef | undefined): void {
  if (contract.choices && contract.choices.length > 0) state.patrons.choices[contract.id] = choice?.id ?? DEFAULT_CHOICE;
  const patron = findPatron(content, contract.patron);
  if (patron) {
    if (openPatron(content, contract) && !state.patrons.met.includes(patron.id)) {
      state.patrons.met.push(patron.id);
      letter(state, patron, 'met');
    }
    shiftStanding(state, content, patron.id, standingFor(content, contract));
  }
  for (const [id, delta] of Object.entries(choice?.standing ?? {})) shiftStanding(state, content, id, delta);
  // Hurting a company in a line of business a patron looks after costs standing with them, once per company.
  const hurt = new Set<string>();
  for (const stage of stagesOf(contract)) {
    const sector = findServer(content, stage.targetId)?.generated?.sector;
    if (!sector || hurt.has(stage.targetId) || stage.objective.kind === 'read') continue;
    hurt.add(stage.targetId);
    for (const other of patronsOf(content)) {
      if (other.id !== contract.patron && other.protects.includes(sector)) shiftStanding(state, content, other.id, -1);
    }
  }
}

/** A patron's job that was given up or lost costs a little standing. */
export function noteFailure(state: GameState, content: Content, contract: ContractDef, lost: boolean): void {
  if (contract.patron) shiftStanding(state, content, contract.patron, lost ? -2 : -1);
}

/**
 * Maybe hands a freshly made board job to a patron who works against that
 * company's line of business: their name on it, their voice at the top of
 * the brief, and better pay if they trust the player. Uses its own forked
 * stream, so it never moves the board's other draws.
 */
export function assignPatron(state: GameState, content: Content, job: ContractDef & { expiresMs: number }, server: ServerDef, rng: Rng): typeof job {
  const sector = server.generated?.sector;
  const able = patronsOf(content).filter(
    (patron) => !patron.hidden && sector !== undefined && patron.targets.includes(sector) && state.player.rating >= patron.minRating && standingWith(state, patron.id) >= 0,
  );
  if (able.length === 0 || !rng.chance(PATRON_SHARE)) return job;
  const patron = rng.pick(able);
  const trusted = standingWith(state, patron.id) >= TRUSTED;
  const values = { company: server.name, city: server.city };
  // A patron who knows the target well sends its security with the job.
  if (patron.favour === 'scanTargets' && standingWith(state, patron.id) >= INNER) {
    for (const stage of stagesOf(job)) if (!state.scanned.includes(stage.targetId)) state.scanned.push(stage.targetId);
  }
  return {
    ...job,
    client: patron.name,
    patron: patron.id,
    pay: trusted ? Math.round((job.pay * TRUSTED_PAY) / 50) * 50 : job.pay,
    brief: `${fill(rng.pick(patron.intro), values)}\n\n${job.brief}\n\n${patron.signoff}`,
  };
}

/** A patron with the raid-warning favour writes ahead of an attack. True if they did. */
export function warnOfRaid(state: GameState, content: Content, who: string): boolean {
  const patron = favourOf(state, content, 'raidWarning');
  if (!patron) return false;
  letter(state, patron, 'favour', { who });
  return true;
}

/**
 * Fills in the choice record for a save from before choices were kept:
 * a contract with a "keep" choice whose files are still on the gateway
 * was kept; every other finished contract with choices went the usual way.
 */
export function backfillChoices(state: GameState, content: Content): void {
  for (const id of state.contracts.completed) {
    const contract = content.contracts.find((item) => item.id === id);
    if (!contract?.choices || contract.choices.length === 0 || state.patrons.choices[id] !== undefined) continue;
    const keep = contract.choices.find((choice) => choice.keep);
    const files = stagesOf(contract).flatMap((stage) => (stage.objective.kind === 'steal' ? [{ name: stage.objective.file, from: stage.targetId }] : []));
    const kept = keep && files.length > 0 && files.every((file) => state.player.files.some((own) => own.name === file.name && own.from === file.from));
    state.patrons.choices[id] = kept ? keep.id : DEFAULT_CHOICE;
  }
}
