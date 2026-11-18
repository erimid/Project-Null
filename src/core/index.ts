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
  EchoPuzzle,
  ContractsState,
  FileState,
  GameState,
  HardwareState,
  Job,
  LogEntry,
  Message,
  PhishAttempt,
  PhishState,
  MonitorState,
  NewGameOptions,
  PlayerState,
  Review,
  RingPuzzle,
  ServerState,
  Speed,
  StoredFile,
  Task,
  TaskTarget,
  TraceState,
} from './state';
export {
  findAccount,
  fileContent,
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
export { MAX_LEVEL_GAP, blindSeconds, canLogIn, checkTask, layerSeconds, freeStorageGb, programStorageGq, ringAngle, usedStorageGq } from './tasks';
export { evidenceCount, isEvidence } from './forensics';
export { canRead, fileNotes, findAsk, findPerson, judge, knownFacts, knownPeople, marks, openAsks, standing } from './phish';
export type { Draft, Standing, Verdict } from './phish';
export { findModel, hasSkill, modelWith, rentedModel, workingModels } from './model';
export {
  HARDWARE_SLOT_LABELS,
  STOCK_HARDWARE,
  cpuSpeed,
  fileSpeed,
  findPart,
  hostedModel,
  installed,
  maxConnections,
  maxPrograms,
  rackStorageGb,
  storageGb,
} from './hardware';
export { hopUnderTrace, mostUrgentTrace, totalTraceMs, traceHeld, traceHopMs, traceReport, tracesByUrgency } from './trace';
export { heldBy, holding, monitorHeld } from './link';
export type { TraceReport } from './trace';
export {
  activeContract,
  availableContracts,
  findContract,
  isLyingLow,
  objectiveMet,
  objectivePossible,
  postJobs,
} from './contracts';
export { applyAction } from './actions';
export { REGIONS, fill, generateCompanies, regionOf, worldFor } from './generate';
export type { Region } from './generate';
export { isJob, tierForRating } from './jobs';
export type { Action, ActionResult } from './actions';
export { SAVE_FORMAT, SaveError, deserializeGame, readSummary, serializeGame, summarize } from './save';
export type { LoadedGame, Migration, SaveFile, SaveSummary } from './save';
