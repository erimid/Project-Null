/**
 * The newer kinds of job, beside copy, delete, read and change a record:
 *
 * - guard: sit on a client's server as its administrator while a rival
 *   breaks in, and shut the ports they probe until the time is up. The
 *   gateway defence game, from the other side.
 * - hold (stay in): keep a login open on the target for a while as its
 *   trace runs, to keep a door open for someone else.
 * - hunt (find the hacker): a hacker's trail starts in the target's log.
 *   Each log on the way points at the next server; the last is theirs.
 * - swap: delete a file and put the client's doctored copy in its place.
 * - race: any job can be a race. Another hacker has it too, and if they
 *   finish first the job is gone.
 * - frame (leave a false trail) is older; see contracts.ts.
 *
 * Holding counts only while logged in on the target, and starts again
 * from nothing if the player leaves before the time is up. Once reached,
 * it stays reached.
 */
import type { ContractDef, ObjectiveDef, StageDef } from '../content/schema';
import { ringTolerance } from './tasks';
import { noteIntrusion } from './trace';
import { standsDown } from './events';
import type { Rng } from './rng';
import { stream } from './streams';
import { CLIENT_FILE, type Connection, type GameState, type GuardState, type RaidPort } from './state';
import { findConnection, findServer, sendMail, type Content } from './world';

/** Seconds a guard job's intruder needs to break in, as a share of the time the player must hold out. */
export const GUARD_BREACH_SHARE = 0.75;
/** Seconds shutting a port sets a guard job's intruder back; each one after sets them back less. */
export const GUARD_SETBACK_SECONDS = 14;
export const GUARD_FADE = 0.75;
/** Rings on a guard job's port line-up. */
export const GUARD_RINGS = 3;
/** Lines another runner leaves in a log for a wipe job: one more at the best-defended companies. */
export const WIPE_LINES = 2;

type Goal<K extends ObjectiveDef['kind']> = Extract<ObjectiveDef, { kind: K }>;

/** The step being worked on, if the active contract has one. */
function liveStage(state: GameState, content: Content): { contract: ContractDef; stage: StageDef } | undefined {
  const id = state.contracts.activeId;
  if (id === null) return undefined;
  const contract = content.contracts.find((item) => item.id === id) ?? state.contracts.jobs.find((job) => job.id === id);
  if (!contract) return undefined;
  const steps = [{ targetId: contract.targetId, objective: contract.objective }, ...(contract.stages ?? [])];
  const stage = steps[Math.max(0, Math.min(steps.length - 1, state.contracts.stage))]!;
  return { contract, stage };
}

/** How long a guard or stay-in step needs holding, in ms. */
export const holdNeedMs = (goal: Goal<'guard'> | Goal<'hold'>) => goal.seconds * 1000;

/** The connection logged in on a server, as the role a step needs, if there is one. */
function holding(state: GameState, serverId: string, admin: boolean): Connection | undefined {
  return state.connections.find((connection) => connection.serverId === serverId && connection.user !== null && (!admin || connection.role === 'admin'));
}

/** True once a step of one of the newer kinds is done. Undefined for the other kinds. */
export function kindMet(state: GameState, targetId: string, goal: ObjectiveDef, active: boolean): boolean | undefined {
  switch (goal.kind) {
    case 'guard':
    case 'hold':
      return active && state.contracts.heldMs >= holdNeedMs(goal);
    case 'hunt':
      return state.flags.includes(foundFlag(goal.trail[goal.trail.length - 1]!));
    case 'swap':
      return state.servers[targetId]?.files.some((file) => file.name === goal.file && file.doctored) ?? false;
    case 'wipe':
      // Their lines are written as the step begins, so only the step under way can be done.
      return active && !(state.servers[targetId]?.logs.some((entry) => entry.left === goal.who) ?? false);
    default:
      return undefined;
  }
}

/** True if a step of one of the newer kinds can still be done. Undefined for the other kinds. */
export function kindPossible(state: GameState, targetId: string, goal: ObjectiveDef, active: boolean): boolean | undefined {
  if (goal.kind === 'swap') {
    // Before the job is taken, the real file must be there to swap; after, the copy must still be at home.
    return active ? state.player.files.some((file) => file.name === goal.file && file.from === CLIENT_FILE) : (state.servers[targetId]?.files.some((file) => file.name === goal.file && !file.doctored) ?? false);
  }
  if (goal.kind === 'guard') return !state.contracts.guard || state.contracts.guard.breachMs < state.contracts.guard.totalMs || !active;
  return goal.kind === 'hold' || goal.kind === 'hunt' || goal.kind === 'wipe' ? true : undefined;
}

/** The flag that says the player has found a hacker's machine. */
export const foundFlag = (serverId: string) => `found:${serverId}`;

/**
 * Sets the world up as a step of one of the newer kinds begins: the
 * client's login for a guard job, the doctored copy for a swap, the trail
 * through the logs for a hunt.
 */
export function beginKind(state: GameState, content: Content, stage: StageDef): void {
  const goal = stage.objective;
  state.contracts.heldMs = 0;
  state.contracts.guard = null;
  const server = findServer(content, stage.targetId);
  const live = state.servers[stage.targetId];
  if (!server || !live) return;
  if (goal.kind === 'guard') {
    // The client hands over their administrator's login: no breaking in to your own client.
    const admin = server.accounts.find((account) => account.role === 'admin');
    if (admin) {
      const known = (state.player.passwords[server.id] ??= []);
      if (!known.includes(admin.user)) known.push(admin.user);
    }
  }
  if (goal.kind === 'swap' && !state.player.files.some((file) => file.name === goal.file && file.from === CLIENT_FILE)) {
    const real = live.files.find((file) => file.name === goal.file);
    state.player.files.push({ name: goal.file, sizeGq: real?.sizeGq ?? 1, from: CLIENT_FILE, doctored: true });
  }
  if (goal.kind === 'wipe' && !live.logs.some((entry) => entry.left === goal.who)) {
    // The lines the other runner left: a few, spread over the hours before the job came in.
    const rng = stream(state, 'wipe');
    const lines = content.companies.jobs.side?.wipe.lines ?? [];
    const count = WIPE_LINES + (server.generated && server.generated.tier >= 4 ? 1 : 0);
    const ip = `${rng.int(11, 223)}.${rng.int(1, 254)}.${rng.int(1, 254)}.${rng.int(2, 254)}`;
    for (let i = 0; i < count; i++) {
      const template = lines.length > 0 ? lines[(rng.int(0, lines.length - 1) + i) % lines.length]! : 'session {who} from {ip}';
      const text = template.replace('{who}', goal.who).replace('{ip}', ip);
      live.logs.push({ id: state.nextId++, timeMs: state.clock.gameTimeMs - rng.int(40, 340) * 60_000, text, byPlayer: false, left: goal.who });
    }
    live.logs.sort((a, b) => a.timeMs - b.timeMs);
  }
  if (goal.kind === 'hunt') {
    // Each server on the trail holds one line that points on to the next, a little before the job came in.
    const chain = [stage.targetId, ...goal.trail];
    for (let i = 0; i < chain.length - 1; i++) {
      const here = state.servers[chain[i]!];
      const prev = findServer(content, chain[i - 1] ?? '')?.address ?? '10.' + (40 + i) + '.' + (17 * i + 3) + '.9';
      const next = findServer(content, chain[i + 1]!);
      if (!here || !next || here.logs.some((entry) => entry.points === next.id)) continue;
      here.logs.push({ id: state.nextId++, timeMs: state.clock.gameTimeMs - (90 - i * 20) * 60_000, text: `relay opened ${prev} > ${next.address}`, byPlayer: false, points: next.id });
      here.logs.sort((a, b) => a.timeMs - b.timeMs);
    }
  }
}

/** Follows a line in a hacker's trail: the server it points at goes in the address book. */
export function followTrail(state: GameState, content: Content, connectionId: string, logId: number): string | null {
  const connection = findConnection(state, connectionId);
  if (!connection || connection.user === null) return 'Log in first.';
  if (connection.role !== 'admin') return 'Only an administrator can read the log.';
  const entry = state.servers[connection.serverId]?.logs.find((line) => line.id === logId);
  if (!entry?.points) return 'That line leads nowhere.';
  if (state.knownServers.includes(entry.points)) return 'You already have that address.';
  if (!findServer(content, entry.points)) return 'That line leads nowhere.';
  state.knownServers.push(entry.points);
  return null;
}

/** Notes a connection: reaching the end of a hacker's trail finds them. */
export function noteConnect(state: GameState, content: Content, serverId: string): void {
  const live = liveStage(state, content);
  const goal = live?.stage.objective;
  if (goal?.kind === 'hunt' && goal.trail[goal.trail.length - 1] === serverId && !state.flags.includes(foundFlag(serverId))) state.flags.push(foundFlag(serverId));
}

function newGuardPort(rng: Rng, level: number): RaidPort {
  const startAngles: number[] = [];
  const speeds: number[] = [];
  for (let i = 0; i < GUARD_RINGS; i++) {
    startAngles.push(rng.int(40, 320));
    speeds.push((i % 2 === 0 ? 1 : -1) * (60 + 25 * i) * (1 + 0.12 * (level - 1)));
  }
  return { startAngles, speeds, locked: startAngles.map(() => false), ageMs: 0 };
}

/** How hard the intruder on a guard job hits: the guarded company's tier, or 3 for a written server. */
const guardLevel = (content: Content, serverId: string) => findServer(content, serverId)?.generated?.tier ?? 3;

/**
 * Moves a guard or stay-in step on by `simMs`. Holding counts while the
 * player is logged in on the target; a guard job's intruder works on at
 * the same time and wins if they break in first. Stepping away resets the
 * hold, unless it was already reached. Returns true if the job was lost.
 */
export function advanceKinds(state: GameState, content: Content, simMs: number): boolean {
  const live = liveStage(state, content);
  if (!live) return false;
  const { contract, stage } = live;
  const goal = stage.objective;
  if (goal.kind !== 'guard' && goal.kind !== 'hold') return false;
  const need = holdNeedMs(goal);
  if (state.contracts.heldMs >= need) return false;
  const connection = holding(state, stage.targetId, goal.kind === 'guard');
  if (!connection) {
    state.contracts.heldMs = 0;
    if (state.contracts.guard) state.contracts.guard.port = null;
    return false;
  }
  if (goal.kind === 'hold' && connection.trace.status === 'none') {
    // Sitting in an account that is not yours is noticed: the trace runs while you hold.
    noteIntrusion(state, content, connection);
  }
  state.contracts.heldMs = Math.min(need, state.contracts.heldMs + simMs);
  if (goal.kind === 'guard') {
    const guard = (state.contracts.guard ??= { breachMs: 0, totalMs: need * GUARD_BREACH_SHARE, port: null, shut: 0 });
    if (guard.port) guard.port.ageMs += simMs;
    guard.breachMs += simMs;
    if (guard.breachMs >= guard.totalMs && state.contracts.heldMs < need) return loseGuard(state, content, contract);
  }
  return false;
}

function loseGuard(state: GameState, content: Content, contract: ContractDef): boolean {
  const server = findServer(content, contract.targetId);
  state.contracts.activeId = null;
  state.contracts.jobs = state.contracts.jobs.filter((job) => job.id !== contract.id);
  state.contracts.guard = null;
  state.contracts.heldMs = 0;
  sendMail(state, content, 'contractFailed', { client: contract.client, title: contract.title, target: server?.name ?? 'the server' });
  return true;
}

/** Opens a port line-up against the intruder on a guard job. */
export function openGuardPort(state: GameState, content: Content): string | null {
  const live = liveStage(state, content);
  const guard = state.contracts.guard;
  if (!live || live.stage.objective.kind !== 'guard' || !guard) return 'There is nobody to shut out.';
  if (!holding(state, live.stage.targetId, true)) return 'Log in on the server you are guarding first.';
  if (guard.port) return 'A port is already open.';
  guard.port = newGuardPort(stream(state, 'guard'), guardLevel(content, live.stage.targetId));
  return null;
}

/** Where a guard port's ring is now, in degrees from the marker. */
export function guardRingAngle(port: RaidPort, ring: number): number {
  if (port.locked[ring]) return 0;
  const angle = (port.startAngles[ring] ?? 0) + ((port.speeds[ring] ?? 0) * port.ageMs) / 1000;
  return ((angle % 360) + 360) % 360;
}

/** How far shutting the next port sets the intruder back. */
export const guardSetbackMs = (guard: GuardState) => GUARD_SETBACK_SECONDS * 1000 * GUARD_FADE ** guard.shut;

/** Tries to lock one ring of the guard port. Locking them all sets the intruder back. */
export function lockGuardRing(state: GameState, content: Content, ring: number): string | null {
  const guard = state.contracts.guard;
  const port = guard?.port;
  if (!guard || !port) return 'There is no port to line up.';
  if (port.locked[ring] === undefined) return 'No such ring.';
  if (port.locked[ring]) return 'That ring is already locked.';
  const angle = guardRingAngle(port, ring);
  if (Math.min(angle, 360 - angle) > ringTolerance(state, content)) return null;
  port.locked[ring] = true;
  if (port.locked.every((locked) => locked)) {
    guard.breachMs = Math.max(0, guard.breachMs - guardSetbackMs(guard));
    guard.shut += 1;
    guard.port = null;
  }
  return null;
}

/** Starts the race clock if the contract is a race. */
export function beginRace(state: GameState, content: Content, contract: ContractDef): void {
  // A rival who owes the player a favour stands down: no race. An open bounty's clock was running before it was taken.
  const race = contract.race && (contract.race.byMs !== undefined || !standsDown(state, content, contract.race.rival)) ? contract.race : undefined;
  state.contracts.raceUntilMs = race ? (race.byMs ?? state.clock.gameTimeMs + race.minutes * 60_000) : 0;
}

/** Loses a race the rival has won. True if the job was lost. */
export function checkRace(state: GameState, _content: Content, contract: ContractDef): boolean {
  if (!contract.race || state.contracts.raceUntilMs === 0 || state.clock.gameTimeMs <= state.contracts.raceUntilMs) return false;
  state.contracts.activeId = null;
  state.contracts.jobs = state.contracts.jobs.filter((job) => job.id !== contract.id);
  state.contracts.raceUntilMs = 0;
  state.player.files = state.player.files.filter((file) => file.from !== CLIENT_FILE);
  state.messages.push({
    id: `m${state.nextId++}`,
    from: contract.client,
    subject: `Re: ${contract.title}`,
    body: `${contract.race.rival} got there first. The job is closed.\n\nBetter luck next time.`,
    timeMs: state.clock.gameTimeMs,
    read: false,
    kind: 'work',
  });
  return true;
}

/** How far a rival in a race has got, 0 to 1, and the game time they finish. */
export function raceProgress(state: GameState, contract: ContractDef): { share: number; untilMs: number } | undefined {
  if (!contract.race || state.contracts.raceUntilMs === 0 || state.contracts.activeId !== contract.id) return undefined;
  const totalMs = contract.race.minutes * 60_000;
  const share = 1 - (state.contracts.raceUntilMs - state.clock.gameTimeMs) / totalMs;
  return { share: Math.max(0, Math.min(1, share)), untilMs: state.contracts.raceUntilMs };
}
