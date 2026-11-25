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
  PatronsState,
  LadderOutcome,
  LadderState,
  PendingRaid,
  PlayerState,
  RaidPort,
  GuardState,
  ActiveHeist,
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
  allyHolding,
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
export { DIFFICULTIES, MODES, isDifficulty, modeOf } from './difficulty';
export type { Difficulty, Mode } from './difficulty';
export { QUIET_HOURS, loanAmount, quietTarget } from './loan';
export type { LoanState } from './loan';
export { CATCH_CELLS, MARK_CELLS, catchFlash, catchLocked, keyFits, replyMark } from './play';
export type { CatchPlay, KeyPlay, PickPlay, Play } from './play';
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
  pointStep,
  pointsAt,
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
export { GENERAL_STORE, marketDay, rareShown, rareToday, sellsHardware, sellsModule, sellsOnly, sellsProgram, shopFor, shopOf, shopPrice } from './market';
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
export { ALERT_HOURS, currentStage, goalMet, goalPossible, stageDeadline, stageIndex, contractRisk, readFlag, stagesOf, stageView } from './stages';
export { applyAction } from './actions';
export { beginRaid, findRival, holdOffMs, untraceable, raidBarrier, raidPortAngle, raidReport, raidRival, raidSetbackMs, scheduleRaid } from './raid';
export type { RaidReport } from './raid';
export { endingOf, findEnding, offeredChoices, patronGone, reachEnding } from './endings';
export { advanceChorus, chorusAwake, chorusTargets, freeServer, isTaken, storyQuietMs, takeServer } from './chorus';
export { AI_TRUST, advanceStory, aiTrust, beatPassed, beatsSeen, currentBeat, gateRating, needMet, storyComplete, storyOffered, storyWaits, type StoryWait } from './story';
export { REGIONS, fill, generateCompanies, regionOf, worldFor } from './generate';
export type { Region } from './generate';
export { isJob, tierForRating } from './jobs';
export { DEFAULT_CHOICE, INNER, SHOP_DISCOUNT, STANDING_RANGE, TRUSTED, TRUSTED_PAY, findPatron, hasFavour, knownPatrons, openPatron, shopDiscount, standingName, standingWith } from './patrons';
export { ADDRESS_PRICE, addressPrice, ladderPlace, ladderRival, ladderRows, privateRelay, rivalScore } from './ladder';
export type { LadderRow } from './ladder';
export { EVENTS_RATING, EVENT_HOURS, EVENT_PATH, YOU, advanceEvents, buyNowPrice, eventJob, eventPage, nextBid, owedBy } from './events';
export type { EventButton, EventPage } from './events';
export { SERIES_GAP_HOURS, advanceSeries, seriesDone, seriesLine, seriesOf, seriesOpen } from './series';
export { REGULAR_MOST, REGULAR_SHARE, REGULAR_STEP, jobsFor, regularOf, regularsOf } from './regulars';
export { CRACKDOWN_PRICES, isShut, shutMarket } from './market';
export { EDITION_HOUR, editionDay, editionTimeMs, hasFirm, inTheNews, latestEdition, markServer, serverMark } from './news';
export type { Action, ActionResult } from './actions';
export { SAVE_FORMAT, SaveError, deserializeGame, readSummary, serializeGame, summarize } from './save';
export type { LoadedGame, Migration, SaveFile, SaveSummary } from './save';
export { GUARD_RINGS, foundFlag, guardRingAngle, guardSetbackMs, holdNeedMs, raceProgress } from './kinds';
export { HEIST_PAY, HEIST_TIER, LOCKDOWN, burnHeist, conditionMet, heistAttacker, heistLines, heistRefusal, heistStatus, planHeist, absentAllies, advanceHeist } from './heists';
export { CLIENT_PREMIUM, DATA_BOARD, dataKind, priceBoard, quote } from './data';
export type { Quote } from './data';
export {
  FIELD_KINDS,
  freeMemoryGb,
  isLoaded,
  loadedOfKind,
  loadedPrograms,
  loadoutLocked,
  matchesLoadout,
  memoryGb,
  needsMemory,
  ownsProgram,
  usedMemoryGb,
  whyNotLoad,
} from './loadout';
export { MOVES, MOVE_NAMES, PATCH_LAYERS, SURGE_SECONDS, knowsMove, movesLeft, patchModule, whyNotMove } from './moves';
export { WANTED_LEVELS, wanted, wantedEffects, wantedLevel, wantedShare } from './wanted';
export { SAFE_HOUSE, SECOND_GATEWAY, findAsset, hasAsset, ownRelay, whyNotAsset } from './assets';
export { assetPrice, buyAsset } from './hardware';
export { LEGEND_TWISTS, TRAVEL_LIGHT_GB, TWISTS, activeLegend, legendWeek, twistOfWeek, twistOn } from './legend';
export type { LegendTwist } from './legend';
export { LEGEND_HOURS, LEGEND_PAY, LEGEND_RATING, postLegend } from './jobs';
export { LOADOUT_SLOTS } from './state';
export { LEAK_WRONG_PAY, TERMS_NAMES, jobServers, leakOf, nameChoice, peopleOf, roundTotal, termsKept, termsLine, termsMinutesLeft, windowMinutesLeft } from './side';
export { SIDE_RULES, isSideJob, openSideKinds } from './sideJobs';
export type { DarkEvent, EventsState, MoveId, PatchLayer, WantedState } from './state';
export { happenings, troubleAt, troubleKind, troubleMap, type Happening, type Trouble, type TroubleKind } from './exposure';
export { LESSONS, countsUnread, jobKind, kindOf, type CareerStats, type JobReport, type RecordState } from './record';
export { FEAT_IDS, checkFeats, type FeatId } from './feats';
export { caseFile, type CaseFileView } from './casefile';
export type { MessageKind } from './state';
