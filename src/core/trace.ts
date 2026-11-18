/**
 * The trace: the target working its way back along your route, relay by
 * relay, until it finds your gateway.
 */
import type { ServerDef } from '../content/schema';
import type { Connection, GameState, TraceState } from './state';
import { findServer, type Content } from './world';

/** How long the trace needs for each step back along a route, last relay first. */
export function traceHopMs(content: Content, target: ServerDef, route: readonly string[]): number[] {
  const perHopMs = target.traceSecondsPerHop * 1000;
  if (route.length === 0) return [perHopMs * content.rules.directTraceFactor];
  return [...route].reverse().map((id) => perHopMs * (findServer(content, id)?.relayDelay ?? 1));
}

export function newTrace(content: Content, target: ServerDef, route: readonly string[]): TraceState {
  const trace: TraceState = { status: 'none', graceMs: 0, elapsedMs: 0, hopMs: traceHopMs(content, target, route) };
  // The strongest monitors start tracing the moment a connection opens.
  if (target.security.monitor >= content.rules.monitorGraceSeconds.length) trace.status = 'active';
  return trace;
}

/**
 * Call when the player does something a monitor would notice (cracking,
 * bypassing, touching files or logs). Starts the countdown to a trace if
 * one isn't already under way.
 */
export function noteIntrusion(content: Content, connection: Connection): void {
  if (connection.trace.status !== 'none' || connection.monitor.blindMs > 0) return;
  const monitor = findServer(content, connection.serverId)?.security.monitor ?? 0;
  const graceSeconds = content.rules.monitorGraceSeconds[monitor] ?? 0;
  connection.trace.status = graceSeconds > 0 ? 'pending' : 'active';
  connection.trace.graceMs = graceSeconds * 1000;
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
  trace.elapsedMs += simMs;
  return trace.elapsedMs >= totalTraceMs(trace);
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

/** The connection whose trace will finish first, if any trace is running. */
export function mostUrgentTrace(state: GameState): Connection | undefined {
  return state.connections
    .filter((connection) => connection.trace.status === 'active')
    // A held trace is not closing in, so one that is moving comes first.
    .sort(
      (a, b) =>
        Number(a.monitor.blindMs > 0) - Number(b.monitor.blindMs > 0) ||
        traceReport(a.trace).remainingMs - traceReport(b.trace).remainingMs,
    )[0];
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
  if (connection.reroutes >= content.rules.maxReroutes) return 'This connection cannot be rerouted again.';
  const target = findServer(content, connection.serverId);
  const relay = findServer(content, serverId);
  if (!target || !relay || !state.knownServers.includes(relay.id)) return 'You do not have that address.';
  if (relay.kind === 'gateway' || relay.id === connection.serverId) return 'That server cannot be a relay here.';
  if (connection.route.includes(relay.id)) return `${relay.name} is already in the route.`;

  const step = connection.route.length - 1 - index;
  connection.route[index] = relay.id;
  connection.trace.hopMs[step] = target.traceSecondsPerHop * 1000 * relay.relayDelay;
  // Back to the start of this step.
  connection.trace.elapsedMs = connection.trace.hopMs.slice(0, step).reduce((sum, ms) => sum + ms, 0);
  connection.reroutes++;
  return null;
}
