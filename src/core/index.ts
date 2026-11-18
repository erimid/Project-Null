/**
 * core/ is the game simulation: plain TypeScript, no browser code.
 * The UI reads state from here and sends player actions in.
 * Rule: nothing in this folder may import from ui/ or use the DOM
 * (tsconfig.core.json enforces the DOM part).
 */
export { createRng, restoreRng, hashSeed } from './rng';
export type { Rng, RngState } from './rng';
export { stream } from './streams';
export { MAX_HOPS, SPEEDS, STATE_VERSION, createGame, isConnected } from './state';
export type {
  ClockState,
  Connection,
  ContractsState,
  FileState,
  GameState,
  LogEntry,
  Message,
  NewGameOptions,
  PlayerState,
  ServerState,
  Speed,
  StoredFile,
  Task,
  TaskTarget,
  TraceState,
} from './state';
export {
  findAccount,
  findConnection,
  findProgram,
  findServer,
  gatewayOf,
  ownedProgram,
  sendMail,
  sourceAddress,
  syncWithContent,
} from './world';
export type { Content, Rules } from './world';
export { effectiveSpeed, gameDate, tick } from './clock';
export type { GameDate } from './clock';
export { MAX_LEVEL_GAP, canLogIn, checkTask, layerSeconds, usedStorageGq } from './tasks';
export { mostUrgentTrace, totalTraceMs, traceHopMs, traceReport } from './trace';
export type { TraceReport } from './trace';
export {
  activeContract,
  availableContracts,
  findContract,
  isLyingLow,
  objectiveMet,
  objectivePossible,
} from './contracts';
export { applyAction } from './actions';
export type { Action, ActionResult } from './actions';
export { SAVE_FORMAT, SaveError, deserializeGame, readSummary, serializeGame, summarize } from './save';
export type { LoadedGame, Migration, SaveFile, SaveSummary } from './save';
