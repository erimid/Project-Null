/**
 * The trace: the target working its way back along your route, relay by
 * relay, until it finds your gateway.
 */
import type { ServerDef } from '../content/schema';
import { MAX_HOPS, type Connection, type GameState, type TraceState } from './state';
import { monitorHeld } from './link';
import { installed } from './hardware';
import { effect } from './skills';
import { regionOf } from './generate';
import { findConnection, findServer, gatewayOf, ownedProgram, securityOf, type Content } from './world';
import { privateRelay } from './ladder';

/** What a leg of the route crosses: nothing much, a border, or a stretch of the world. */
export type LegKind = 'country' | 'border' | 'overseas';

/** What a trace has to cross to follow the leg between two servers. */
export function legKind(from: { readonly country: string; readonly lat: number; readonly lon: number }, to: typeof from): LegKind {
  if (from.country === to.country) return 'country';
  return regionOf(from) === regionOf(to) ? 'border' : 'overseas';
}

/** How much a leg of that kind stretches the trace step that follows it. */
export function legFactor(content: Content, kind: LegKind): number {
  const rules = content.rules;
  return kind === 'country' ? rules.sameCountryLegFactor : kind === 'border' ? rules.borderLegFactor : rules.overseasLegFactor;
}

/** How warm a relay is right now: 1 for each recent use, less what has cooled off since. */
export function relayHeat(state: GameState, content: Content, serverId: string): number {
  const mark = state.relayHeat[serverId];
  if (!mark) return 0;
  const cooled = (state.clock.gameTimeMs - mark.atMs) / (content.rules.relayCoolHours * 3_600_000);
  return Math.max(0, mark.heat - Math.max(0, cooled));
}

/** Marks a relay as used once more. */
export function warmRelay(state: GameState, content: Content, serverId: string): void {
  // A rival's rig the player kept is their own relay: nobody else's traffic, so it never warms.
  if (privateRelay(state, content, serverId)) return;
  state.relayHeat[serverId] = { heat: relayHeat(state, content, serverId) + 1, atMs: state.clock.gameTimeMs };
}

/** Forgets relays that have cooled all the way down. */
export function coolRelays(state: GameState, content: Content): void {
  for (const id of Object.keys(state.relayHeat)) if (relayHeat(state, content, id) <= 0) delete state.relayHeat[id];
}

/** True if the player holds a login on a server that asks for one. */
export const holdsLogin = (state: GameState, server: ServerDef): boolean =>
  server.security.password > 0 && (state.player.passwords[server.id]?.length ?? 0) > 0;

/**
 * How well a relay hides what passes through it: its own monitor's level,
 * and one more if the player holds a login there to tidy up behind them.
 */
export const relayCover = (state: GameState, relay: ServerDef): number => relay.security.monitor + (holdsLogin(state, relay) ? 1 : 0);

/** How many levels a relay falls short of what a target's monitor can see through. 0 if it holds. */
export const coverShortfall = (state: GameState, target: ServerDef, relay: ServerDef): number =>
  Math.max(0, target.security.monitor - relayCover(state, relay));

/**
 * What a relay is worth against one target, as a share of its full trace
 * step: less when the target's monitor outclasses it, and less while it
 * is warm from recent use. Without a game to look at it is worth all of it.
 */
export function relayWorth(content: Content, target: ServerDef, relay: ServerDef, state?: GameState): number {
  if (!state) return 1;
  const short = content.rules.coverShort;
  const cover = short[Math.min(short.length - 1, coverShortfall(state, target, relay))] ?? 1;
  return cover / (1 + content.rules.relayHeatSlow * relayHeat(state, content, relay.id));
}

/** What the trace step `step` places back from the target is worth: the first few in full, later ones less. */
export function stepFade(content: Content, step: number): number {
  const { relayFullSteps, relayFade } = content.rules;
  if (step < relayFullSteps || relayFade.length === 0) return 1;
  return relayFade[Math.min(relayFade.length - 1, step - relayFullSteps)]!;
}

export interface TraceLeg {
  /** Server ids at each end of the leg, the end nearer you first. */
  readonly fromId: string;
  readonly toId: string;
  readonly kind: LegKind;
  /** How long the trace needs to follow this leg back towards you. 0 for the one leg it never has to search. */
  readonly ms: number;
}

/**
 * The legs of a route from your gateway to the target, in that order,
 * with how long a trace needs for each. Each relay's step covers the leg
 * back towards you, so where that relay sits against the one before it
 * matters. The last leg, into the target, costs the trace nothing.
 */
export function traceLegs(content: Content, gatewayId: string, target: ServerDef, route: readonly string[], slow = 1, state?: GameState): TraceLeg[] {
  const ids = [gatewayId, ...route, target.id];
  const hopMs = traceHopMs(content, target, route, slow, gatewayId, state);
  const servers = ids.map((id) => findServer(content, id));
  return ids.slice(1).map((toId, index) => {
    const from = servers[index];
    const to = servers[index + 1];
    const kind = from && to ? legKind(from, to) : 'border';
    // With no relays the one step is the direct leg. Otherwise relay i's step is leg i, and the leg into the target is free.
    const ms = route.length === 0 ? hopMs[0]! : index < route.length ? hopMs[route.length - 1 - index]! : 0;
    return { fromId: ids[index]!, toId, kind, ms };
  });
}

/**
 * How long the trace needs for each step back along a route, last relay
 * first. `slow` comes from the player's skills. Each relay's step is
 * stretched by its own delay and by the leg back to the server before it.
 * With a game to look at, it is also cut by what the relay is worth
 * against this target right now (see `relayWorth`), and a trace gathers
 * pace: steps beyond the first few take less and less (see `stepFade`).
 */
export function traceHopMs(content: Content, target: ServerDef, route: readonly string[], slow = 1, gatewayId?: string, state?: GameState): number[] {
  const perHopMs = target.traceSecondsPerHop * 1000 * slow;
  const home = findServer(content, gatewayId ?? gatewayOf(content).id);
  const leg = (from: ServerDef | undefined, to: ServerDef | undefined) => (from && to ? legFactor(content, legKind(from, to)) : 1);
  if (route.length === 0) return [perHopMs * content.rules.directTraceFactor * leg(home, target)];
  const relays = route.map((id) => findServer(content, id));
  return relays
    .map((relay, index) => perHopMs * (relay?.relayDelay ?? 1) * leg(index === 0 ? home : relays[index - 1], relay) * (relay ? relayWorth(content, target, relay, state) : 1))
    .reverse()
    .map((ms, step) => ms * stepFade(content, step));
}

/** How many relays each version of a Route Planner will place, and what it takes into account. */
export const PLANNER_HOPS = [0, 4, 6, 8] as const;

/**
 * The route a Route Planner of this version builds from the servers the
 * player knows: never the target or a server already connected to.
 * Picked one hop at a time from the gateway outwards. Version 1 only
 * knows how slow each relay is. Version 2 also reads borders and oceans.
 * Version 3 also knows which relays the target sees through and which
 * are warm. None of them weighs where in the route a relay does most
 * good, so a route built by hand can beat them.
 */
export function bestRoute(state: GameState, content: Content, targetId: string | null, version = 3): string[] {
  const most = Math.min(maxHops(state, content), PLANNER_HOPS[Math.max(0, Math.min(3, version))] ?? 0);
  const target = targetId ? findServer(content, targetId) : undefined;
  const busy = new Set(state.connections.map((connection) => connection.serverId));
  const pool = state.knownServers
    .map((id) => findServer(content, id))
    .filter((server): server is ServerDef => !!server && server.kind !== 'gateway' && server.id !== targetId && !busy.has(server.id));
  const route: string[] = [];
  let at: ServerDef = gatewayOf(content);
  while (route.length < most && pool.length > 0) {
    let pick = 0;
    let best = -1;
    pool.forEach((server, index) => {
      let value = server.relayDelay;
      if (version >= 2) value *= legFactor(content, legKind(at, server));
      if (version >= 3) value *= target ? relayWorth(content, target, server, state) : 1 / (1 + content.rules.relayHeatSlow * relayHeat(state, content, server.id));
      if (value > best) [pick, best] = [index, value];
    });
    const [next] = pool.splice(pick, 1);
    route.push(next!.id);
    at = next!;
  }
  return route;
}

/** The trace sensor's level, 0 if none is fitted. A fitted sensor reads a running trace with no Trace Tracker. */
export const traceSense = (state: GameState, content: Content): number => installed(state, content, 'sensor')?.warn ?? 0;

/** True if the player can read how far a trace has got: a Trace Tracker program, or a trace sensor in the gateway. */
export const canReadTrace = (state: GameState, content: Content): boolean =>
  traceSense(state, content) > 0 || ownedProgram(state, content, 'traceTracker') !== undefined;

/** How much longer each step of a trace takes, from the Long way round skill. */
export const traceSlow = (state: GameState, content: Content): number => 1 + effect(state, content, 'traceSlow');

/** Most relays one route may pass through, with the player's skills. */
export const maxHops = (state: GameState, content: Content): number => MAX_HOPS + effect(state, content, 'ninthRelay');

/** Reroutes allowed on one connection, with the player's skills. */
export const maxReroutes = (state: GameState, content: Content): number => content.rules.maxReroutes + effect(state, content, 'slipAway');

export function newTrace(state: GameState, content: Content, target: ServerDef, route: readonly string[]): TraceState {
  const hopMs = traceHopMs(content, target, route, traceSlow(state, content), undefined, state);
  const trace: TraceState = { status: 'none', graceMs: 0, elapsedMs: 0, hopMs };
  if (target.untraced) return trace;
  // The strongest monitors start tracing the moment a connection opens.
  if (securityOf(state, target).monitor >= content.rules.monitorGraceSeconds.length) trace.status = 'active';
  return trace;
}

/**
 * Call when the player does something a monitor would notice (cracking,
 * bypassing, touching files or logs). Starts the countdown to a trace if
 * one isn't already under way.
 */
export function noteIntrusion(state: GameState, content: Content, connection: Connection): void {
  if (connection.trace.status !== 'none' || connection.monitor.blindMs > 0) return;
  if (findServer(content, connection.serverId)?.untraced) return;
  // A monitor whose alerts wait on a console the player is sitting at notices nothing.
  if (monitorHeld(state, content, connection)) return;
  const at = findServer(content, connection.serverId);
  const monitor = at ? securityOf(state, at).monitor : 0;
  const graceSeconds = (content.rules.monitorGraceSeconds[monitor] ?? 0) * (1 + effect(state, content, 'monitorGrace'));
  connection.trace.status = graceSeconds > 0 ? 'pending' : 'active';
  connection.trace.graceMs = graceSeconds * 1000;
}

/** True while the connection is logged in to an account a password protects. A monitor that can see notices that. */
export function intruding(content: Content, connection: Connection): boolean {
  return connection.role === 'admin' && (findServer(content, connection.serverId)?.security.password ?? 0) > 0;
}

/**
 * Counts down the time a monitor stays blind. Returns how much of `simMs`
 * is left over for the trace: nothing while the monitor is blind.
 */
export function advanceMonitor(connection: Connection, simMs: number): number {
  const monitor = connection.monitor;
  if (monitor.blindMs <= 0) return simMs;
  const left = simMs - monitor.blindMs;
  monitor.blindMs = Math.max(0, monitor.blindMs - simMs);
  if (monitor.blindMs > 0) return 0;
  // The monitor is back. The chance to stretch the time has gone with it.
  monitor.echo = null;
  return left;
}

/** Moves a trace forward. Returns true if it has just reached the gateway. */
export function advanceTrace(trace: TraceState, simMs: number): boolean {
  if (trace.status === 'pending') {
    trace.graceMs -= simMs;
    if (trace.graceMs > 0) return false;
    // Whatever time is left over after the grace period counts towards the trace itself.
    simMs = -trace.graceMs;
    trace.graceMs = 0;
    trace.status = 'active';
  }
  if (trace.status !== 'active') return false;
  // A Trace Jammer holds the trace still until its freeze runs out; the leftover then counts.
  const frozen = trace.frozenMs ?? 0;
  if (frozen > 0) {
    if (frozen >= simMs) {
      trace.frozenMs = frozen - simMs;
      return false;
    }
    trace.frozenMs = 0;
    simMs -= frozen;
  }
  trace.elapsedMs += simMs;
  return trace.elapsedMs >= totalTraceMs(trace);
}

/**
 * A Trace Jammer freezes one connection's trace for a while. It works
 * once per connection, and only on a trace that is already running.
 * Returns a reason if it can't be used.
 */
export function jamTrace(state: GameState, content: Content, connectionId: string): string | null {
  const program = ownedProgram(state, content, 'jamTrace');
  if (!program) return 'You do not own a Trace Jammer.';
  const connection = findConnection(state, connectionId);
  if (!connection) return 'That connection is closed.';
  if (connection.trace.status !== 'active') return 'There is no trace running on this connection.';
  if (connection.jammed) return 'The Trace Jammer only works once on a connection.';
  connection.jammed = true;
  connection.trace.frozenMs = (connection.trace.frozenMs ?? 0) + content.rules.traceJamSeconds * 1000 * program.version;
  return null;
}

export function totalTraceMs(trace: TraceState): number {
  return trace.hopMs.reduce((sum, ms) => sum + ms, 0);
}

export interface TraceReport {
  readonly active: boolean;
  /** 0 to 1. */
  readonly progress: number;
  readonly remainingMs: number;
  /** How many relays the trace has got past, counting back from the target. */
  readonly relaysTraced: number;
}

export function traceReport(trace: TraceState): TraceReport {
  const total = totalTraceMs(trace);
  const elapsed = Math.min(trace.elapsedMs, total);
  let relaysTraced = 0;
  let passed = 0;
  for (const ms of trace.hopMs) {
    passed += ms;
    if (elapsed >= passed) relaysTraced++;
  }
  return {
    active: trace.status === 'active',
    progress: total > 0 ? elapsed / total : 1,
    remainingMs: total - elapsed,
    relaysTraced,
  };
}

/** True while a connection's trace stands still: its monitor is blind, kept busy from another server, or jammed. */
export function traceHeld(state: GameState, content: Content, connection: Connection): boolean {
  return connection.monitor.blindMs > 0 || (connection.trace.frozenMs ?? 0) > 0 || monitorHeld(state, content, connection);
}

/** Every running trace, the one that will finish first at the front. A held trace is not closing in, so moving ones come first. */
export function tracesByUrgency(state: GameState, content: Content): Connection[] {
  return state.connections
    .filter((connection) => connection.trace.status === 'active')
    .sort(
      (a, b) =>
        Number(traceHeld(state, content, a)) - Number(traceHeld(state, content, b)) ||
        traceReport(a.trace).remainingMs - traceReport(b.trace).remainingMs,
    );
}

/** The connection whose trace will finish first, if any trace is running. */
export function mostUrgentTrace(state: GameState, content: Content): Connection | undefined {
  return tracesByUrgency(state, content)[0];
}

/** Index in the route of the relay the trace is working on right now. -1 if there is none. */
export function hopUnderTrace(connection: Connection): number {
  if (connection.trace.status !== 'active' || connection.route.length === 0) return -1;
  return connection.route.length - 1 - traceReport(connection.trace).relaysTraced;
}

/**
 * Swaps the relay the trace is working on for another server. The trace
 * has to start that step again, against the new relay. Returns a reason
 * if it can't be done.
 */
export function reroute(state: GameState, content: Content, connection: Connection, serverId: string): string | null {
  const index = hopUnderTrace(connection);
  if (connection.trace.status !== 'active') return 'There is no trace to get away from.';
  if (index < 0) return 'This connection has no relays to swap.';
  if (connection.reroutes >= maxReroutes(state, content)) return 'This connection cannot be rerouted again.';
  const target = findServer(content, connection.serverId);
  const relay = findServer(content, serverId);
  if (!target || !relay || !state.knownServers.includes(relay.id)) return 'You do not have that address.';
  if (relay.kind === 'gateway' || relay.id === connection.serverId) return 'That server cannot be a relay here.';
  if (connection.route.includes(relay.id)) return `${relay.name} is already in the route.`;

  const step = connection.route.length - 1 - index;
  connection.route[index] = relay.id;
  // The new relay changes its own step and the step of the relay after it, whose leg now starts at the new one.
  const fresh = traceHopMs(content, target, connection.route, traceSlow(state, content), undefined, state);
  warmRelay(state, content, relay.id);
  connection.trace.hopMs[step] = fresh[step]!;
  if (step > 0) connection.trace.hopMs[step - 1] = fresh[step - 1]!;
  // Back to the start of this step, or further with Slip away.
  const back = Math.max(0, step - effect(state, content, 'slipAway'));
  connection.trace.elapsedMs = connection.trace.hopMs.slice(0, back).reduce((sum, ms) => sum + ms, 0);
  connection.reroutes++;
  return null;
}
