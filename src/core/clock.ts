/**
 * The game clock.
 *
 * Offline, the player can pause or run at 1×, 2× or 4×. While any
 * connection is open the clock is locked to 1× (no pause, no speed-up),
 * so trace timers stay tense.
 */
import { isConnected, type GameState, type Speed } from './state';

export interface ClockRules {
  /** Game minutes that pass per real second at 1× speed. */
  readonly gameMinutesPerRealSecond: number;
}

/** The speed the clock is actually running at right now. */
export function effectiveSpeed(state: GameState): Speed {
  return isConnected(state) ? 1 : state.clock.speed;
}

/**
 * Moves the game forward. `realMs` is how much real time passed since the
 * last tick. Returns the simulated milliseconds that passed (real time ×
 * speed), which later systems such as traces run on.
 */
export function tick(state: GameState, realMs: number, rules: ClockRules): number {
  if (!(realMs > 0)) return 0;
  const simMs = realMs * effectiveSpeed(state);
  state.clock.gameTimeMs += simMs * 60 * rules.gameMinutesPerRealSecond;
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
