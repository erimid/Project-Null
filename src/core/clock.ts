/**
 * The game clock, and the one function that moves the whole game forward.
 *
 * Offline, the player can pause or run at 1×, 2× or 4×. While any
 * connection is open the clock is locked to 1× (no pause, no speed-up),
 * so trace timers stay tense.
 */
import { advanceHeist } from './heists';
import { caught, pullOut } from './actions';
import { activeContract, postJobs } from './contracts';
import { advanceContract } from './stages';
import { endRental, shouldPullOut } from './model';
import { runReviews } from './forensics';
import { monitorHeld } from './link';
import { runPhish } from './phish';
import { advanceRaid, beginPendingRaid } from './raid';
import { isConnected, type GameState, type Speed } from './state';
import { advanceTasks } from './tasks';
import { advanceKinds } from './kinds';
import { hasTrait } from './crafting';
import { advanceMonitor, advanceTrace, intruding, noteIntrusion } from './trace';
import type { Content } from './world';

/** The speed the clock is actually running at right now. An attack pins it to 1×, like a connection. */
export function effectiveSpeed(state: GameState): Speed {
  return isConnected(state) || state.raid !== null ? 1 : state.clock.speed;
}

/**
 * Moves the game forward. `realMs` is how much real time passed since the
 * last tick. Returns the simulated milliseconds that passed (real time ×
 * speed).
 */
export function tick(state: GameState, realMs: number, content: Content): number {
  if (!(realMs > 0)) return 0;
  const simMs = realMs * effectiveSpeed(state);
  const minuteBefore = Math.floor(state.clock.gameTimeMs / 60_000);
  state.clock.gameTimeMs += simMs * 60 * content.rules.gameMinutesPerRealSecond;

  const sighted = state.connections.filter((connection) => connection.monitor.blindMs <= 0);
  advanceTasks(state, content, simMs);
  if (state.contracts.heist) advanceHeist(state, simMs);
  for (const connection of [...state.connections]) {
    // A monitor blinded during this tick starts its blind time on the next one.
    if (connection.monitor.blindMs > 0 && sighted.includes(connection)) continue;
    // A monitor kept busy from another server stands still, like a blind one.
    if (monitorHeld(state, content, connection)) continue;
    const wasBlind = connection.monitor.blindMs > 0;
    const traceMs = advanceMonitor(connection, simMs);
    if (traceMs <= 0) continue;
    // A monitor that comes back sees an administrator who should not be there, and anything still running.
    // A Quiet build passes for ordinary traffic.
    const working = state.tasks.some((task) => task.connectionId === connection.id && !hasTrait(state, content, task.programId, 'quiet'));
    if (wasBlind && (intruding(content, connection) || working)) {
      noteIntrusion(state, content, connection);
    }
    // A watching model hangs up first, if the trace would otherwise get there.
    if (shouldPullOut(state, content, connection)) pullOut(state, content, connection);
    else if (advanceTrace(connection.trace, traceMs)) caught(state, content, connection);
  }
  // A guard or stay-in job counts the time held; a guarded server's intruder presses on.
  if (state.contracts.activeId !== null) advanceKinds(state, content, simMs);
  // Programs that finished this tick may have done a step of the contract; a step past its time is lost.
  const contract = state.contracts.activeId === null ? undefined : activeContract(state, content);
  if (contract) advanceContract(state, content, contract);
  if (state.reviews.length > 0) runReviews(state, content);
  if (state.phish.sent.length > 0) runPhish(state, content);
  if (state.player.model) endRental(state, content);
  // Enemy hackers: a waiting attack lands when the moment is right, and a live one presses on.
  if (state.raidPending) beginPendingRaid(state, content);
  if (state.raid) advanceRaid(state, content, simMs);
  // The board looks at its repeatable jobs once a game minute.
  if (Math.floor(state.clock.gameTimeMs / 60_000) !== minuteBefore) postJobs(state, content);
  return simMs;
}

export interface GameDate {
  readonly year: number;
  /** 1 to 12. */
  readonly month: number;
  readonly day: number;
  /** 0 = Sunday. */
  readonly weekday: number;
  readonly hours: number;
  readonly minutes: number;
}

/** Splits the game time into calendar parts for display. */
export function gameDate(state: GameState): GameDate {
  const date = new Date(state.clock.gameTimeMs);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    weekday: date.getUTCDay(),
    hours: date.getUTCHours(),
    minutes: date.getUTCMinutes(),
  };
}
