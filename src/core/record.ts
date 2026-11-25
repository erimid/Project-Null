/**
 * The career record: how each job went (the job report), the running
 * numbers for the career page, and the pacing of Wren's lessons.
 *
 * While a contract is worked on, a watch counts the time spent inside its
 * servers and the closest any trace came. On delivery that becomes the
 * job report, and the career numbers move on.
 *
 * Lessons: Wren's teaching letters wait in a queue and come out at most
 * one per delivered job, the most pressing first, so the first hour brings
 * one new idea at a time.
 */
import type { ContractDef, MailKey } from '../content/schema';
import { evidenceCount } from './forensics';
import { stagesOf } from './stages';
import type { Connection, GameState, Message, MessageKind } from './state';
import { traceReport } from './trace';
import { sendMail, type Content } from './world';

/** What the career page counts. */
export interface CareerStats {
  /** Jobs delivered, by kind (see jobKind). */
  jobs: Record<string, number>;
  /** The least time any trace had left on a job that was delivered, in ms. null = never traced on a job. */
  closestMs: number | null;
  /** The quickest job, taken to delivered, in game ms. null = none yet. */
  fastestMs: number | null;
  /** Size of every file copied home, in GQ. */
  stolenGq: number;
  /** Attacks on the gateway the player traced back. */
  raidsBeaten: number;
  /** Relays a trace got past, over the whole career. */
  relaysBurned: number;
  /** Traces that landed. */
  caught: number;
  /** Jobs delivered in a row with no line of the player's left in a log. */
  cleanRun: number;
  bestCleanRun: number;
  /** True from a trace landing until the next delivery. */
  caughtSinceJob: boolean;
  /** Game time the career began. */
  startMs: number;
}

/** Counted while a contract is worked on. */
export interface JobWatch {
  contractId: string;
  /** Time with a connection open to one of the job's servers, in game ms. */
  insideMs: number;
  /** The least time any running trace had left while the job was held. null = no trace ran. */
  closestMs: number | null;
  ratingBefore: number;
  /** Standing with each patron when the job was taken. */
  standingBefore: Record<string, number>;
  /** Most connections open at once. */
  mostOpen: number;
  /** Fewest relays on a connection to one of the job's servers. null = never connected to one. */
  fewestRelays: number | null;
  /** Most relays on one. */
  mostRelays: number;
  /** True once a Trace Jammer was used during the job. */
  jammed: boolean;
}

/** How one job went, shown as a card on delivery. */
export interface JobReport {
  contractId: string;
  title: string;
  kind: string;
  pay: number;
  ratingBefore: number;
  ratingAfter: number;
  insideMs: number;
  closestMs: number | null;
  /** Lines in the logs of the job's servers that would give the player away (see forensics.isEvidence). */
  linesLeft: number;
  /** Standing that moved, by patron id: how much. */
  standing: Record<string, number>;
  /** Anything else the client said: a bonus, a module enclosed, who the leak was. */
  notes: string[];
  /** Game time it was delivered. */
  timeMs: number;
  /** Game time from taking the job to delivering it. */
  tookMs: number;
  /** True if a trace landed between the last delivery and this one. */
  afterCaught: boolean;
  /** Feats this delivery earned. */
  feats: string[];
}

export interface LessonsState {
  /** Lessons due, in the order they became due. */
  due: string[];
  /** Jobs delivered when the last lesson went out. -1 = none yet. */
  lastJob: number;
}

export interface RecordState {
  watch: JobWatch | null;
  /** The report on the last job delivered. */
  last: JobReport | null;
  stats: CareerStats;
  /** Ids of the feats earned in this career (see feats.ts). */
  feats: string[];
  lessons: LessonsState;
}

export function newRecord(startMs: number): RecordState {
  return {
    watch: null,
    last: null,
    stats: { jobs: {}, closestMs: null, fastestMs: null, stolenGq: 0, raidsBeaten: 0, relaysBurned: 0, caught: 0, cleanRun: 0, bestCleanRun: 0, caughtSinceJob: false, startMs },
    feats: [],
    lessons: { due: [], lastJob: -1 },
  };
}

/** A word for the kind of job a contract is, for the career page. */
export function jobKind(contract: ContractDef): string {
  if (contract.heist) return 'heist';
  if (contract.round) return 'round';
  return contract.objective.kind;
}

/** Ids of every server the contract sends the player to. */
function jobServers(contract: ContractDef): string[] {
  return stagesOf(contract).map((stage) => stage.targetId);
}

/** A contract was taken: start counting. */
export function beginWatch(state: GameState, contract: ContractDef): void {
  state.record.watch = {
    contractId: contract.id,
    insideMs: 0,
    closestMs: null,
    ratingBefore: state.player.rating,
    standingBefore: { ...state.patrons.standing },
    mostOpen: 0,
    fewestRelays: null,
    mostRelays: 0,
    jammed: false,
  };
}

/** Once a clock tick: time inside, the closest trace, the shape of the connections. */
export function watchJob(state: GameState, contract: ContractDef, simMs: number): void {
  const watch = state.record.watch;
  if (!watch || watch.contractId !== contract.id) return;
  const servers = jobServers(contract);
  const inside = state.connections.filter((connection) => servers.includes(connection.serverId));
  if (inside.length > 0) watch.insideMs += simMs;
  watch.mostOpen = Math.max(watch.mostOpen, state.connections.length);
  for (const connection of inside) {
    watch.fewestRelays = Math.min(watch.fewestRelays ?? Infinity, connection.route.length);
    watch.mostRelays = Math.max(watch.mostRelays, connection.route.length);
  }
  for (const connection of state.connections) {
    if (connection.jammed) watch.jammed = true;
    if (connection.trace.status !== 'active') continue;
    const left = Math.max(0, traceReport(connection.trace).remainingMs);
    watch.closestMs = Math.min(watch.closestMs ?? Infinity, left);
  }
}

/** The contract was given up or lost: the watch stops. */
export function dropWatch(state: GameState): void {
  state.record.watch = null;
}

/** The contract was delivered: write the report and move the career numbers on. Returns the report. */
export function reportJob(state: GameState, contract: ContractDef, pay: number, notes: readonly string[]): JobReport {
  const watch = state.record.watch?.contractId === contract.id ? state.record.watch : null;
  const servers = jobServers(contract);
  // Only lines that give the player away count: the logout and connection-closed lines every visit leaves are harmless.
  const linesLeft = servers.reduce((sum, id) => sum + evidenceCount(state, id), 0);
  const standing: Record<string, number> = {};
  for (const [id, now] of Object.entries(state.patrons.standing)) {
    const moved = now - (watch?.standingBefore[id] ?? 0);
    if (moved !== 0) standing[id] = moved;
  }
  const tookMs = state.contracts.takenMs > 0 ? state.clock.gameTimeMs - state.contracts.takenMs : 0;
  const report: JobReport = {
    contractId: contract.id,
    title: contract.title,
    kind: jobKind(contract),
    pay,
    ratingBefore: watch?.ratingBefore ?? state.player.rating,
    ratingAfter: state.player.rating,
    insideMs: watch?.insideMs ?? 0,
    closestMs: watch?.closestMs ?? null,
    linesLeft,
    standing,
    notes: [...notes],
    timeMs: state.clock.gameTimeMs,
    tookMs,
    afterCaught: state.record.stats.caughtSinceJob,
    feats: [],
  };
  const stats = state.record.stats;
  stats.jobs[report.kind] = (stats.jobs[report.kind] ?? 0) + 1;
  if (report.closestMs !== null) stats.closestMs = Math.min(stats.closestMs ?? Infinity, report.closestMs);
  if (tookMs > 0) stats.fastestMs = Math.min(stats.fastestMs ?? Infinity, tookMs);
  stats.cleanRun = linesLeft === 0 ? stats.cleanRun + 1 : 0;
  stats.bestCleanRun = Math.max(stats.bestCleanRun, stats.cleanRun);
  stats.caughtSinceJob = false;
  state.record.last = report;
  return report;
}

/** A connection closed: count the relays its trace got past. */
export function noteClosed(state: GameState, connection: Connection): void {
  if (connection.trace.status === 'active') state.record.stats.relaysBurned += traceReport(connection.trace).relaysTraced;
}

/** A trace landed. */
export function noteCaught(state: GameState): void {
  state.record.stats.caught += 1;
  state.record.stats.cleanRun = 0;
  state.record.stats.caughtSinceJob = true;
}

/** A file was copied home. */
export function noteStolen(state: GameState, sizeGq: number): void {
  state.record.stats.stolenGq += sizeGq;
}

/** An attack on the gateway was traced back. */
export function noteRaidBeaten(state: GameState): void {
  state.record.stats.raidsBeaten += 1;
}

// ---------------------------------------------------------------- Lessons

/**
 * Wren's lessons, the most pressing first. When several are due, the
 * first in this list goes out after the next delivered job.
 */
export const LESSONS: readonly MailKey[] = [
  'firstDelivery',
  'jobs',
  'hardware',
  'defence',
  'harderSecurity',
  'workbench',
  'skills',
  'phishing',
  'memory',
  'links',
  'models',
  'shops',
  'gear',
  'legend',
];

/**
 * Lessons tied to the moment: they go out at once, because the thing they
 * teach is in front of the player now. They still count as the job's
 * lesson, so the next queued one waits for another delivery.
 */
export const LESSONS_NOW: readonly MailKey[] = ['welcome', 'firstAccept', 'stages', 'routes', 'decompiling', 'news'];

/** Letters about a job's money and steps: kept, but filed as read under Work. */
export const RECEIPTS: readonly MailKey[] = ['paid', 'stageNote'];

/** Letters about the work: what went wrong on a job, attacks, rentals. */
const WORK: readonly MailKey[] = ['contractFailed', 'contractLate', 'caught', 'review', 'phishRefused', 'phishReported', 'modelExpired', 'hardwareLost', 'raid', 'raidWon', 'raidLost', 'raidFled', 'loan', 'loanSquare', 'cutOut'];

/** Which inbox tab a written letter belongs to. */
export function mailKind(key: MailKey): MessageKind {
  if ((LESSONS as readonly string[]).includes(key) || (LESSONS_NOW as readonly string[]).includes(key)) return 'lesson';
  if ((RECEIPTS as readonly string[]).includes(key)) return 'receipt';
  if ((WORK as readonly string[]).includes(key)) return 'work';
  return 'story';
}

/** A lesson has become due. It goes out after the next delivery, or now if none has gone out since the last one. */
export function queueLesson(state: GameState, content: Content, key: MailKey): void {
  const lessons = state.record.lessons;
  if (!lessons.due.includes(key)) lessons.due.push(key);
  releaseLesson(state, content);
}

/** A lesson tied to the moment goes out now, and counts as this job's lesson. */
export function teachNow(state: GameState, content: Content, key: MailKey): void {
  sendMail(state, content, key);
  state.record.lessons.lastJob = state.contracts.completed.length;
}

/** Sends the most pressing lesson that is due, if a job has been delivered since the last one. */
export function releaseLesson(state: GameState, content: Content): void {
  const lessons = state.record.lessons;
  if (lessons.due.length === 0 || state.contracts.completed.length <= lessons.lastJob) return;
  const rank = (key: string) => {
    const at = (LESSONS as readonly string[]).indexOf(key);
    return at < 0 ? LESSONS.length : at;
  };
  const next = [...lessons.due].sort((a, b) => rank(a) - rank(b))[0]!;
  lessons.due = lessons.due.filter((key) => key !== next);
  lessons.lastJob = state.contracts.completed.length;
  sendMail(state, content, next as MailKey);
}

/** Sends every lesson that is due, as if a job had been delivered before each. For tests. */
export function flushLessons(state: GameState, content: Content): void {
  while (state.record.lessons.due.length > 0) {
    state.record.lessons.lastJob = -1;
    releaseLesson(state, content);
  }
}

// ---------------------------------------------------------------- Inbox tabs

/** Unread letters that count on the Messages tab: story and work. Lessons wait quietly in their own tab. */
export function countsUnread(message: Message, content: Content): boolean {
  if (message.read) return false;
  const kind = kindOf(message, content);
  return kind === 'story' || kind === 'work';
}

/**
 * Which tab a message belongs to. New messages carry their kind; older
 * ones are matched against the written letters by subject.
 */
export function kindOf(message: Message, content: Content): MessageKind {
  if (message.kind) return message.kind;
  for (const [key, mail] of Object.entries(content.mail) as [MailKey, { subject: string; from: string }][]) {
    const pattern = new RegExp(`^${mail.subject.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{\w+\}/g, '.*')}$`);
    if (pattern.test(message.subject) && (mail.from.includes('{') || mail.from === message.from)) return mailKind(key);
  }
  return 'story';
}
