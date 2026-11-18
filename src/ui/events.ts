/**
 * Things that just happened in the game, worked out by comparing the
 * game before and after each change. Alerts and sounds listen to these,
 * so the simulation itself never needs to know about either.
 */
import { findServer, pointsSpent, type Content, type GameState } from '../core';
import { gameInfo } from '../content';

const titleOf = (rating: number) => gameInfo.ratings.findLast((level) => rating >= level.min)?.title;

export type GameEvent =
  | { readonly type: 'connected'; readonly server: string }
  /** `traced` is true when the trace cut the connection; `pulled` when a watching model cut it just in time. */
  | { readonly type: 'disconnected'; readonly server: string; readonly traced: boolean; readonly pulled: boolean }
  | { readonly type: 'traceStarted'; readonly server: string }
  | { readonly type: 'programStarted' }
  | { readonly type: 'programFinished' }
  | { readonly type: 'loggedIn' }
  | { readonly type: 'message' }
  | { readonly type: 'paid' }
  | { readonly type: 'spent' }
  /** The rating crossed into a higher title. */
  | { readonly type: 'promoted'; readonly title: string }
  /** The best rating earned another skill point. `free` is how many are now unspent. */
  | { readonly type: 'pointEarned'; readonly free: number }
  | { readonly type: 'skillLearned' }
  | { readonly type: 'skillsUnlearned' }
  /** A build finished at the Workbench. */
  | { readonly type: 'built' }
  | { readonly type: 'scrapped' }
  | { readonly type: 'refined' }
  /** A module arrived: found, paid, gifted or (with `bought`) from the market. */
  | { readonly type: 'moduleGained'; readonly name: string; readonly bought: boolean };

/** The parts of the game that events are worked out from. */
export interface Snapshot {
  readonly connections: ReadonlyMap<string, { serverId: string; tracing: boolean; user: string | null }>;
  readonly tasks: ReadonlySet<string>;
  readonly messages: number;
  readonly balance: number;
  /** Changes when the player is caught. */
  readonly lieLowUntilMs: number;
  readonly rating: number;
  readonly bestRating: number;
  /** Ranks learned, over every skill. */
  readonly ranks: number;
  /** Skill points tied up in them. */
  readonly spent: number;
  /** Ids of the crafted programs. */
  readonly builds: ReadonlySet<string>;
  /** True while the Workbench is building. */
  readonly building: boolean;
  /** Loose modules, by "id:grade". */
  readonly parts: Readonly<Record<string, number>>;
}

export function snapshot(state: GameState, content?: Content): Snapshot {
  return {
    connections: new Map(
      state.connections.map((c) => [c.id, { serverId: c.serverId, tracing: c.trace.status === 'active', user: c.user }]),
    ),
    tasks: new Set(state.tasks.map((task) => task.id)),
    messages: state.messages.length,
    balance: state.player.balance,
    lieLowUntilMs: state.player.lieLowUntilMs,
    rating: state.player.rating,
    bestRating: state.player.bestRating,
    ranks: Object.values(state.player.skills).reduce((sum, rank) => sum + rank, 0),
    spent: content ? pointsSpent(state, content) : 0,
    builds: new Set(state.player.builds.map((build) => build.id)),
    building: state.tasks.some((task) => task.target.kind === 'build'),
    parts: { ...state.player.parts },
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
    // While the clock runs, a connection closes because a trace finished or because a watching model got out first.
    const traced = byClock && after.lieLowUntilMs !== before.lieLowUntilMs;
    if (!now) events.push({ type: 'disconnected', server: name(was.serverId), traced, pulled: byClock && !traced });
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
  const built = [...after.builds].some((id) => !before.builds.has(id));
  const scrapped = [...before.builds].some((id) => !after.builds.has(id));
  if (built) events.push({ type: 'built' });
  else if (byClock && [...before.tasks].some((id) => !after.tasks.has(id)) && after.connections.size >= before.connections.size) {
    events.push({ type: 'programFinished' });
  }
  if (scrapped) events.push({ type: 'scrapped' });

  if (after.ranks > before.ranks) events.push({ type: 'skillLearned' });
  if (after.ranks < before.ranks) events.push({ type: 'skillsUnlearned' });
  const points = (best: number) => Math.floor(best / content.rules.skillPointRating);
  if (points(after.bestRating) > points(before.bestRating)) {
    events.push({ type: 'pointEarned', free: Math.max(0, points(after.bestRating) - after.spent) });
  }

  // Modules coming back from a scrapped or stopped build are not new.
  const count = (parts: Readonly<Record<string, number>>) => Object.values(parts).reduce((sum, held) => sum + held, 0);
  const gained = Object.keys(after.parts).filter((key) => (after.parts[key] ?? 0) > (before.parts[key] ?? 0));
  if (gained.length > 0 && count(after.parts) < count(before.parts)) events.push({ type: 'refined' });
  else if (gained.length > 0 && !scrapped && !(before.building && !after.building)) {
    const names = gained.map((key) => {
      const [id, grade] = key.split(':');
      return `${content.modules.find((module) => module.id === id)?.name ?? id} ${grade}`;
    });
    events.push({ type: 'moduleGained', name: names.join(' and '), bought: after.balance < before.balance });
  }
  if (after.messages > before.messages) events.push({ type: 'message' });
  if (after.balance > before.balance) events.push({ type: 'paid' });
  if (after.balance < before.balance) events.push({ type: 'spent' });
  if (after.rating > before.rating) {
    const title = titleOf(after.rating);
    if (title && title !== titleOf(before.rating)) events.push({ type: 'promoted', title });
  }
  return events;
}
