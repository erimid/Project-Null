/**
 * A scripted player. It plays a whole career through the same actions
 * the screens send, on the real clock, and reports how it went: how long
 * each rating took, what the work paid per hour, and where it got stuck.
 * The balance tests run it against the real data files, so a change to a
 * price or a timing that breaks the climb fails a test.
 *
 * It is a tool for tests and tuning. The game itself never runs it.
 */
import { MAX_LAYER_LEVEL, type ContractDef, type ProgramDef, type ProgramKind, type ServerDef, type StageDef } from '../content/schema';
import type { HardwareDef } from '../content/hardware';
import { applyAction, type Action } from './actions';
import { tick } from './clock';
import { activeContract, availableContracts, isLyingLow, postJobs } from './contracts';
import { buildBases, findModule, hasTrait, marketGrade, moduleSlots, partTaken } from './crafting';
import { evidenceCount, isEvidence } from './forensics';
import { worldFor } from './generate';
import { maxConnections } from './hardware';
import { isJob } from './jobs';
import { sellsHardware, sellsModule, sellsOnly, sellsProgram, shopFor, shopPrice } from './market';
import { heldBy, monitorHeld } from './link';
import { canRead, judge, knownFacts, knownPeople, standing } from './phish';
import { leakOf, nameChoice } from './side';
import { skillRank } from './skills';
import { createGame, isConnected, MAX_HOPS, type Connection, type Fitted, type GameState, type TaskTarget } from './state';
import { checkTask, freeStorageGb, layerSeconds, MAX_LEVEL_GAP, ringAngle, ringTolerance } from './tasks';
import { intruding, relayHeat, relayWorth, totalTraceMs } from './trace';
import { raidPortAngle } from './raid';
import { beatsSeen, gateRating, storyComplete } from './story';
import { goalMet, readFlag, stagesOf, stageView } from './stages';
import { heistLines, heistStatus } from './heists';
import { guardRingAngle } from './kinds';
import { fileDef, findProgram, findServer, installedOfKind, linkOf, ownedProgram, securityOf, syncWithContent, type Content } from './world';
import { FIELD_KINDS, loadedPrograms, memoryGb } from './loadout';

/** How a player plays. The numbers stand in for a person's habits. */
export interface Profile {
  readonly name: string;
  /** Relays put in front of every break-in. */
  readonly hops: number;
  /** True picks the slowest relays to trace through; false takes the address book in order. */
  readonly bestRelays: boolean;
  /** Seconds spent looking and clicking before each thing done on a connection. */
  readonly thinkSeconds: number;
  /** Lines up a firewall bypass's ports by hand. */
  readonly rings: boolean;
  /** Repeats the monitor's handshake after blinding it. */
  readonly echo: boolean;
  /** Scrubs the access log before leaving. */
  readonly scrub: boolean;
  /** Reads files and writes to people for passwords and addresses. */
  readonly phish: boolean;
  /** Seconds of trace it wants left over after a step, or it leaves first. */
  readonly marginSeconds: number;
  /** Credits it keeps back when buying things a job does not need. */
  readonly reserve: number;
  /** False buys only what a job cannot be done without. */
  readonly upgrades: boolean;
  /** Skills learned as the points come, in this order: an id once for each rank. Left out, it learns none. */
  readonly skills?: readonly string[];
  /** Fits modules to its programs at the Workbench as they come, takes installers it passes, and buys more with spare money. */
  readonly craft?: boolean;
  /** Fights an enemy hacker off: traces them back and shuts the ports they probe. Left out, it pulls the plug. */
  readonly defend?: boolean;
}

/** A career's worth of points for someone who lets the programs do the work. */
const SKILLS_TYPICAL: readonly string[] = [
  'sharp-tools', 'patience', 'long-way-round', 'sharp-tools', 'tuned-hardware', 'second-slot', 'sharp-tools',
  'long-way-round', 'clean-sweep', 'tuned-hardware', 'long-way-round', 'tight-builds', 'overreach',
];
/** The same for someone who lines the ports up by hand. */
const SKILLS_CAREFUL: readonly string[] = [
  'steady-hand', 'sharp-tools', 'patience', 'auto-align', 'second-slot', 'sharp-tools', 'long-way-round',
  'tuned-hardware', 'sharp-tools', 'clean-sweep', 'long-way-round', 'tuned-hardware', 'long-way-round', 'tight-builds',
];

export const PROFILES = {
  /** Uses everything the game teaches. */
  careful: { name: 'careful', hops: MAX_HOPS, bestRelays: true, thinkSeconds: 1.5, rings: true, echo: true, scrub: true, phish: true, marginSeconds: 4, reserve: 1000, upgrades: true, skills: SKILLS_CAREFUL, craft: true, defend: true },
  /** Uses a few relays, scrubs, ignores the hands-on shortcuts. */
  typical: { name: 'typical', hops: 5, bestRelays: false, thinkSeconds: 3, rings: false, echo: false, scrub: true, phish: true, marginSeconds: 5, reserve: 500, upgrades: true, skills: SKILLS_TYPICAL, craft: true, defend: true },
  /** Two relays, slow hands, never cleans up. */
  careless: { name: 'careless', hops: 2, bestRelays: false, thinkSeconds: 4, rings: false, echo: false, scrub: false, phish: false, marginSeconds: 2, reserve: 0, upgrades: true },
} as const satisfies Record<string, Profile>;

export interface JobLine {
  readonly id: string;
  readonly title: string;
  readonly job: boolean;
  /** How many steps it has: 1 for a plain job, more for one that moves from server to server. */
  readonly steps: number;
  /** True for a story mission. */
  readonly story: boolean;
  readonly pay: number;
  /** Real seconds from taking it to being paid. */
  readonly seconds: number;
  readonly ratingAfter: number;
  readonly balanceAfter: number;
  readonly caught: number;
  readonly visits: number;
  /** The least time, in seconds, a running trace had left at any moment of the job. Null if none ran. */
  readonly closest: number | null;
  /** Fines that landed while it was being worked, for this job or an earlier one. */
  readonly fined: number;
  /** The whole length, in seconds, of the longest trace that ran on the job: what the route bought. Null if none ran. */
  readonly traceSeconds: number | null;
}

export interface TitleLine {
  readonly title: string;
  readonly rating: number;
  /** Real minutes into the career when the title was reached. */
  readonly atMinutes: number;
  readonly contracts: number;
  readonly earned: number;
}

export interface CareerReport {
  readonly profile: string;
  readonly seed: number;
  readonly jobs: readonly JobLine[];
  readonly titles: readonly TitleLine[];
  /** Things it could not do, and why. */
  readonly stuck: readonly string[];
  readonly minutes: number;
  readonly earned: number;
  readonly fines: number;
  readonly caught: number;
  readonly finalRating: number;
  readonly finalBalance: number;
  /** Hand-written contracts delivered. */
  readonly written: number;
  /** Everything bought, in order, with the real minute it was bought at. */
  readonly bought: readonly { readonly name: string; readonly price: number; readonly atMinutes: number }[];
  /** Skill ranks learned, in order, with the real minute. */
  readonly learned: readonly { readonly name: string; readonly atMinutes: number }[];
  /** Programs built at the Workbench, in order. */
  readonly built: readonly { readonly name: string; readonly atMinutes: number }[];
  /** Module installers taken from servers on the way. */
  readonly found: number;
  /** Real minute at which nothing was left to buy, if that happened. */
  readonly kitCompleteMinutes: number | null;
  /** Enemy hackers who came for the gateway, and how each attack ended. */
  readonly raids: readonly { readonly who: string; readonly atMinutes: number; readonly rating: number; readonly story: boolean; readonly result: 'won' | 'lost' | 'fled' }[];
  /** Story beats in the order they arrived, with the real minute and the rating at the time. */
  readonly story: readonly { readonly id: string; readonly atMinutes: number; readonly rating: number }[];
  /** The most money held at any moment, and the real minute it was held at. */
  readonly richest: { readonly balance: number; readonly atMinutes: number };
}

export interface CareerOptions {
  /** Stop once this many contracts have been delivered. */
  readonly maxContracts: number;
  /** Stop after this many real minutes. */
  readonly maxMinutes: number;
  /** Stop when the written contracts are done and this rating is reached. */
  readonly untilRating: number;
  readonly ratings: readonly { readonly min: number; readonly title: string }[];
  readonly startDate: string;
  readonly startingBalance: number;
  /** Called with a line for everything the player does, for looking closely at one job. */
  readonly note?: (line: string) => void;
  /** Called with the game after every delivery, for taking a copy of it at some point in a career. */
  readonly snapshot?: (state: GameState, content: Content) => void;
  /** How to finish the contracts that offer a choice, by contract id. Left out, the usual way. */
  readonly choices?: Readonly<Record<string, string>>;
  /** Contracts this player leaves on the board. */
  readonly shun?: (contract: ContractDef, state: GameState) => boolean;
  /** Stop as soon as this holds. */
  readonly until?: (state: GameState) => boolean;
}

/** Leaving a connection before the trace gets there. */
class Bail extends Error {}
/** A trace got there first. */
class Caught extends Error {}
/** Something that cannot be done with what the player has. */
class Stuck extends Error {}

const TICK_MS = 100;

/** What the other shops sell beyond the Backroom's shelf: more than one career's pay will buy. */
const LATE_WISHES: readonly string[] = [
  'monitor-bypass-3',
  'sensor-1',
  'cooling-1',
  'trace-jammer',
  'password-breaker-4',
  'firewall-bypass-4',
  'cpu-5',
  'proxy-bypass-4',
  'modem-5',
  'memory-5',
  'cooling-2',
  'storage-5',
  'trace-jammer-2',
  'cpu-6',
  'modem-6',
  'cooling-3',
  'cpu-7',
  'cooling-4',
  'cpu-8',
];

/** Things bought when there is money to spare, most useful first. */
const WISHES: readonly string[] = [
  'proxy-bypass',
  'firewall-bypass',
  'ports-2',
  'monitor-bypass',
  'route-planner',
  'cpu-2',
  'decrypter',
  'memory-2',
  'modem-2',
  'storage-2',
  'password-breaker-2',
  'firewall-bypass-2',
  'proxy-bypass-2',
  'memory-3',
  'cpu-3',
  'monitor-bypass-2',
  'modem-3',
  'storage-3',
  'ports-3',
  'password-breaker-3',
  'firewall-bypass-3',
  'rack-1',
  'proxy-bypass-3',
  'cpu-4',
  'modem-4',
  'storage-4',
  'memory-4',
  'route-planner-2',
  'rack-2',
  'route-planner-3',
  ...LATE_WISHES,
];

/** The same list for someone who uses the Workbench: modules ("mod:id:grade") and the Decompiler among the rest. */
const CRAFT_WISHES: readonly string[] = [
  'proxy-bypass',
  'firewall-bypass',
  'ports-2',
  'monitor-bypass',
  'cpu-2',
  'mod:tidy:1',
  'decrypter',
  'memory-2',
  'modem-2',
  'storage-2',
  'password-breaker-2',
  'firewall-bypass-2',
  'mod:swift:2',
  'proxy-bypass-2',
  'memory-3',
  'cpu-3',
  'mod:quiet:2',
  'monitor-bypass-2',
  'modem-3',
  'storage-3',
  'decompiler',
  'mod:tidy:2',
  'ports-3',
  'password-breaker-3',
  'firewall-bypass-3',
  'rack-1',
  'mod:swift:3',
  'proxy-bypass-3',
  'cpu-4',
  'mod:quiet:3',
  'modem-4',
  'storage-4',
  'memory-4',
  'mod:tidy:3',
  'rack-2',
  ...LATE_WISHES,
];

/** Which programs each module goes on, most wanted first. */
const FITS: Record<string, readonly ProgramKind[]> = {
  quiet: ['breakPassword', 'copyFile', 'deleteFile', 'bypassFirewall'],
  swift: ['bypassFirewall', 'bypassProxy', 'breakPassword', 'bypassMonitor', 'deleteLog'],
  tidy: ['copyFile', 'deleteFile'],
  compact: [],
};

const moduleWish = (id: string): Fitted | undefined => {
  const [mark, module, grade] = id.split(':');
  return mark === 'mod' && module ? { id: module, grade: Number(grade) } : undefined;
};

export function playCareer(base: Content, seed: number, profile: Profile, options: CareerOptions): CareerReport {
  const content = worldFor(base, seed);
  const state: GameState = syncWithContent(
    createGame({ seed, handle: 'BOT', startDate: options.startDate, startingBalance: options.startingBalance }),
    content,
  );
  postJobs(state, content);

  let realMs = 0;
  let earned = 0;
  let fines = 0;
  let caughtTotal = 0;
  let kitCompleteMinutes: number | null = null;
  /** The least a running trace has had left since this was last reset, in ms. */
  let closestMs = Infinity;
  /** The whole length of the longest trace that has run since this was last reset, in ms. */
  let longestMs = 0;
  const stuck: string[] = [];
  const jobs: JobLine[] = [];
  const titles: TitleLine[] = [];
  const bought: { name: string; price: number; atMinutes: number }[] = [];
  const raids: { who: string; atMinutes: number; rating: number; story: boolean; result: 'won' | 'lost' | 'fled' }[] = [];
  const storyLines: { id: string; atMinutes: number; rating: number }[] = [];
  let richest = { balance: state.player.balance, atMinutes: 0 };
  const learned: { name: string; atMinutes: number }[] = [];
  const built: { name: string; atMinutes: number }[] = [];
  let found = 0;
  const wishes = profile.craft ? CRAFT_WISHES : WISHES;
  const skipped = new Set<string>();
  const minutes = () => Math.round((realMs / 60_000) * 10) / 10;

  const board = content.servers.find((server) => server.kind === 'board' && !sellsOnly(server));
  const directory = content.servers.find((server) => server.kind === 'directory');
  if (!board) throw new Error('The world has no contracts board.');

  const note = (text: string): void => {
    if (!options.note) return;
    const traces = state.connections
      .map((c) => `${c.serverId}:${c.trace.status}${c.trace.status === 'none' ? '' : ` ${Math.round((totalTraceMs(c.trace) - c.trace.elapsedMs + c.trace.graceMs) / 100) / 10}s left`}${c.monitor.blindMs > 0 ? ` blind ${Math.round(c.monitor.blindMs / 100) / 10}s` : ''}`)
      .join(', ');
    options.note(`${(realMs / 1000).toFixed(1).padStart(7)}s  ${text.padEnd(44)} ${traces}`);
  };
  const act = (action: Action) => applyAction(state, action, content);
  const must = (action: Action): void => {
    const result = act(action);
    if (!result.ok) throw new Stuck(`${action.type} refused: ${result.reason}`);
  };

  /** The attack on the gateway being dealt with, to tell when it ends and how. */
  let fighting: { who: string; story: boolean; nextMs: number } | null = null;

  /**
   * An enemy hacker on the gateway. A player who defends takes a moment to
   * open Defence, starts the trace back, then shuts ports one after another
   * until the trace gets home. One who does not pulls the plug, or if that
   * would drop a job in progress, lets them have what they came for.
   */
  const fight = (): void => {
    const raid = state.raid;
    if (!raid) {
      if (fighting) {
        const last = state.messages[state.messages.length - 1]?.subject ?? '';
        const won = last.startsWith(content.mail.raidWon.subject.split('{')[0]!) || last === content.chorus?.letters.held.subject;
        raids.push({ who: fighting.who, atMinutes: minutes(), rating: state.player.rating, story: fighting.story, result: won ? 'won' : 'lost' });
        fighting = null;
      }
      return;
    }
    if (raid.result !== 'open') return;
    if (!fighting) fighting = { who: raid.attackerId, story: raid.story, nextMs: realMs + (profile.thinkSeconds + 2) * 1000 };
    if (realMs < fighting.nextMs) return;
    if (!profile.defend) {
      if (isConnected(state)) return;
      act({ type: 'pullPlug' });
      raids.push({ who: fighting.who, atMinutes: minutes(), rating: state.player.rating, story: fighting.story, result: 'fled' });
      fighting = null;
      return;
    }
    const pause = () => (fighting!.nextMs = realMs + profile.thinkSeconds * 1000);
    if (!raid.traceBack && act({ type: 'traceBack' }).ok) return void pause();
    if (!raid.port) {
      act({ type: 'defendPort' });
      return void pause();
    }
    const port = raid.port;
    port.locked.forEach((locked, ring) => {
      const angle = raidPortAngle(port, ring);
      if (!locked && Math.min(angle, 360 - angle) <= ringTolerance(state, content) * 0.6) act({ type: 'defendRing', ring });
    });
    if (!state.raid?.port) pause();
  };

  /** Notes each story beat as it arrives. */
  const follow = (): void => {
    for (const id of beatsSeen(state, content)) {
      if (!storyLines.some((line) => line.id === id)) storyLines.push({ id, atMinutes: minutes(), rating: state.player.rating });
    }
    if (state.player.balance > richest.balance) richest = { balance: state.player.balance, atMinutes: minutes() };
  };

  /** Lets real time pass. Throws Caught if a trace reaches the gateway meanwhile. */
  const wait = (seconds: number, done?: () => boolean): void => {
    const held = state.connections.map((connection) => connection.id);
    const lowBefore = state.player.lieLowUntilMs;
    for (let left = seconds * 1000; left > 0 && !done?.(); left -= TICK_MS) {
      const balance = state.player.balance;
      tick(state, TICK_MS, content);
      realMs += TICK_MS;
      fight();
      follow();
      // Money only goes down inside a tick through a fine.
      if (state.player.balance < balance) fines += balance - state.player.balance;
      for (const connection of state.connections) {
        const trace = connection.trace;
        if (trace.status === 'active') {
          closestMs = Math.min(closestMs, totalTraceMs(trace) - trace.elapsedMs);
          longestMs = Math.max(longestMs, totalTraceMs(trace));
        }
      }
      if (state.player.lieLowUntilMs !== lowBefore || held.some((id) => !state.connections.some((connection) => connection.id === id))) {
        throw new Caught();
      }
    }
  };

  const think = (): void => wait(profile.thinkSeconds);

  /** Time passing at home: the clock runs at its fastest. */
  const idle = (until: () => boolean, limitSeconds = 3600): void => {
    act({ type: 'disconnectAll' });
    act({ type: 'setSpeed', speed: 4 });
    try {
      wait(limitSeconds, until);
    } catch (error) {
      if (!(error instanceof Caught)) throw error;
    }
    act({ type: 'setSpeed', speed: 1 });
  };

  const graceMs = (server: ServerDef): number => (content.rules.monitorGraceSeconds[server.security.monitor] ?? 0) * 1000;

  /** How long until this connection's trace gets home. `intrude`: as if something noticeable started now. */
  const timeLeftMs = (connection: Connection, intrude: boolean): number => {
    if (monitorHeld(state, content, connection)) return Infinity;
    const trace = connection.trace;
    const total = totalTraceMs(trace);
    if (trace.status === 'active') return total - trace.elapsedMs + connection.monitor.blindMs + (trace.frozenMs ?? 0);
    if (trace.status === 'pending') return trace.graceMs + total;
    // A blind monitor sees nothing until it comes back. Then it sees an administrator, or a program still running.
    if (!intrude && !intruding(content, connection)) return Infinity;
    return connection.monitor.blindMs + graceMs(findServer(content, connection.serverId)!) + total;
  };

  /** Leaves rather than start something the traces would not let finish. */
  const checkTime = (connection: Connection, seconds: number, intrude: boolean): void => {
    const stepMs = (seconds + profile.thinkSeconds) * 1000;
    for (const other of state.connections) {
      const short = () => timeLeftMs(other, intrude && other === connection) < stepMs + profile.marginSeconds * 1000;
      if (!short()) continue;
      // A Trace Jammer buys a little more time, once on each connection.
      if (other.trace.status === 'active' && !other.jammed && act({ type: 'jamTrace', connectionId: other.id }).ok && !short()) continue;
      throw new Bail();
    }
  };

  /**
   * The relays this player would pick for one target. Everyone can read
   * the map's marks, so nobody takes a relay the target sees through or a
   * warm one while a better one is to hand. A careful player also takes
   * the slowest relays and puts the best of them last, next to the
   * target, where a trace step counts in full.
   */
  const relays = (targetId: string, exclude: readonly string[]): string[] => {
    const target = findServer(content, targetId)!;
    const worth = (server: ServerDef) => relayWorth(content, target, server, state) * (profile.bestRelays ? server.relayDelay : 1);
    const usable = state.knownServers
      .map((id) => findServer(content, id)!)
      .filter((server) => server.kind !== 'gateway' && server.id !== targetId && !exclude.includes(server.id));
    if (profile.hops > 2) usable.sort((a, b) => worth(b) - worth(a));
    const picked = usable.slice(0, profile.hops);
    if (profile.bestRelays) picked.reverse();
    return picked.map((server) => server.id);
  };

  const open = (serverId: string, exclude: readonly string[], hops = true): Connection => {
    must({ type: 'clearRoute' });
    if (hops) for (const id of relays(serverId, exclude)) must({ type: 'addHop', serverId: id });
    must({ type: 'connect', serverId });
    return state.connections[state.connections.length - 1]!;
  };

  /** Runs a program to the end. */
  const run = (connection: Connection, target: TaskTarget): void => {
    const check = checkTask(state, content, connection, target);
    if (!check.ok) throw new Stuck(`${target.kind} on ${connection.serverId}: ${check.reason}`);
    // A firewall bypass done by hand takes about half the time.
    const seconds = target.kind === 'firewall' && profile.rings ? check.seconds / 2 : check.seconds;
    // A Quiet build is not noticed; blinding a monitor never is.
    checkTime(connection, seconds, target.kind !== 'monitor' && !hasTrait(state, content, check.program.id, 'quiet'));
    think();
    note(`run ${target.kind} on ${connection.serverId} (${Math.round(seconds * 10) / 10}s)`);
    must({ type: 'runProgram', connectionId: connection.id, target });
    const task = state.tasks[state.tasks.length - 1]!;
    wait(600, () => {
      if (!state.tasks.includes(task)) return true;
      if (profile.rings && task.puzzle) {
        task.puzzle.locked.forEach((locked, ring) => {
          const angle = ringAngle(task, ring);
          if (!locked && Math.min(angle, 360 - angle) <= content.rules.ringToleranceDegrees * 0.6) {
            act({ type: 'lockRing', taskId: task.id, ring });
          }
        });
      }
      return false;
    });
  };

  const adminOf = (server: ServerDef) => server.accounts.find((account) => account.role === 'admin');

  /** Reads whatever can be read where the player is, and writes to anyone it now knows how to fool. */
  const read = (connection?: Connection): void => {
    if (!profile.phish) return;
    if (connection) {
      for (const file of state.servers[connection.serverId]?.files ?? []) {
        if (canRead(state, content, connection.serverId, file.name)) act({ type: 'readFile', serverId: connection.serverId, name: file.name });
      }
    }
    for (const file of state.player.files) {
      if (canRead(state, content, file.from, file.name)) act({ type: 'readFile', serverId: file.from, name: file.name });
    }
    const people = knownPeople(state, content).map((person) => person.id);
    const facts = knownFacts(state, content).map((fact) => fact.id);
    for (const ask of content.people.asks) {
      if (state.phish.done.includes(ask.id) || standing(state, content, ask.markId) !== 'open') continue;
      if (!people.includes(ask.markId) || !people.includes(ask.senderId)) continue;
      const draft = { askId: ask.id, senderId: ask.senderId, factIds: ask.needs.filter((need) => facts.includes(need)) };
      if (judge(content, draft) === 'good') act({ type: 'sendPhish', ...draft });
    }
  };

  /** Gets an administrator login on a connection, breaking the password if it has to. */
  const becomeAdmin = (connection: Connection): void => {
    const server = findServer(content, connection.serverId)!;
    const admin = adminOf(server);
    if (!admin) throw new Stuck(`${server.name} has no administrator account.`);
    if (connection.role === 'admin') return;
    const blind = ownedProgram(state, content, 'bypassMonitor');
    if (blind && server.security.monitor > 0 && !connection.monitor.used && !monitorHeld(state, content, connection)) {
      if (checkTask(state, content, connection, { kind: 'monitor' }).ok) {
        run(connection, { kind: 'monitor' });
        const echo = connection.monitor.echo;
        if (profile.echo && echo) for (const cell of echo.cells) act({ type: 'echoCell', connectionId: connection.id, cell });
      }
    }
    if (!(state.player.passwords[server.id]?.includes(admin.user) ?? false) && server.security.password > 0) {
      run(connection, { kind: 'password', user: admin.user });
    }
    checkTime(connection, 0, true);
    think();
    note(`log in to ${server.id} as ${admin.user}`);
    must({ type: 'login', connectionId: connection.id, user: admin.user });
  };

  const scrub = (connection: Connection): void => {
    const server = findServer(content, connection.serverId)!;
    const lines = () => (state.servers[server.id]?.logs ?? []).filter(isEvidence).map((entry) => entry.id);
    if (lines().length === 0) return;
    if (securityOf(state, server).proxy > 0 && !connection.bypassed.proxy) {
      if (!ownedProgram(state, content, 'bypassProxy')) return;
      run(connection, { kind: 'proxy' });
    }
    // A review may have closed the case while the proxy was being dealt with.
    if (lines().length > 0 && ownedProgram(state, content, 'deleteLog')) run(connection, { kind: 'deleteLog', logIds: lines() });
  };

  const fileBlocked = (server: ServerDef, connection: Connection): boolean =>
    securityOf(state, server).firewall > 0 && !connection.bypassed.firewall && !heldBy(state, content, server.id, 'firewall');

  /** The step of a contract the player is working on now: its own target and goal. */
  const step = (contract: ContractDef): ContractDef => (state.contracts.activeId === contract.id ? stageView(state, contract) : contract);

  const doObjective = (connection: Connection, contract: ContractDef): void => {
    const stage = step(contract);
    const server = findServer(content, stage.targetId)!;
    const goal = stage.objective;
    if (goal.kind === 'read') {
      if (fileBlocked(server, connection)) run(connection, { kind: 'firewall' });
      act({ type: 'readFile', serverId: server.id, name: goal.file });
      return;
    }
    if (goal.kind === 'leak') {
      if (fileBlocked(server, connection)) run(connection, { kind: 'firewall' });
      for (const name of goal.files) act({ type: 'readFile', serverId: server.id, name });
      return;
    }
    if (goal.kind === 'wipe') {
      if (securityOf(state, server).proxy > 0 && !connection.bypassed.proxy) run(connection, { kind: 'proxy' });
      const lines = (state.servers[server.id]?.logs ?? []).filter((entry) => entry.left === goal.who).map((entry) => entry.id);
      if (lines.length > 0) run(connection, { kind: 'deleteLog', logIds: lines });
      return;
    }
    // A false trail already laid on an earlier visit stays: what is left is the cleaning up.
    if (goal.kind === 'frame' && state.servers[server.id]?.logs.some((entry) => entry.framed === goal.who)) return;
    if (goal.kind === 'record' || goal.kind === 'frame') {
      if (securityOf(state, server).proxy > 0 && !connection.bypassed.proxy) run(connection, { kind: 'proxy' });
      checkTime(connection, 0, true);
      think();
      must(goal.kind === 'record' ? { type: 'alterRecord', connectionId: connection.id } : { type: 'frameLog', connectionId: connection.id });
      return;
    }
    if (goal.kind === 'plant') {
      if (fileBlocked(server, connection)) run(connection, { kind: 'firewall' });
      run(connection, { kind: 'uploadFile', file: goal.file });
      return;
    }
    if (goal.kind === 'swap') {
      if (fileBlocked(server, connection)) run(connection, { kind: 'firewall' });
      if (state.servers[server.id]?.files.some((file) => file.name === goal.file && !file.doctored)) run(connection, { kind: 'deleteFile', file: goal.file });
      run(connection, { kind: 'uploadFile', file: goal.file });
      return;
    }
    if (goal.kind !== 'steal' && goal.kind !== 'destroy') return;
    if (goal.kind === 'steal' && state.player.files.some((file) => file.name === goal.file && file.from === server.id)) return;
    if (fileBlocked(server, connection)) run(connection, { kind: 'firewall' });
    run(connection, { kind: goal.kind === 'steal' ? 'copyFile' : 'deleteFile', file: goal.file });
  };

  /** True once nothing is left to do on the current step's target. */
  const fieldworkDone = (contract: ContractDef): boolean => {
    const stage = step(contract);
    const goal = stage.objective;
    if (goal.kind === 'read') return state.flags.includes(readFlag(stage.targetId, goal.file));
    if (goal.kind === 'steal') return state.player.files.some((file) => file.name === goal.file && file.from === stage.targetId);
    return goalMet(state, content, stage.targetId, goal);
  };

  /** A second connection is worth opening if it switches off a layer the job has to get past. */
  const wantsHolder = (server: ServerDef): boolean => linkOf(state, server) !== undefined && maxConnections(state, content) >= 2;

  /** Takes any module installer lying on the server, if the trace leaves time for it and the cleaning up after. */
  const loot = (connection: Connection): void => {
    if (!profile.craft) return;
    const server = findServer(content, connection.serverId)!;
    if (fileBlocked(server, connection)) return;
    for (const file of [...(state.servers[server.id]?.files ?? [])]) {
      if (!fileDef(content, server.id, file.name)?.part || partTaken(state, server.id, file.name)) continue;
      const target: TaskTarget = { kind: 'copyFile', file: file.name };
      const check = checkTask(state, content, connection, target);
      if (!check.ok) continue;
      try {
        checkTime(connection, check.seconds + 12, true);
        run(connection, target);
        found++;
      } catch (error) {
        if (!(error instanceof Bail)) throw error;
        return;
      }
    }
  };

  /** The best program of a kind on the drive, loaded or not. */
  const best = (kind: ProgramKind): ProgramDef | undefined => installedOfKind(state, content, kind)[0];

  /** The kinds of program one step of a job cannot be done without, most needed first. */
  const mustCarry = (stage: { targetId: string; objective: ContractDef["objective"] }): ProgramKind[] => {
    const server = findServer(content, stage.targetId);
    if (!server) return [];
    const sec = { ...securityOf(state, server) };
    // A heist's vault is worked with its held layers down.
    if (state.contracts.heist?.vaultId === server.id) for (const hold of state.contracts.heist.holds) sec[hold.layer] = 0;
    const goal = stage.objective;
    const kinds: ProgramKind[] = [];
    const admin = adminOf(server);
    if (admin && sec.password > 0 && !state.player.passwords[server.id]?.includes(admin.user)) kinds.push('breakPassword');
    const holder = linkOf(state, server);
    const held = holder && findServer(content, holder.serverId);
    if (held && adminOf(held) && securityOf(state, held).password > 0 && !kinds.includes('breakPassword')) kinds.push('breakPassword');
    if (goal.kind === 'wipe') kinds.push('deleteLog');
    if (goal.kind === 'record' || goal.kind === 'frame' || goal.kind === 'wipe') {
      if (sec.proxy > 0) kinds.push('bypassProxy');
    } else if (['steal', 'destroy', 'plant', 'read', 'swap', 'leak'].includes(goal.kind) && sec.firewall > 0 && !(holder?.layer === 'firewall' && maxConnections(state, content) >= 2)) kinds.push('bypassFirewall');
    if (goal.kind === 'steal' || goal.kind === 'plant' || goal.kind === 'swap') kinds.push('copyFile');
    if (goal.kind === 'destroy' || goal.kind === 'swap') kinds.push('deleteFile');
    // Someone who cleans up carries what cleaning takes, on every server the job touches.
    if (profile.scrub) for (const kind of ['deleteLog', 'bypassProxy'] as const) if (!kinds.includes(kind)) kinds.push(kind);
    return kinds;
  };

  /**
   * Packs memory for one step of a job, as a player does before connecting:
   * what the step cannot be done without, then whatever else is useful for
   * as long as it fits.
   */
  const pack = (stage: { targetId: string; objective: ContractDef['objective'] }, more: readonly string[] = []): void => {
    const server = findServer(content, stage.targetId);
    const order: ProgramKind[] = [...mustCarry(stage)];
    // Other servers the same trip logs in on: a heist's holds, the machines on a hacker's trail.
    for (const id of more) for (const kind of mustCarry({ targetId: id, objective: { kind: 'hold', seconds: 0 } })) if (!order.includes(kind)) order.push(kind);
    const sec = server ? securityOf(state, server) : undefined;
    if ((sec && sec.monitor > 0) || more.some((id) => (findServer(content, id)?.security.monitor ?? 0) > 0)) order.push('bypassMonitor');
    for (const kind of FIELD_KINDS) order.push(kind);
    const wanted = [...new Set(order)].map((kind) => best(kind)).filter((program): program is ProgramDef => program !== undefined);
    let room = memoryGb(state, content);
    const carry = wanted.filter((program) => {
      if (program.sizeGq > room) return false;
      room -= program.sizeGq;
      return true;
    });
    const loaded = loadedPrograms(state, content);
    if (loaded.length === carry.length && carry.every((program) => loaded.includes(program))) return;
    for (const program of loaded) act({ type: 'unloadProgram', programId: program.id });
    for (const program of carry) act({ type: 'loadProgram', programId: program.id });
  };

  /** One trip to the current step's target. Returns false if it had to leave early. */
  const visit = (contract: ContractDef): boolean => {
    const stage = step(contract);
    const server = findServer(content, stage.targetId)!;
    try {
      const goal = stage.objective;
      if (goal.kind === 'hunt') {
        // A hacker's trail: each machine's log points at the next, and connecting to the last finds them.
        const chain = [stage.targetId, ...goal.trail];
        pack(stage, goal.trail);
        for (let i = 0; i < chain.length; i++) {
          const next = chain[i + 1];
          if (next !== undefined && state.knownServers.includes(next)) continue;
          const line = open(chain[i]!, []);
          if (next !== undefined) {
            becomeAdmin(line);
            const entry = state.servers[chain[i]!]?.logs.find((item) => item.points === next);
            if (!entry) throw new Stuck(`no trail on ${chain[i]}`);
            think();
            must({ type: 'followTrail', connectionId: line.id, logId: entry.id });
            if (profile.scrub) scrub(line);
          }
          think();
          act({ type: 'disconnectAll' });
        }
        return true;
      }
      if (goal.kind === 'guard') {
        // The client's own login. Shut the ports the intruder tries until the time is up.
        pack(stage);
        const line = open(server.id, []);
        const admin = adminOf(server);
        if (!admin) throw new Stuck(`${server.name} has no administrator account.`);
        think();
        must({ type: 'login', connectionId: line.id, user: admin.user });
        let nextMs = realMs + profile.thinkSeconds * 1000;
        wait(goal.seconds + 120, () => {
          if (activeContract(state, content)?.id !== contract.id || fieldworkDone(contract)) return true;
          const guard = state.contracts.guard;
          if (!guard || realMs < nextMs) return false;
          if (!guard.port) {
            act({ type: 'guardPort' });
            nextMs = realMs + profile.thinkSeconds * 500;
            return false;
          }
          const port = guard.port;
          port.locked.forEach((locked, ring) => {
            const angle = guardRingAngle(port, ring);
            if (!locked && Math.min(angle, 360 - angle) <= ringTolerance(state, content) * 0.6) act({ type: 'guardRing', ring });
          });
          if (!state.contracts.guard?.port) nextMs = realMs + profile.thinkSeconds * 1000;
          return false;
        });
        think();
        act({ type: 'disconnectAll' });
        return true;
      }
      if (goal.kind === 'hold') {
        // Stay logged in while the trace runs.
        pack(stage);
        const line = open(server.id, []);
        becomeAdmin(line);
        const left = goal.seconds - state.contracts.heldMs / 1000;
        checkTime(line, left, true);
        note(`hold ${server.id} for ${Math.round(left)}s`);
        wait(left + 5, () => fieldworkDone(contract) || activeContract(state, content)?.id !== contract.id || state.contracts.stage !== stagesOf(contract).indexOf(stagesOf(contract).find((item) => item.objective === goal)!));
        if (profile.scrub) scrub(line);
        think();
        act({ type: 'disconnectAll' });
        return true;
      }
      // A timed ally lets go partway, so the bot holds that desk itself when it has a line spare.
      const spare = maxConnections(state, content) > heistLines(state, contract);
      const heist = contract.heist && state.contracts.heist ? heistStatus(state).filter((hold) => !hold.ally || (spare && hold.allyMs !== undefined)) : [];
      if (heist.length > 0) {
        // Take every desk nobody is keeping for you, quietest first, then the vault.
        const order = [...heist].sort((a, b) => (findServer(content, a.targetId)?.security.monitor ?? 0) - (findServer(content, b.targetId)?.security.monitor ?? 0));
        pack(stage, order.map((hold) => hold.targetId));
        const taken: string[] = [server.id];
        for (const hold of order) {
          const line = open(hold.targetId, taken);
          taken.push(hold.targetId);
          becomeAdmin(line);
        }
        const vault = open(server.id, taken.slice(1));
        becomeAdmin(vault);
        if (!fieldworkDone(contract)) doObjective(vault, contract);
        if (profile.scrub) for (const line of [...state.connections].reverse()) scrub(line);
        think();
        act({ type: 'disconnectAll' });
        return true;
      }
      pack(stage);
      let holder: Connection | undefined;
      const link = linkOf(state, server);
      if (wantsHolder(server) && link) {
        holder = open(link.serverId, [server.id]);
        becomeAdmin(holder);
      }
      const connection = open(server.id, holder ? [holder.serverId] : []);
      becomeAdmin(connection);
      if (!fieldworkDone(contract)) doObjective(connection, contract);
      if (!fileBlocked(server, connection)) read(connection);
      loot(connection);
      if (profile.scrub) {
        scrub(connection);
        if (holder) scrub(holder);
      }
      think();
      note('done here, disconnect');
      act({ type: 'disconnectAll' });
      return true;
    } catch (error) {
      if (!(error instanceof Bail)) throw error;
      note('leave early');
      act({ type: 'disconnectAll' });
      return false;
    }
  };

  /** How many of a module the player has at this grade or better, loose or fitted. */
  const modulesHeld = (wish: Fitted): number => {
    let count = 0;
    for (const [key, held] of Object.entries(state.player.parts)) {
      const [id, grade] = key.split(':');
      if (id === wish.id && Number(grade) >= wish.grade) count += held;
    }
    for (const build of state.player.builds) count += build.modules.filter((fitted) => fitted.id === wish.id && fitted.grade >= wish.grade).length;
    return count;
  };

  const owns = (id: string): boolean => {
    const wish = moduleWish(id);
    if (wish) return modulesHeld(wish) > 0;
    const part = content.hardware.find((item) => item.id === id);
    if (part) return state.player.hardware[part.slot] >= part.tier;
    const program = findProgram(content, id);
    if (!program) return true;
    const own = best(program.kind);
    return own !== undefined && own.version >= program.version;
  };

  /** The shops this player buys from: the board, and once Wren has pointed the others out, every shop in the address book. */
  const shops = (): ServerDef[] =>
    content.servers.filter(
      (server) =>
        server.kind === 'board' &&
        state.knownServers.includes(server.id) &&
        (server.id === board.id || state.player.rating >= content.rules.shopsAfterRating),
    );

  /** Where something is cheapest today, among the shops that have it on the shelf. */
  const offer = (id: string): { shop: ServerDef; price: number } | undefined => {
    const wish = moduleWish(id);
    const module = wish && findModule(content, wish.id);
    const part = content.hardware.find((item) => item.id === id);
    const program = findProgram(content, id);
    let best: { shop: ServerDef; price: number } | undefined;
    for (const shop of shops()) {
      let base: number | undefined;
      if (wish) base = module && sellsModule(state, shop, module, wish.grade) ? module.grades[wish.grade - 1]?.price : undefined;
      else if (part) base = sellsHardware(state, shop, part) ? part.price : undefined;
      else if (program) base = sellsProgram(state, shop, program) ? program.price : undefined;
      if (base === undefined) continue;
      const price = shopPrice(shopFor(state, content, shop), base);
      if (!best || price < best.price) best = { shop, price };
    }
    return best;
  };

  const price = (id: string): number => offer(id)?.price ?? Infinity;

  /** A logged-in connection to a shop, opening one if need be. Shopping is done at home, between jobs. */
  const atShop = (shop: ServerDef): Connection => {
    const there = state.connections.find((connection) => connection.serverId === shop.id && connection.user !== null);
    if (there) return there;
    act({ type: 'disconnectAll' });
    const connection = open(shop.id, [], false);
    think();
    must({ type: 'login', connectionId: connection.id, user: shop.accounts[0]!.user });
    return connection;
  };

  /** Buys one thing wherever it is cheapest. Returns false if it can't. */
  const buy = (id: string): boolean => {
    const deal = offer(id);
    if (!deal || state.player.balance < deal.price) return false;
    const wish = moduleWish(id);
    const part: HardwareDef | undefined = content.hardware.find((item) => item.id === id);
    const program: ProgramDef | undefined = findProgram(content, id);
    if (program && !wish && !part) {
      // An older version only takes up room.
      // A build on an older version comes apart first: its modules go back on the shelf for the new one.
      for (const build of [...state.player.builds]) {
        const base = content.programs.find((own) => own.id === build.base);
        if (base && base.kind === program.kind && base.version < program.version) act({ type: 'scrapProgram', programId: build.id });
      }
      const older = content.programs.find((own) => state.player.programs.includes(own.id) && own.kind === program.kind && own.version < program.version);
      if (older && program.sizeGq - older.sizeGq <= freeStorageGb(state, content)) act({ type: 'uninstallProgram', programId: older.id });
    }
    const connectionId = atShop(deal.shop).id;
    const result = wish
      ? act({ type: 'buyModule', connectionId, moduleId: wish.id, grade: wish.grade })
      : part
        ? act({ type: 'buyHardware', connectionId, partId: id })
        : act({ type: 'buyProgram', connectionId, programId: id });
    if (!result.ok) return false;
    const name = wish ? `${findModule(content, wish.id)?.name ?? wish.id} ${wish.grade} module` : (part?.name ?? `${program!.name} v${program!.version}`);
    bought.push({ name: `${name}${deal.shop.id === board.id ? '' : ` (${deal.shop.name})`}`, price: deal.price, atMinutes: minutes() });
    return true;
  };

  /** What a contract cannot be done without, as ids of things to own. Null if nothing sold would do. */
  const needs = (contract: ContractDef): string[] | null => {
    const list: string[] = [];
    const cheapest = (kind: ProgramDef['kind'], level: number): string | null => {
      const fit = content.programs
        .filter((program) => program.kind === kind && layerSeconds(program, level) !== null && offer(program.id) !== undefined)
        .sort((a, b) => price(a.id) - price(b.id))[0];
      return fit?.id ?? null;
    };
    const want = (kind: ProgramDef['kind'], level: number): boolean => {
      const own = best(kind);
      if (own && level - own.version <= MAX_LEVEL_GAP) return true;
      const id = cheapest(kind, level);
      if (id === null) return false;
      list.push(id);
      return true;
    };
    // The scripted player keeps to the kinds of job it knows, and never races.
    // Outside the story it never races, and takes none of the newer kinds of job.
    const newer = contract.heist !== undefined || stagesOf(contract).some((stage) => ['guard', 'hold', 'hunt', 'swap'].includes(stage.objective.kind));
    if (contract.race || (newer && !contract.story)) return null;
    // Nor a legend contract that holds memory down: it packs by habit, not to a budget.
    if (isJob(contract) && contract.legend?.twist === 'travelLight') return null;
    if (contract.heist) {
      const lines = heistLines(state, contract);
      if (maxConnections(state, content) < lines) {
        const ports = content.hardware.find((part) => part.slot === 'ports' && (part.connections ?? 1) >= lines);
        if (!ports) return null;
        list.push(ports.id);
      }
    }
    // Every server the job logs in on: each step's own, the machines on a trail, the desks a heist holds.
    const sites: { targetId: string; objective: ContractDef['objective']; twists?: StageDef['twists'] }[] = [];
    for (const stage of stagesOf(contract)) {
      sites.push(stage);
      if (stage.objective.kind === 'hunt') for (const id of stage.objective.trail.slice(0, -1)) sites.push({ targetId: id, objective: { kind: 'hold', seconds: 0 } });
    }
    for (const hold of contract.heist?.holds ?? []) sites.push({ targetId: hold.targetId, objective: { kind: 'hold', seconds: 0 } });
    // Every step must be doable, so gear for the hardest layer each one presents.
    for (const stage of sites) {
      const server = findServer(content, stage.targetId);
      if (!server) return null;
      const sec = { ...securityOf(state, server) };
      // A step that puts the server on its guard as it begins (see TwistDef) is met at the raised level.
      for (const twist of stage.twists ?? []) if (twist.kind === 'raise' && sec[twist.layer] > 0) sec[twist.layer] = Math.min(MAX_LAYER_LEVEL, sec[twist.layer] + twist.by);
      if (contract.heist && stage.targetId === contract.targetId) for (const hold of contract.heist.holds) sec[hold.layer] = 0;
      const goal = stage.objective;
      const admin = adminOf(server);
      const needsAdmin = goal.kind !== 'read' || goal.file === undefined;
      if (admin && sec.password > 0 && needsAdmin && !state.player.passwords[server.id]?.includes(admin.user)) {
        if (!want('breakPassword', sec.password)) return null;
      }
      if (goal.kind === 'wipe' && !best('deleteLog')) return null;
      if (goal.kind === 'record' || goal.kind === 'frame' || goal.kind === 'wipe') {
        if (sec.proxy > 0 && !want('bypassProxy', sec.proxy)) return null;
      } else if ((goal.kind === 'steal' || goal.kind === 'destroy' || goal.kind === 'plant' || goal.kind === 'read' || goal.kind === 'swap' || goal.kind === 'leak') && sec.firewall > 0) {
        const linked = linkOf(state, server)?.layer === 'firewall';
        const own = best('bypassFirewall');
        const reachable = cheapest('bypassFirewall', sec.firewall) !== null;
        if (linked && (!reachable || maxConnections(state, content) >= 2)) {
          if (maxConnections(state, content) < 2) list.push('ports-2');
        } else if (!own || sec.firewall - own.version > MAX_LEVEL_GAP) {
          if (!want('bypassFirewall', sec.firewall)) return null;
        }
      }
      // A monitor that traces the moment you connect, and is run from another server: the brief says to hold that desk, which takes a second connection.
      if (linkOf(state, server)?.layer === 'monitor' && sec.monitor >= content.rules.monitorGraceSeconds.length && maxConnections(state, content) < 2) list.push('ports-2');
      if (goal.kind === 'steal') {
        const file = state.servers[server.id]?.files.find((item) => item.name === goal.file);
        if (file?.encrypted && !want('decrypt', file.encrypted)) return null;
        // Room for the file once whatever it is about to buy is installed.
        const installing = list.reduce((sum, id) => sum + (content.programs.find((program) => program.id === id)?.sizeGq ?? 0), 0);
        if (file && file.sizeGq > freeStorageGb(state, content) - installing) {
          const next = content.hardware.find((part) => part.slot === 'storage' && part.tier === state.player.hardware.storage + 1);
          if (!next) return null;
          list.push(next.id);
        }
      }
      // What this step cannot be done without has to fit in memory together, counting what is about to be bought.
      const carried = mustCarry(stage).map((kind) => {
        const buying = list.map((id) => content.programs.find((program) => program.id === id)).find((program) => program?.kind === kind);
        return (buying ?? best(kind))?.sizeGq ?? 0;
      });
      if (carried.reduce((sum, size) => sum + size, 0) > memoryGb(state, content)) {
        const next = content.hardware.find((part) => part.slot === 'memory' && part.tier === state.player.hardware.memory + 1);
        if (!next) return null;
        list.push(next.id);
      }
    }
    return [...new Set(list)];
  };

  /** At home between jobs: spends skill points, and fits whatever modules it has to its programs. */
  const tinker = (): void => {
    const wanted = new Map<string, number>();
    for (const id of profile.skills ?? []) {
      const rank = (wanted.get(id) ?? 0) + 1;
      wanted.set(id, rank);
      if (skillRank(state, id) >= rank) continue;
      if (!act({ type: 'learnSkill', skillId: id }).ok) break;
      learned.push({ name: content.skills.find((skill) => skill.id === id)?.name ?? id, atMinutes: minutes() });
    }
    if (!profile.craft) return;

    // Everything it has, best first, shared out over the newest program of each kind.
    const pool: Fitted[] = state.player.builds.flatMap((build) => build.modules.map((fitted) => ({ ...fitted })));
    for (const [key, held] of Object.entries(state.player.parts)) {
      const [id, grade] = key.split(':');
      for (let i = 0; i < held; i++) pool.push({ id: id!, grade: Number(grade) });
    }
    pool.sort((a, b) => b.grade - a.grade);
    const bases = new Map<ProgramKind, ProgramDef>();
    // A program already built on counts too: its build stands in for it on the drive.
    const builtOn = content.programs.filter((program) => state.player.builds.some((build) => build.base === program.id));
    for (const program of [...buildBases(state, content), ...builtOn]) {
      if ((bases.get(program.kind)?.version ?? 0) < program.version) bases.set(program.kind, program);
    }
    const slots = moduleSlots(state, content);
    const plan = new Map<string, Fitted[]>();
    for (const part of pool) {
      for (const kind of FITS[part.id] ?? []) {
        const base = bases.get(kind);
        const fitted = base ? (plan.get(base.id) ?? []) : [];
        if (!base || fitted.length >= slots || fitted.some((other) => other.id === part.id)) continue;
        plan.set(base.id, [...fitted, part]);
        break;
      }
    }
    const same = (a: readonly Fitted[], b: readonly Fitted[]) => a.length === b.length && a.every((x) => b.some((y) => y.id === x.id && y.grade === x.grade));
    for (const build of [...state.player.builds]) {
      const want = plan.get(build.base);
      if (want && same(want, build.modules)) plan.delete(build.base);
      else act({ type: 'scrapProgram', programId: build.id });
    }
    for (const [base, modules] of plan) {
      if (!act({ type: 'buildProgram', base, modules }).ok) continue;
      idle(() => state.tasks.length === 0);
      const build = state.player.builds[state.player.builds.length - 1];
      if (!build) continue;
      built.push({ name: findProgram(content, build.id, state)?.name ?? build.id, atMinutes: minutes() });
    }
  };

  /** Room the job in hand needs for the files it brings home, in GB. */
  const haul = (): number => {
    const job = activeContract(state, content);
    if (!job) return 0;
    let room = 0;
    for (const stage of stagesOf(job)) {
      if (stage.objective.kind !== 'steal') continue;
      const name = stage.objective.file;
      room += state.servers[stage.targetId]?.files.find((item) => item.name === name)?.sizeGq ?? 0;
    }
    return room;
  };

  /** Logs in to the board, takes the best contract it can do, and shops. Returns the contract taken. */
  const visitBoard = (): ContractDef | undefined => {
    // A player with more work to do than the relays can bear lets them cool between jobs.
    idle(() => Object.keys(state.relayHeat).every((id) => relayHeat(state, content, id) <= 1.5), 600);
    const connection = open(board.id, [], false);
    think();
    must({ type: 'login', connectionId: connection.id, user: board.accounts[0]!.user });
    if (!profile.bestRelays || state.contracts.completed.length > 0) read(connection);
    const offered = availableContracts(state, content).filter((contract) => !skipped.has(contract.id) && !options.shun?.(contract, state));
    const doable = offered
      .map((contract) => ({ contract, needs: needs(contract) }))
      .filter((item): item is { contract: ContractDef; needs: string[] } => {
        // A story mission comes with its address; any other target has to be in the address book already.
        if (item.needs === null || (!item.contract.story && !state.knownServers.includes(item.contract.targetId))) return false;
        return item.needs.reduce((sum, id) => sum + price(id), 0) <= state.player.balance;
      });
    if (options.note) for (const contract of offered) if (contract.story) note(`STORY ${contract.id} needs ${JSON.stringify(needs(contract))} (${(needs(contract) ?? []).reduce((sum, id) => sum + price(id), 0)}c of ${state.player.balance}c)`);
    // Whatever the story has left on the board comes first: nobody leaves that sitting.
    const story = doable.filter((item) => item.contract.story);
    const written = doable.filter((item) => !isJob(item.contract) && !item.contract.story).sort((a, b) => gateRating(state, a.contract) - gateRating(state, b.contract) || a.contract.pay - b.contract.pay);
    const standing_ = doable.filter((item) => isJob(item.contract)).sort((a, b) => b.contract.rating - a.contract.rating || b.contract.pay - a.contract.pay);
    const pick = story[0] ?? written[0] ?? standing_[0];
    if (pick) {
      think();
      // A standing job can come down off the board in the moment it takes to decide. Then there is nothing to take this visit.
      if (!act({ type: 'acceptContract', connectionId: connection.id, contractId: pick.contract.id }).ok) {
        act({ type: 'disconnectAll' });
        return undefined;
      }
      note(`TAKE "${pick.contract.title}" (${pick.contract.targetId})`);
      for (const id of pick.needs) if (!buy(id)) throw new Stuck(`could not buy ${id} for "${pick.contract.title}"`);
    }
    // Spare money goes on the next thing worth having.
    for (let again = profile.upgrades; again; ) {
      again = false;
      for (const id of wishes) {
        if (owns(id)) continue;
        // A grade the market does not sell at this rating yet: on to the next thing.
        const wish = moduleWish(id);
        if (wish && wish.grade > marketGrade(state, content)) continue;
        // Not on any shelf it can reach today: on to the next thing.
        if (!offer(id)) continue;
        // Nor anything that would take the room the job in hand needs for its file.
        const size = wish ? 0 : (findProgram(content, id)?.sizeGq ?? 0);
        if (size > 0 && size > freeStorageGb(state, content) - haul()) continue;
        if (state.player.balance >= price(id) + profile.reserve && buy(id)) again = true;
        break;
      }
    }
    if (kitCompleteMinutes === null && wishes.every(owns)) kitCompleteMinutes = minutes();
    think();
    act({ type: 'disconnectAll' });
    return pick?.contract;
  };

  const noteTitle = (): void => {
    for (const rung of options.ratings) {
      if (state.player.rating >= rung.min && !titles.some((line) => line.title === rung.title)) {
        titles.push({ title: rung.title, rating: rung.min, atMinutes: minutes(), contracts: state.contracts.completed.length, earned });
      }
    }
  };

  /** Works a taken contract through to being paid. Returns false if it was lost. */
  const work = (contract: ContractDef): { paid: boolean; caught: number; visits: number } => {
    let caught = 0;
    let visits = 0;
    let fruitless = 0;
    // Passwords broken and the job itself: the two things a trip can leave behind.
    const progress = () => `${Object.values(state.player.passwords).flat().length}/${fieldworkDone(contract)}`;
    while (!fieldworkDone(contract)) {
      const before = progress();
      visits++;
      try {
        visit(contract);
      } catch (error) {
        if (!(error instanceof Caught)) throw error;
        caught++;
        caughtTotal++;
        idle(() => !isLyingLow(state));
        if (activeContract(state, content)?.id !== contract.id) return { paid: false, caught, visits };
      }
      if (activeContract(state, content)?.id !== contract.id) return { paid: false, caught, visits };
      fruitless = progress() === before && !stagesOf(contract).some((stage) => stage.objective.kind === 'hunt') ? fruitless + 1 : 0;
      if (fruitless >= 3) throw new Stuck(`"${contract.title}" at ${findServer(content, contract.targetId)?.name}: the trace leaves no time to get anything done`);
    }
    // One more trip to clean up, if it had to leave before it could.
    const dirty = () => evidenceCount(state, step(contract).targetId) > 0;
    for (let trips = 0; profile.scrub && dirty() && trips < 2; trips++) {
      visits++;
      try {
        visit(contract);
      } catch (error) {
        if (!(error instanceof Caught)) throw error;
        caught++;
        caughtTotal++;
        idle(() => !isLyingLow(state));
      }
    }
    // Decrypt any stolen file still sealed, across every step.
    for (const stage of stagesOf(contract)) {
      const goal = stage.objective;
      if (goal.kind !== 'steal') continue;
      const file = state.player.files.find((item) => item.name === goal.file && item.encrypted);
      if (file) {
        must({ type: 'decryptFile', name: file.name });
        idle(() => state.tasks.length === 0);
      }
    }
    read();
    think();
    // It reads the notes on a leak job as carefully as a person would, and names the right one.
    const leak = leakOf(contract);
    const choiceId = leak ? nameChoice(leak.suspects.indexOf(leak.culprit)) : options.choices?.[contract.id];
    const before = state.player.balance;
    must(choiceId === undefined ? { type: 'deliverContract' } : { type: 'deliverContract', choiceId });
    // What it was paid, a round's earlier stops included (they were paid as they were done).
    earned += state.player.balance - before + (contract.round ? contract.round.each * (contract.stages?.length ?? 0) : 0);
    return { paid: true, caught, visits };
  };

  // Before anything else: the registry's address book, as the first message suggests.
  if (directory) {
    try {
      const connection = open(directory.id, [], false);
      const guest = directory.accounts.find((account) => account.role === 'guest');
      if (guest) {
        must({ type: 'login', connectionId: connection.id, user: guest.user });
        for (const server of content.servers) {
          if (server.listed && !state.knownServers.includes(server.id)) {
            wait(0.5);
            act({ type: 'learnServer', connectionId: connection.id, serverId: server.id });
          }
        }
        read(connection);
      }
      act({ type: 'disconnectAll' });
    } catch (error) {
      stuck.push(`registry: ${(error as Error).message}`);
      act({ type: 'disconnectAll' });
    }
  }
  noteTitle();

  let idleRounds = 0;
  while (
    state.contracts.completed.length < options.maxContracts &&
    realMs < options.maxMinutes * 60_000 &&
    !options.until?.(state) &&
    !(
      state.player.rating >= options.untilRating &&
      storyComplete(state, content) &&
      content.contracts.every((contract) => state.contracts.completed.includes(contract.id) || skipped.has(contract.id))
    )
  ) {
    const startMs = realMs;
    closestMs = Infinity;
    longestMs = 0;
    const finesBefore = fines;
    let contract: ContractDef | undefined;
    try {
      if (isLyingLow(state)) idle(() => !isLyingLow(state));
      tinker();
      contract = visitBoard();
      if (!contract) {
        // Nothing it can do right now: wait for the board to change, or an answer to arrive.
        if (++idleRounds > 6) {
          stuck.push(`rating ${state.player.rating}, ${state.player.balance}c: nothing on the board it can do`);
          break;
        }
        idle(() => false, 240);
        continue;
      }
      idleRounds = 0;
      const result = work(contract);
      if (result.paid) {
        jobs.push({
          id: contract.id,
          title: contract.title,
          job: isJob(contract),
          steps: stagesOf(contract).length,
          story: contract.story === true,
          pay: contract.pay,
          seconds: Math.round((realMs - startMs) / 1000),
          ratingAfter: state.player.rating,
          balanceAfter: state.player.balance,
          caught: result.caught,
          visits: result.visits,
          closest: Number.isFinite(closestMs) ? Math.round(closestMs / 100) / 10 : null,
          fined: fines - finesBefore,
          traceSeconds: longestMs > 0 ? Math.round(longestMs / 1000) : null,
        });
        noteTitle();
        options.snapshot?.(state, content);
      }
    } catch (error) {
      if (error instanceof Caught) {
        caughtTotal++;
        idle(() => !isLyingLow(state));
        continue;
      }
      if (!(error instanceof Stuck)) throw error;
      stuck.push(contract ? `"${contract.title}": ${error.message}` : error.message);
      act({ type: 'disconnectAll' });
      if (contract) {
        skipped.add(contract.id);
        act({ type: 'abandonContract' });
      } else break;
    }
  }

  return {
    profile: profile.name,
    seed,
    jobs,
    titles,
    stuck,
    minutes: minutes(),
    earned,
    fines,
    caught: caughtTotal,
    finalRating: state.player.rating,
    finalBalance: state.player.balance,
    written: content.contracts.filter((contract) => state.contracts.completed.includes(contract.id)).length,
    bought,
    learned,
    built,
    found,
    kitCompleteMinutes,
    raids,
    story: storyLines,
    richest,
  };
}

/** The report as plain text, for reading in a terminal. */
export function formatCareer(report: CareerReport): string {
  const lines: string[] = [];
  const pad = (text: string | number, width: number) => String(text).padEnd(width);
  lines.push(`== ${report.profile} player, seed ${report.seed} ==`);
  lines.push(
    `${report.minutes} min played, ${report.jobs.length} delivered (${report.written} written), rating ${report.finalRating}, earned ${report.earned}c, fines ${report.fines}c, traced ${report.caught}x, ` +
      `${Math.round(report.earned / Math.max(1, report.minutes / 60))}c per hour`,
  );
  const close = report.jobs.flatMap((job) => (job.closest === null ? [] : [job.closest]));
  if (close.length > 0) {
    lines.push(`Traces: ran on ${close.length} jobs, closest ${Math.min(...close)}s, typically ${[...close].sort((a, b) => a - b)[Math.floor(close.length / 2)]}s to spare`);
  }
  lines.push('Titles:');
  report.titles.forEach((line, index) => {
    const next = report.titles[index + 1];
    const span = next ? next.atMinutes - line.atMinutes : report.minutes - line.atMinutes;
    const gain = (next ? next.earned : report.earned) - line.earned;
    lines.push(
      `  ${pad(line.title, 10)} at ${pad(`${line.atMinutes} min`, 10)} after ${pad(line.contracts, 3)} jobs; held ${pad(`${Math.round(span * 10) / 10} min`, 10)} ${span > 0 ? `${Math.round(gain / (span / 60))}c/h` : ''}`,
    );
  });
  lines.push('Work:');
  for (const job of report.jobs) {
    lines.push(
      `  ${pad(job.job ? 'job' : 'written', 8)}${pad(job.title.slice(0, 30), 31)}${pad(`${job.pay}c`, 7)}${pad(`${job.seconds}s`, 6)}rating ${pad(job.ratingAfter, 3)} bal ${pad(job.balanceAfter, 7)}${job.caught ? ` traced ${job.caught}x` : ''}${job.visits > 1 ? ` ${job.visits} visits` : ''}${job.closest === null ? '' : `  trace ${job.traceSeconds}s long, ${job.closest}s off`}${job.fined > 0 ? `  fined ${job.fined}c` : ''}`,
    );
  }
  lines.push('Bought:');
  for (const item of report.bought) lines.push(`  ${pad(`${item.atMinutes} min`, 10)}${pad(item.name, 32)}${item.price}c`);
  if (report.learned.length > 0) lines.push(`Skills: ${report.learned.map((item) => `${item.name} (${item.atMinutes})`).join(', ')}`);
  if (report.built.length > 0) {
    lines.push(`Built (${report.found} installers found):`);
    for (const item of report.built) lines.push(`  ${pad(`${item.atMinutes} min`, 10)}${item.name}`);
  }
  lines.push(report.kitCompleteMinutes === null ? 'Kit: not everything bought' : `Kit: everything bought by ${report.kitCompleteMinutes} min`);
  const rate = (jobs: readonly JobLine[]) => Math.round((jobs.reduce((sum, job) => sum + job.pay, 0) / Math.max(1, jobs.reduce((sum, job) => sum + job.seconds, 0))) * 60);
  const late = report.jobs.filter((job) => !job.story && job.ratingAfter > 12);
  lines.push(`Pay from Ghost up: one-step jobs ${rate(late.filter((job) => job.steps === 1))}c a minute, jobs with steps ${rate(late.filter((job) => job.steps > 1))}c a minute`);
  lines.push(`Money: ${report.finalBalance}c in hand at the end, never more than ${report.richest.balance}c (at ${report.richest.atMinutes} min)`);
  if (report.story.length > 0) lines.push(`Story: ${report.story.map((beat) => `${beat.id} (${beat.atMinutes} min, rating ${beat.rating})`).join(', ')}`);
  lines.push(
    report.raids.length === 0
      ? 'Enemy hackers: none came'
      : `Enemy hackers: ${report.raids.map((raid) => `${raid.who} ${raid.result} (${raid.atMinutes} min, rating ${raid.rating}${raid.story ? ', story' : ''})`).join(', ')}`,
  );
  if (report.stuck.length > 0) {
    lines.push('Stuck:');
    for (const reason of report.stuck) lines.push(`  ${reason}`);
  }
  return lines.join('\n');
}
