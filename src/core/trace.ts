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
  if (connection.trace.status !== 'none') return;
  const monitor = findServer(content, connection.serverId)?.security.monitor ?? 0;
  const graceSeconds = content.rules.monitorGraceSeconds[monitor] ?? 0;
  connection.trace.status = graceSeconds > 0 ? 'pending' : 'active';
  connection.trace.graceMs = graceSeconds * 1000;
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
    .sort((a, b) => traceReport(a.trace).remainingMs - traceReport(b.trace).remainingMs)[0];
}
