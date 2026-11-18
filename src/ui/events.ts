/**
 * Things that just happened in the game, worked out by comparing the
 * game before and after each change. Alerts and sounds listen to these,
 * so the simulation itself never needs to know about either.
 */
import { findServer, type Content, type GameState } from '../core';

export type GameEvent =
  | { readonly type: 'connected'; readonly server: string }
  /** `traced` is true when the trace cut the connection, false when the player closed it. */
  | { readonly type: 'disconnected'; readonly server: string; readonly traced: boolean }
  | { readonly type: 'traceStarted'; readonly server: string }
  | { readonly type: 'programStarted' }
  | { readonly type: 'programFinished' }
  | { readonly type: 'loggedIn' }
  | { readonly type: 'message' }
  | { readonly type: 'paid' }
  | { readonly type: 'spent' };

/** The parts of the game that events are worked out from. */
export interface Snapshot {
  readonly connections: ReadonlyMap<string, { serverId: string; tracing: boolean; user: string | null }>;
  readonly tasks: ReadonlySet<string>;
  readonly messages: number;
  readonly balance: number;
}

export function snapshot(state: GameState): Snapshot {
  return {
    connections: new Map(
      state.connections.map((c) => [c.id, { serverId: c.serverId, tracing: c.trace.status === 'active', user: c.user }]),
    ),
    tasks: new Set(state.tasks.map((task) => task.id)),
    messages: state.messages.length,
    balance: state.player.balance,
  };
}

/**
 * What changed between two snapshots. `byClock` is true when the change
 * came from time passing and not from something the player did.
 */
export function diff(before: Snapshot, after: Snapshot, content: Content, byClock: boolean): GameEvent[] {
  const events: GameEvent[] = [];
  const name = (serverId: string) => findServer(content, serverId)?.name ?? serverId;

  for (const [id, was] of before.connections) {
    const now = after.connections.get(id);
    // Only a finished trace closes a connection while the clock runs.
    if (!now) events.push({ type: 'disconnected', server: name(was.serverId), traced: byClock });
    else {
      if (!was.tracing && now.tracing) events.push({ type: 'traceStarted', server: name(now.serverId) });
      if (was.user === null && now.user !== null) events.push({ type: 'loggedIn' });
    }
  }
  for (const [id, now] of after.connections) {
    if (!before.connections.has(id)) events.push({ type: 'connected', server: name(now.serverId) });
  }

  if ([...after.tasks].some((id) => !before.tasks.has(id))) events.push({ type: 'programStarted' });
  // A program that stops while the clock runs has finished; the player stopping one is not news.
  if (byClock && [...before.tasks].some((id) => !after.tasks.has(id)) && after.connections.size >= before.connections.size) {
    events.push({ type: 'programFinished' });
  }
  if (after.messages > before.messages) events.push({ type: 'message' });
  if (after.balance > before.balance) events.push({ type: 'paid' });
  if (after.balance < before.balance) events.push({ type: 'spent' });
  return events;
}
