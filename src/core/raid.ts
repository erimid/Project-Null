/**
 * Enemy hackers. Now and then someone breaks into your gateway, and you
 * fight back by point and click: close the ports they probe, trace them
 * back along their route for their address, lock what they are reaching
 * for, or pull the plug. Win the trace and their server is yours to raid.
 * Lose and they take credits, wipe a file, or frame you for a log review
 * — never your hardware, never your career.
 *
 * A random attack lands only while you are offline, is rare, has a long
 * cool-down and never comes in the first ratings. A story beat (step 5)
 * can send one straight away, even mid-connection.
 */
import type { RivalDef } from '../content/rivals';
import { CHORUS_ID } from '../content/chorus';
import type { StoryMail } from '../content/story';
import { fill } from './generate';
import { scheduleReview } from './forensics';
import { stream } from './streams';
import { gatewayOf, findServer, sendMail, type Content } from './world';
import { isConnected } from './state';
import { WARNED_BREACH, hasFavour, warnOfRaid } from './patrons';
import { runnerWarns } from './events';
import { noteBeaten, outOfRaids } from './ladder';
import { ringTolerance } from './tasks';
import { dropFromMemory } from './loadout';
import { wanted } from './wanted';
import { totalTraceMs, traceReport } from './trace';
import type { GameState, RaidPort, RaidState, TraceState } from './state';
import { noteRaidBeaten } from './record';

/** The rival hacker behind an attack, by id. Chorus (CHORUS_ID) stands in as a rival with no home and no route. */
export function findRival(content: Content, id: string): RivalDef | undefined {
  if (id === CHORUS_ID && content.chorus) {
    const c = content.chorus.rival;
    return { id: CHORUS_ID, handle: c.handle, blurb: c.blurb, homeId: '', relays: [], level: c.level, minRating: 0, style: c.style, taunt: c.taunt };
  }
  return content.rivals.find((rival) => rival.id === id);
}

/** True for an attack with nobody behind it to trace: Chorus. It is held off or unplugged, never traced. */
export function untraceable(raid: { readonly attackerId: string }): boolean {
  return raid.attackerId === CHORUS_ID;
}

/** Game ms the player must hold Chorus off for before it gives up, or undefined for an ordinary attack. */
export function holdOffMs(state: GameState, content: Content): number | undefined {
  const raid = state.raid;
  if (!raid || !untraceable(raid) || !content.chorus) return undefined;
  return Math.max(0, content.chorus.rival.holdSeconds * 1000 - (raid.ranMs ?? 0));
}

function chorusLetter(state: GameState, mail: StoryMail, values: Record<string, string> = {}): void {
  const all: Record<string, string> = { handle: state.player.handle, ...values };
  state.messages.push({ id: `m${state.nextId++}`, from: fill(mail.from, all), subject: fill(mail.subject, all), body: fill(mail.body, all), timeMs: state.clock.gameTimeMs, read: false, kind: 'story' });
}

/** The rival behind the attack under way, if any. */
export function raidRival(state: GameState, content: Content): RivalDef | undefined {
  return state.raid ? findRival(content, state.raid.attackerId) : undefined;
}

const MAX_RINGS = 5;

/** A fresh port line-up for an attacker of this level: more rings, turning faster, the harder they hit. */
function newPort(state: GameState, level: number): RaidPort {
  const rng = stream(state, 'raid');
  const rings = Math.min(MAX_RINGS, 2 + Math.floor(level / 2));
  const startAngles: number[] = [];
  const speeds: number[] = [];
  for (let i = 0; i < rings; i++) {
    startAngles.push(rng.int(40, 320));
    const direction = i % 2 === 0 ? 1 : -1;
    speeds.push(direction * (60 + 25 * i) * (1 + 0.12 * (level - 1)));
  }
  return { startAngles, speeds, locked: startAngles.map(() => false), ageMs: 0 };
}

/** Where a port ring's gap is right now, in degrees from the marker (0 to 360). */
export function raidPortAngle(port: RaidPort, ring: number): number {
  if (port.locked[ring]) return 0;
  const angle = (port.startAngles[ring] ?? 0) + ((port.speeds[ring] ?? 0) * port.ageMs) / 1000;
  return ((angle % 360) + 360) % 360;
}

/** The counter-trace back along a rival's route: even steps so the globe can walk it, hop by hop. */
function counterTrace(content: Content, rival: RivalDef): TraceState {
  const total = (content.rules.raidTraceSeconds[rival.level - 1] ?? 60) * 1000;
  const steps = Math.max(1, rival.relays.length);
  return { status: 'active', graceMs: 0, elapsedMs: 0, hopMs: Array.from({ length: steps }, () => total / steps) };
}

/**
 * Starts an attack right now. Used by a story beat straight away, and by
 * the scheduler once the player is offline. Replaces any pending attack.
 */
export function beginRaid(state: GameState, content: Content, attackerId: string, story = false): boolean {
  const rival = findRival(content, attackerId);
  if (!rival || state.raid) return false;
  const level = rival.level;
  state.raid = {
    attackerId,
    route: [...rival.relays],
    startedAtMs: state.clock.gameTimeMs,
    breachMs: 0,
    // A player who was warned (a patron's favour) is ready for a random attack: it takes longer to break in.
    breachTotalMs: (content.rules.raidBreachSeconds[level - 1] ?? 50) * 1000 * (!story && (hasFavour(state, content, 'raidWarning') || state.events.warned) ? WARNED_BREACH : 1),
    barriers: content.rules.raidBarriers[level - 1] ?? 3,
    port: null,
    traceBack: null,
    locked: [],
    result: 'open',
    story,
  };
  state.raidPending = null;
  if (!story) state.events.warned = false;
  if (attackerId === CHORUS_ID && content.chorus) chorusLetter(state, content.chorus.letters.raid);
  else sendMail(state, content, 'raid', { who: rival.handle, style: styleLine(rival) });
  return true;
}

/** Schedules an attack to land when the moment is right (offline, or at once for a story beat). */
export function scheduleRaid(state: GameState, content: Content, attackerId: string, story = false): void {
  if (!findRival(content, attackerId)) return;
  // A chance attack never stacks on one under way. A story attack waits its turn behind it instead of being lost.
  if (state.raid && !story) return;
  // A story attack takes the place of a chance one that was waiting; nothing takes the place of a story attack.
  if (state.raidPending && (state.raidPending.story || !story)) return;
  state.raidPending = { attackerId, story };
}

/**
 * After a job is delivered, maybe line up a random attack: only at a high
 * enough rating, only after a high-profile job, rarely, and never during
 * the cool-down. The roll is on a stream of its own so it never shifts the
 * rest of the game.
 */
export function maybeScheduleRaid(state: GameState, content: Content, pay: number): void {
  const rules = content.rules;
  if (content.rivals.length === 0 || state.raid || state.raidPending) return;
  if (state.player.rating < rules.raidMinRating) return;
  if (state.clock.gameTimeMs < state.raidQuietUntilMs) return;
  if (pay < rules.raidProfilePay) return;
  const rng = stream(state, 'raid');
  // A bounty on a wanted player brings them more often.
  const bounty = wanted(state).raids;
  if (!rng.chance(Math.min(1, rules.raidChance * bounty))) return;
  // A raider whose address was sold, or who has a truce with the player, stays away.
  const able = content.rivals.filter((rival) => !rival.storyOnly && rival.minRating <= state.player.rating && !outOfRaids(state, rival.id));
  if (able.length === 0) return;
  const rival = rng.pick(able);
  state.raidPending = { attackerId: rival.id, story: false };
  warnOfRaid(state, content, rival.handle);
  // So does a runner who owes the player a favour (see events.ts).
  runnerWarns(state, content, rival.handle);
  // Even a scheduled attack starts the clock on the next one.
  state.raidQuietUntilMs = state.clock.gameTimeMs + (rules.raidCooldownHours / bounty) * 3_600_000;
}

/** Begins a pending attack once the moment is right. Called each tick. */
export function beginPendingRaid(state: GameState, content: Content): void {
  const pending = state.raidPending;
  if (!pending || state.raid) return;
  // A random attack waits until you are offline; a story attack lands at once.
  if (!pending.story && isConnected(state)) return;
  beginRaid(state, content, pending.attackerId, pending.story);
}

/**
 * Moves an attack forward. The counter-trace is checked first, so a dead
 * heat goes to the player. Closing a port sets the break-in back; if the
 * intruder breaks all the way in first, the attack is lost.
 */
export function advanceRaid(state: GameState, content: Content, simMs: number): void {
  const raid = state.raid;
  if (!raid || raid.result !== 'open') return;
  if (raid.port) raid.port.ageMs += simMs;
  if (raid.traceBack && raid.traceBack.status === 'active') {
    raid.traceBack.elapsedMs += simMs;
    if (raid.traceBack.elapsedMs >= totalTraceMs(raid.traceBack)) return winRaid(state, content);
  }
  raid.breachMs += simMs;
  if (raid.breachMs >= raid.breachTotalMs) return loseRaid(state, content);
  if (untraceable(raid)) raid.ranMs = (raid.ranMs ?? 0) + simMs;
  // Nobody behind it to trace: kept out long enough, it gives up.
  if (holdOffMs(state, content) === 0) {
    state.raid = null;
    if (content.chorus) chorusLetter(state, content.chorus.letters.held);
  }
}

/** Which barrier the intruder is on now, 0-based. */
export function raidBarrier(raid: RaidState): number {
  const per = raid.breachTotalMs / Math.max(1, raid.barriers);
  return Math.max(0, Math.min(raid.barriers - 1, Math.floor(raid.breachMs / per)));
}

export interface RaidReport {
  /** How far the break-in has got, 0 to 1. */
  readonly breach: number;
  readonly breachRemainingMs: number;
  readonly barrier: number;
  /** The counter-trace, 0 to 1, or null if none is running. */
  readonly trace: number | null;
  readonly traceRemainingMs: number;
}

export function raidReport(raid: RaidState): RaidReport {
  const trace = raid.traceBack ? traceReport(raid.traceBack) : null;
  return {
    breach: Math.min(1, raid.breachMs / raid.breachTotalMs),
    breachRemainingMs: Math.max(0, raid.breachTotalMs - raid.breachMs),
    barrier: raidBarrier(raid),
    trace: trace ? trace.progress : null,
    traceRemainingMs: trace ? trace.remainingMs : 0,
  };
}

/**
 * How far shutting the next port sets the intruder back. The first costs
 * them the most; they learn, and each one after costs them less, so ports
 * buy time for the trace and never hold an attack off for good.
 */
export function raidSetbackMs(raid: RaidState, content: Content): number {
  return content.rules.raidPortSetbackSeconds * 1000 * content.rules.raidPortFade ** (raid.shut ?? 0);
}

/** Opens a port line-up on the barrier the intruder is probing, for the player to shut by hand. */
export function openRaidPort(state: GameState, content: Content): string | null {
  const raid = state.raid;
  if (!raid || raid.result !== 'open') return 'There is no attack to fight.';
  if (raid.port) return 'A port is already open.';
  const rival = findRival(content, raid.attackerId);
  raid.port = newPort(state, rival?.level ?? 1);
  return null;
}

/**
 * Tries to lock one ring of the open port. A hit within tolerance locks
 * it; locking every ring shuts the intruder out of this barrier and sets
 * the break-in back. A miss does nothing but let the ring come round again.
 */
export function lockRaidRing(state: GameState, content: Content, ring: number): string | null {
  const raid = state.raid;
  const port = raid?.port;
  if (!raid || !port || raid.result !== 'open') return 'There is no port to line up.';
  if (port.locked[ring] === undefined) return 'No such ring.';
  if (port.locked[ring]) return 'That ring is already locked.';
  const angle = raidPortAngle(port, ring);
  if (Math.min(angle, 360 - angle) > ringTolerance(state, content)) return null;
  port.locked[ring] = true;
  if (port.locked.every((locked) => locked)) {
    raid.breachMs = Math.max(0, raid.breachMs - raidSetbackMs(raid, content));
    raid.shut = (raid.shut ?? 0) + 1;
    raid.port = null;
  }
  return null;
}

/** Starts the counter-trace back along the attacker's route. */
export function startRaidTrace(state: GameState, content: Content): string | null {
  const raid = state.raid;
  if (!raid || raid.result !== 'open') return 'There is no attack to trace.';
  if (raid.traceBack) return 'You are already tracing them.';
  const rival = findRival(content, raid.attackerId);
  if (!rival || untraceable(raid)) return 'There is nobody at the other end to trace.';
  raid.traceBack = counterTrace(content, rival);
  return null;
}

/** Locks a file or program on the gateway so a loss cannot take it. */
export function lockRaidFile(state: GameState, content: Content, name: string): string | null {
  const raid = state.raid;
  if (!raid || raid.result !== 'open') return 'There is no attack under way.';
  if (raid.locked.includes(name)) return 'That is already locked.';
  if (raid.locked.length >= content.rules.raidMaxLocks) return `You can lock ${content.rules.raidMaxLocks} at a time.`;
  const owned = state.player.files.some((file) => file.name === name) || state.player.programs.includes(name);
  if (!owned) return 'You have nothing by that name.';
  raid.locked.push(name);
  return null;
}

/** Pulls the plug: the attack ends with nothing learned and nothing lost, and every connection drops. */
export function pullPlug(state: GameState, content: Content): string | null {
  const raid = state.raid;
  if (!raid || raid.result !== 'open') return 'There is no attack to break off.';
  const rival = findRival(content, raid.attackerId);
  state.connections = [];
  state.tasks = [];
  state.raid = null;
  if (untraceable(raid) && content.chorus) chorusLetter(state, content.chorus.letters.fled);
  else sendMail(state, content, 'raidFled', { who: rival?.handle ?? 'The intruder' });
  return null;
}

/** One line on what a rival does if they win, for the warning message. */
function styleLine(rival: RivalDef): string {
  return rival.style === 'thief' ? 'drain your credits' : rival.style === 'vandal' ? 'wipe something you keep here' : 'frame you for a break-in';
}

/** The counter-trace reached their end: learn their address and clear the attack. */
function winRaid(state: GameState, content: Content): void {
  const raid = state.raid;
  const rival = raid && findRival(content, raid.attackerId);
  if (!raid || !rival) {
    if (state.raid) state.raid = null;
    return;
  }
  if (!state.knownServers.includes(rival.homeId) && findServer(content, rival.homeId)) {
    state.knownServers.push(rival.homeId);
  }
  if (!state.flags.includes(`beat:${rival.id}`)) state.flags.push(`beat:${rival.id}`);
  const home = findServer(content, rival.homeId);
  state.raid = null;
  noteRaidBeaten(state);
  sendMail(state, content, 'raidWon', { who: rival.handle, home: home?.name ?? 'their server', address: home?.address ?? '' });
  if (content.ladder?.rivals.some((entry) => entry.id === rival.id) && !state.ladder.outcomes[rival.id]) {
    noteBeaten(state, content, rival.id);
    state.messages[state.messages.length - 1]!.body += `\n\nWhat you do about ${rival.handle} is up to you: sell the address, keep the rig as your own relay, or call a truce. The Ladder at the Backroom has the choices.`;
  }
}

/** The intruder broke in: apply what their style costs, then clear the attack. */
function loseRaid(state: GameState, content: Content): void {
  const raid = state.raid;
  const rival = raid && findRival(content, raid.attackerId);
  if (!raid || !rival) {
    if (state.raid) state.raid = null;
    return;
  }
  const locked = new Set(raid.locked);
  let loss = '';
  // Chorus goes first for what it thinks the player is better off without.
  // Once it is awake, so does anyone else who comes: what the player is holding is what everyone wants.
  const awake = content.chorus !== undefined && state.flags.includes(content.chorus.awakeFlag);
  const target = untraceable(raid) || awake ? state.player.files.find((item) => !locked.has(item.name) && content.chorus!.rival.targets.includes(item.name)) : undefined;
  if (target) {
    state.player.files = state.player.files.filter((item) => item !== target);
    loss = `took ${target.name} from your gateway`;
  } else if (rival.style === 'vandal') {
    const file = state.player.files.find((item) => !locked.has(item.name));
    const program = state.player.programs.find((id) => !locked.has(id) && !content.startingPrograms.includes(id));
    if (file) {
      state.player.files = state.player.files.filter((item) => item !== file);
      loss = `wiped ${file.name} from your gateway`;
    } else if (program) {
      state.player.programs = state.player.programs.filter((id) => id !== program);
      state.player.builds = state.player.builds.filter((build) => build.id !== program);
      dropFromMemory(state, program);
      loss = `wiped ${content.programs.find((p) => p.id === program)?.name ?? program} from your gateway`;
    } else {
      loss = takeCredits(state, content) ? 'drained credits from your account' : 'found nothing worth taking';
    }
  } else if (rival.style === 'framer') {
    loss = frame(state, content) ? 'planted evidence: a log review is coming your way' : takeCredits(state, content) ? 'took credits instead' : 'found nothing to use';
  } else {
    loss = takeCredits(state, content) ? 'drained credits from your account' : 'found nothing worth taking';
  }
  state.raid = null;
  if (untraceable(raid) && content.chorus) chorusLetter(state, content.chorus.letters.lost, { loss, taunt: rival.taunt });
  else sendMail(state, content, 'raidLost', { who: rival.handle, loss, taunt: rival.taunt });
}

/** Thief's loss: a slice of the balance. Returns false if there was nothing to take. */
function takeCredits(state: GameState, content: Content): boolean {
  const take = Math.round(state.player.balance * content.rules.raidLossCredits);
  if (take <= 0) return false;
  state.player.balance -= take;
  return true;
}

/** Framer's loss: plant an evidence line on a company the player knows and book a review of it. */
function frame(state: GameState, content: Content): boolean {
  const server = state.knownServers
    .map((id) => findServer(content, id))
    .find((item): item is NonNullable<typeof item> => !!item && item.kind === 'company' && !!state.servers[item.id]);
  if (!server) return false;
  const serverState = state.servers[server.id]!;
  serverState.logs.push({ id: state.nextId++, timeMs: state.clock.gameTimeMs - 30 * 60_000, text: `login ${server.accounts.find((a) => a.role === 'admin')?.user ?? 'admin'} from ${gatewayOf(content).address}`, byPlayer: true });
  serverState.logs.sort((a, b) => a.timeMs - b.timeMs);
  scheduleReview(state, content, server.id);
  return true;
}
