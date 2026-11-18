/**
 * The game clock, and the one function that moves the whole game forward.
 *
 * Offline, the player can pause or run at 1×, 2× or 4×. While any
 * connection is open the clock is locked to 1× (no pause, no speed-up),
 * so trace timers stay tense.
 */
import { caught, pullOut } from './actions';
import { postJobs } from './contracts';
import { endRental, shouldPullOut } from './model';
import { runReviews } from './forensics';
import { monitorHeld } from './link';
import { runPhish } from './phish';
import { isConnected, type GameState, type Speed } from './state';
import { advanceTasks } from './tasks';
import { advanceMonitor, advanceTrace, intruding, noteIntrusion } from './trace';
import type { Content } from './world';

/** The speed the clock is actually running at right now. */
export function effectiveSpeed(state: GameState): Speed {
  return isConnected(state) ? 1 : state.clock.speed;
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
  for (const connection of [...state.connections]) {
    // A monitor blinded during this tick starts its blind time on the next one.
    if (connection.monitor.blindMs > 0 && sighted.includes(connection)) continue;
    // A monitor kept busy from another server stands still, like a blind one.
    if (monitorHeld(state, content, connection)) continue;
    const wasBlind = connection.monitor.blindMs > 0;
    const traceMs = advanceMonitor(connection, simMs);
    if (traceMs <= 0) continue;
    // A monitor that comes back sees an administrator who should not be there, and anything still running.
    if (wasBlind && (intruding(content, connection) || state.tasks.some((task) => task.connectionId === connection.id))) {
      noteIntrusion(state, content, connection);
    }
    // A watching model hangs up first, if the trace would otherwise get there.
    if (shouldPullOut(state, content, connection)) pullOut(state, content, connection);
    else if (advanceTrace(connection.trace, traceMs)) caught(state, content, connection);
  }
  if (state.reviews.length > 0) runReviews(state, content);
  if (state.phish.sent.length > 0) runPhish(state, content);
  if (state.player.model) endRental(state, content);
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
