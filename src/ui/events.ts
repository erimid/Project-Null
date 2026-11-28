/**
 * Things that just happened in the game, worked out by comparing the
 * game before and after each change. Alerts and sounds listen to these,
 * so the simulation itself never needs to know about either.
 */
import { activeContract, allyHolding, findEnding, findRival, readFlag, findServer, pointsAt, pointsSpent, raidReport, stageIndex, stagesOf, type Content, type GameState } from '../core';
import { feats as featList, gameInfo, linesOf } from '../content';

const titleOf = (rating: number) => gameInfo.ratings.findLast((level) => rating >= level.min)?.title;

export type GameEvent =
  | { readonly type: 'connected'; readonly server: string }
  /** `traced` is true when the trace cut the connection; `pulled` when a watching model cut it just in time. */
  | { readonly type: 'disconnected'; readonly server: string; readonly traced: boolean; readonly pulled: boolean }
  | { readonly type: 'traceStarted'; readonly server: string }
  /** `kind` is what the program is working on: 'password', 'proxy', 'copyFile' and so on (a task's target kind). */
  | { readonly type: 'programStarted'; readonly kind: string }
  | { readonly type: 'programFinished'; readonly kind: string }
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
  | { readonly type: 'moduleGained'; readonly name: string; readonly bought: boolean }
  /** Someone has started breaking into the player's gateway. */
  | { readonly type: 'raidStarted'; readonly who: string }
  /** The intruder got through one of the gateway's barriers. */
  | { readonly type: 'barrierFell'; readonly left: number }
  /** One ring of the intruder's port locked in place. */
  | { readonly type: 'ringLocked' }
  /** Every ring locked: the port is shut and the intruder set back. */
  | { readonly type: 'portShut' }
  /** The attack is over: the intruder was traced home, got in, or the plug was pulled. */
  | { readonly type: 'raidEnded'; readonly who: string; readonly result: 'won' | 'lost' | 'fled' | 'held' }
  /** A staged contract moved on to its next step. */
  | { readonly type: 'stepDone'; readonly step: number; readonly of: number }
  /** Chorus took a server. `from` is one it already held, if any: where it reached out from. */
  | { readonly type: 'serverTaken'; readonly id: string; readonly server: string; readonly from?: string }
  /** The player has just read the file that holds the struck-out name. */
  | { readonly type: 'nameRead' }
  /** The story reached one of its endings. */
  | { readonly type: 'ended'; readonly id: string; readonly name: string }
  /** An ally who was holding a heist's door for a while let go of it. */
  | { readonly type: 'allyLetGo'; readonly who: string; readonly server: string }
  /** A feat was earned (see core/feats.ts). */
  | { readonly type: 'feat'; readonly name: string; readonly text: string };

/** The parts of the game that events are worked out from. */
export interface Snapshot {
  readonly connections: ReadonlyMap<string, { serverId: string; tracing: boolean; user: string | null }>;
  /** Running programs by task id, each with what it is working on. */
  readonly tasks: ReadonlyMap<string, string>;
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
  /** The attack on the gateway, if one is running. */
  readonly raid: { readonly who: string; readonly barrier: number; readonly barriers: number; readonly shut: number; readonly rings: number } | null;
  /** The subject of the newest message: says how an attack ended. */
  readonly lastSubject: string;
  /** The contract being worked on and the step it is at, as "id:step:steps". */
  readonly stage: string;
  /** Servers Chorus holds. */
  readonly taken: readonly string[];
  /** True once the file that holds the struck-out name has been read. */
  readonly named: boolean;
  /** The ending the story reached, if it has. */
  readonly ending: string | null;
  /** The heist under way (its vault), and the doors allies are holding in it, as "ally@server". */
  readonly heist: string;
  readonly allies: readonly string[];
  /** Feats earned in this career. */
  readonly feats: readonly string[];
}

/** The flags that say the name has been read: the last thing read in each job whose story beat is a reveal. */
function nameFlags(content: Content): string[] {
  const flags: string[] = [];
  for (const beat of linesOf(content.story).flatMap((line) => line.beats)) {
    if (!beat.reveal || !beat.contractId) continue;
    const job = content.contracts.find((contract) => contract.id === beat.contractId);
    const last = job && stagesOf(job).at(-1);
    if (last && last.objective.kind === 'read') flags.push(readFlag(last.targetId, last.objective.file));
  }
  return flags;
}
const nameFlagsOf = new WeakMap<Content, string[]>();

export function snapshot(state: GameState, content?: Content): Snapshot {
  const raid = state.raid;
  const job = content ? activeContract(state, content) : undefined;
  return {
    raid: raid
      ? {
          who: (content && findRival(content, raid.attackerId)?.handle) || 'Someone',
          barrier: raidReport(raid).barrier,
          barriers: raid.barriers,
          shut: raid.shut ?? 0,
          rings: raid.port ? raid.port.locked.filter(Boolean).length : 0,
        }
      : null,
    lastSubject: state.messages.at(-1)?.subject ?? '',
    stage: job ? `${job.id}:${stageIndex(state, job)}:${stagesOf(job).length}` : '',
    taken: [...state.chorus.taken],
    named: !!content && (nameFlagsOf.get(content) ?? nameFlagsOf.set(content, nameFlags(content)).get(content)!).some((flag) => state.flags.includes(flag)),
    ending: state.ending?.id ?? null,
    heist: state.contracts.heist?.vaultId ?? '',
    allies: (state.contracts.heist?.holds ?? []).filter((hold) => allyHolding(hold)).map((hold) => `${hold.ally}@${hold.targetId}`),
    connections: new Map(
      state.connections.map((c) => [c.id, { serverId: c.serverId, tracing: c.trace.status === 'active', user: c.user }]),
    ),
    tasks: new Map(state.tasks.map((task) => [task.id, task.target.kind])),
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
    feats: [...state.record.feats],
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

  const started = [...after.tasks].find(([id]) => !before.tasks.has(id));
  if (started) events.push({ type: 'programStarted', kind: started[1] });
  // A program that stops while the clock runs has finished; the player stopping one is not news.
  const built = [...after.builds].some((id) => !before.builds.has(id));
  const scrapped = [...before.builds].some((id) => !after.builds.has(id));
  if (built) events.push({ type: 'built' });
  else if (byClock && after.connections.size >= before.connections.size) {
    const finished = [...before.tasks].find(([id]) => !after.tasks.has(id));
    if (finished) events.push({ type: 'programFinished', kind: finished[1] });
  }
  if (scrapped) events.push({ type: 'scrapped' });

  if (after.ranks > before.ranks) events.push({ type: 'skillLearned' });
  if (after.ranks < before.ranks) events.push({ type: 'skillsUnlearned' });
  const points = (best: number) => pointsAt(content.rules, best);
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
  // The attack on the gateway: its start, each barrier lost, each ring and port won, and how it ended.
  const subjectStem = (key: 'raidWon' | 'raidLost') => content.mail[key].subject.split('{')[0]!;
  if (after.raid && !before.raid) events.push({ type: 'raidStarted', who: after.raid.who });
  else if (after.raid && before.raid) {
    if (after.raid.barrier > before.raid.barrier) events.push({ type: 'barrierFell', left: after.raid.barriers - after.raid.barrier });
    if (after.raid.shut > before.raid.shut) events.push({ type: 'portShut' });
    else if (after.raid.rings > before.raid.rings) events.push({ type: 'ringLocked' });
  } else if (before.raid && !after.raid) {
    const letters = content.chorus?.letters;
    const result = after.lastSubject.startsWith(subjectStem('raidWon'))
      ? 'won'
      : after.lastSubject.startsWith(subjectStem('raidLost')) || after.lastSubject === letters?.lost.subject
        ? 'lost'
        : after.lastSubject === letters?.held.subject
          ? 'held'
          : 'fled';
    events.push({ type: 'raidEnded', who: before.raid.who, result });
  }
  // A staged job moving on: same contract, a later step.
  const [jobBefore, stepBefore] = before.stage.split(':');
  const [jobAfter, stepAfter, steps] = after.stage.split(':');
  if (jobAfter && jobAfter === jobBefore && Number(stepAfter) > Number(stepBefore)) {
    events.push({ type: 'stepDone', step: Number(stepAfter), of: Number(steps) });
  }

  // A timed ally letting go, while the heist goes on.
  if (after.heist !== '' && after.heist === before.heist) {
    for (const held of before.allies) {
      if (after.allies.includes(held)) continue;
      const [who, serverId] = held.split('@') as [string, string];
      events.push({ type: 'allyLetGo', who, server: name(serverId) });
    }
  }

  // The story's own moments. An ending that hands Chorus everything is one event, not a hundred.
  const ended = after.ending !== null && before.ending === null;
  if (ended) events.push({ type: 'ended', id: after.ending!, name: findEnding(content, after.ending!)?.name ?? after.ending! });
  if (after.named && !before.named) events.push({ type: 'nameRead' });
  if (!ended && after.taken.length > 0 && after.taken.at(-1) !== before.taken.at(-1)) {
    for (const id of after.taken) {
      if (before.taken.includes(id)) continue;
      const from = before.taken.at(-1);
      events.push({ type: 'serverTaken', id, server: name(id), ...(from ? { from } : {}) });
    }
  }

  // The attack has its own alarm and its own ending; its mail does not chime over them.
  const raidNews = (after.raid && !before.raid) || (before.raid && !after.raid);
  if (after.messages > before.messages && !raidNews && !ended) events.push({ type: 'message' });
  if (after.balance > before.balance) events.push({ type: 'paid' });
  if (after.balance < before.balance) events.push({ type: 'spent' });
  if (after.rating > before.rating) {
    const title = titleOf(after.rating);
    if (title && title !== titleOf(before.rating)) events.push({ type: 'promoted', title });
  }
  for (const id of after.feats) {
    if (before.feats.includes(id)) continue;
    const feat = featList.find((item) => item.id === id);
    if (feat) events.push({ type: 'feat', name: feat.name, text: feat.text });
  }
  return events;
}
