/**
 * core/ is the game simulation: plain TypeScript, no browser code.
 * The UI reads state from here and sends player actions in.
 * Rule: nothing in this folder may import from ui/ or use the DOM
 * (tsconfig.core.json enforces the DOM part).
 */
export { createRng, restoreRng, hashSeed } from './rng';
export type { Rng, RngState } from './rng';
export { stream } from './streams';
export { SPEEDS, STATE_VERSION, createGame, isConnected } from './state';
export type { ClockState, Connection, GameState, NewGameOptions, PlayerState, Speed } from './state';
export { effectiveSpeed, gameDate, tick } from './clock';
export type { ClockRules, GameDate } from './clock';
export { applyAction } from './actions';
export type { Action, ActionResult } from './actions';
export { SAVE_FORMAT, SaveError, deserializeGame, readSummary, serializeGame, summarize } from './save';
export type { LoadedGame, Migration, SaveFile, SaveSummary } from './save';
