/**
 * core/ is the game simulation: plain TypeScript, no browser code.
 * The UI reads state from here and sends player actions in.
 * Rule: nothing in this folder may import from ui/ or use the DOM
 * (tsconfig.core.json enforces the DOM part).
 */
export { createRng, restoreRng, hashSeed } from './rng';
export type { Rng, RngState } from './rng';
export { stream } from './streams';
export { CLIENT_FILE, MAX_HOPS, ROUTE_SLOTS, SPEEDS, STATE_VERSION, createGame, isConnected } from './state';
export type {
  Build,
  Fitted,
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
  Edition,
  NewsItem,
  NewsState,
  ServerMark,
  PendingRaid,
  PlayerState,
  RaidPort,
  RaidState,
  Review,
  RingPuzzle,
  ServerAlert,
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
  folderOf,
  linkOf,
  openedContent,
  securityOf,
  findConnection,
  findProgram,
  findServer,
  gatewayOf,
  installedOfKind,
  ownedProgram,
  sendMail,
  sourceAddress,
  syncWithContent,
} from './world';
export type { Content, Rules } from './world';
export { effectiveSpeed, gameDate, tick } from './clock';
export { REFERENCE_FILE_GB, bestPace, compareProgram, programPace, speedShare, topVersion } from './compare';
export type { ProgramComparison } from './compare';
export type { GameDate } from './clock';
export { MAX_LEVEL_GAP, blindSeconds, canLogIn, checkTask, layerSeconds, freeStorageGb, programStorageGq, ringAngle, ringTolerance, usedStorageGq } from './tasks';
export {
  addParts,
  buildBases,
  checkBuild,
  findBuilt,
  findModule,
  hasTrait,
  marketGrade,
  moduleSlots,
  partTaken,
  programFile,
  partCount,
  partKey,
} from './crafting';
export { describeBuild, tightness } from './builds';
export type { BuiltProgram } from './builds';
export {
  effect,
  findSkill,
  nextPointRating,
  pointsEarned,
  pointsFree,
  pointsSpent,
  skillRank,
  unlearnPrice,
  whyNotLearn,
} from './skills';
export { evidenceCount, isEvidence } from './forensics';
export { canRead, factsByFile, fileNotes, findAsk, findPerson, judge, knownFacts, knownPeople, leads, marks, openAsks, sendersFor, standing } from './phish';
export type { Draft, Group, Leads, Standing, Verdict } from './phish';
export { GUIDED_JOB, guideStep } from './guide';
export type { GuideId, GuideStep } from './guide';
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
export { PLANNER_HOPS, bestRoute, canReadTrace, coverShortfall, holdsLogin, jamTrace, relayCover, relayHeat, relayWorth, stepFade, hopUnderTrace, legFactor, legKind, maxReroutes, mostUrgentTrace, totalTraceMs, traceHeld, traceHopMs, traceLegs, traceReport, traceSense, traceSlow, tracesByUrgency } from './trace';
export { GENERAL_STORE, marketDay, rareShown, rareToday, sellsHardware, sellsModule, sellsOnly, sellsProgram, shopOf, shopPrice } from './market';
export { heldBy, holding, monitorHeld } from './link';
export type { LegKind, TraceLeg, TraceReport } from './trace';
export {
  activeContract,
  availableContracts,
  findContract,
  isLyingLow,
  nextContractRating,
  objectiveMet,
  objectivePossible,
  postJobs,
} from './contracts';
export { ALERT_HOURS, currentStage, goalMet, goalPossible, stageDeadline, stageIndex, contractRisk, stagesOf, stageView } from './stages';
export { applyAction } from './actions';
export { beginRaid, findRival, raidBarrier, raidPortAngle, raidReport, raidRival, raidSetbackMs, scheduleRaid } from './raid';
export type { RaidReport } from './raid';
export { advanceStory, currentBeat, storyComplete, storyOffered } from './story';
export { REGIONS, fill, generateCompanies, regionOf, worldFor } from './generate';
export type { Region } from './generate';
export { isJob, tierForRating } from './jobs';
export { EDITION_HOUR, editionDay, editionTimeMs, hasFirm, inTheNews, latestEdition, markServer, serverMark } from './news';
export type { Action, ActionResult } from './actions';
export { SAVE_FORMAT, SaveError, deserializeGame, readSummary, serializeGame, summarize } from './save';
export type { LoadedGame, Migration, SaveFile, SaveSummary } from './save';
