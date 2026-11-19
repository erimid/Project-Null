/**
 * A scripted player. It plays a whole career through the same actions
 * the screens send, on the real clock, and reports how it went: how long
 * each rating took, what the work paid per hour, and where it got stuck.
 * The balance tests run it against the real data files, so a change to a
 * price or a timing that breaks the climb fails a test.
 *
 * It is a tool for tests and tuning. The game itself never runs it.
 */
import type { ContractDef, ProgramDef, ProgramKind, ServerDef } from '../content/schema';
import type { HardwareDef } from '../content/hardware';
import { applyAction, type Action } from './actions';
import { tick } from './clock';
import { activeContract, availableContracts, isLyingLow, postJobs } from './contracts';
import { buildBases, findModule, hasTrait, marketGrade, moduleSlots, partTaken } from './crafting';
import { evidenceCount, isEvidence } from './forensics';
import { worldFor } from './generate';
import { maxConnections } from './hardware';
import { isJob } from './jobs';
import { heldBy, monitorHeld } from './link';
import { canRead, judge, knownFacts, knownPeople, standing } from './phish';
import { skillRank } from './skills';
import { createGame, MAX_HOPS, type Connection, type Fitted, type GameState, type TaskTarget } from './state';
import { checkTask, freeStorageGb, layerSeconds, MAX_LEVEL_GAP, ringAngle } from './tasks';
import { intruding, relayWorth, totalTraceMs } from './trace';
import { goalMet, readFlag, stagesOf, stageView } from './stages';
import { fileDef, findProgram, findServer, linkOf, ownedProgram, securityOf, syncWithContent, type Content } from './world';

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
  careful: { name: 'careful', hops: MAX_HOPS, bestRelays: true, thinkSeconds: 1.5, rings: true, echo: true, scrub: true, phish: true, marginSeconds: 4, reserve: 1000, upgrades: true, skills: SKILLS_CAREFUL, craft: true },
  /** Uses a few relays, scrubs, ignores the hands-on shortcuts. */
  typical: { name: 'typical', hops: 5, bestRelays: false, thinkSeconds: 3, rings: false, echo: false, scrub: true, phish: true, marginSeconds: 5, reserve: 500, upgrades: true, skills: SKILLS_TYPICAL, craft: true },
  /** Two relays, slow hands, never cleans up. */
  careless: { name: 'careless', hops: 2, bestRelays: false, thinkSeconds: 4, rings: false, echo: false, scrub: false, phish: false, marginSeconds: 2, reserve: 0, upgrades: true },
} as const satisfies Record<string, Profile>;

export interface JobLine {
  readonly id: string;
  readonly title: string;
  readonly job: boolean;
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
}

/** Leaving a connection before the trace gets there. */
class Bail extends Error {}
/** A trace got there first. */
class Caught extends Error {}
/** Something that cannot be done with what the player has. */
class Stuck extends Error {}

const TICK_MS = 100;

/** Things bought when there is money to spare, most useful first. */
const WISHES: readonly string[] = [
  'proxy-bypass',
  'firewall-bypass',
  'ports-2',
  'monitor-bypass',
  'route-planner',
  'cpu-2',
  'decrypter',
  'modem-2',
  'storage-2',
  'password-breaker-2',
  'firewall-bypass-2',
  'proxy-bypass-2',
  'cpu-3',
  'monitor-bypass-2',
  'modem-3',
  'storage-3',
  'ports-3',
  'rack-1',
  'cpu-4',
  'modem-4',
  'storage-4',
  'route-planner-2',
  'rack-2',
  'route-planner-3',
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
  'modem-2',
  'storage-2',
  'password-breaker-2',
  'firewall-bypass-2',
  'mod:swift:2',
  'proxy-bypass-2',
  'cpu-3',
  'mod:quiet:2',
  'monitor-bypass-2',
  'modem-3',
  'storage-3',
  'decompiler',
  'mod:tidy:2',
  'ports-3',
  'rack-1',
  'mod:swift:3',
  'cpu-4',
  'mod:quiet:3',
  'modem-4',
  'storage-4',
  'mod:tidy:3',
  'rack-2',
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
  const stuck: string[] = [];
  const jobs: JobLine[] = [];
  const titles: TitleLine[] = [];
  const bought: { name: string; price: number; atMinutes: number }[] = [];
  const learned: { name: string; atMinutes: number }[] = [];
  const built: { name: string; atMinutes: number }[] = [];
  let found = 0;
  const wishes = profile.craft ? CRAFT_WISHES : WISHES;
  const skipped = new Set<string>();
  const minutes = () => Math.round((realMs / 60_000) * 10) / 10;

  const board = content.servers.find((server) => server.kind === 'board');
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

  /** Lets real time pass. Throws Caught if a trace reaches the gateway meanwhile. */
  const wait = (seconds: number, done?: () => boolean): void => {
    const held = state.connections.map((connection) => connection.id);
    const lowBefore = state.player.lieLowUntilMs;
    for (let left = seconds * 1000; left > 0 && !done?.(); left -= TICK_MS) {
      const balance = state.player.balance;
      tick(state, TICK_MS, content);
      realMs += TICK_MS;
      // Money only goes down inside a tick through a fine.
      if (state.player.balance < balance) fines += balance - state.player.balance;
      for (const connection of state.connections) {
        const trace = connection.trace;
        if (trace.status === 'active') closestMs = Math.min(closestMs, totalTraceMs(trace) - trace.elapsedMs);
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
    if (trace.status === 'active') return total - trace.elapsedMs + connection.monitor.blindMs;
    if (trace.status === 'pending') return trace.graceMs + total;
    // A blind monitor sees nothing until it comes back. Then it sees an administrator, or a program still running.
    if (!intrude && !intruding(content, connection)) return Infinity;
    return connection.monitor.blindMs + graceMs(findServer(content, connection.serverId)!) + total;
  };

  /** Leaves rather than start something the traces would not let finish. */
  const checkTime = (connection: Connection, seconds: number, intrude: boolean): void => {
    const stepMs = (seconds + profile.thinkSeconds) * 1000;
    for (const other of state.connections) {
      if (timeLeftMs(other, intrude && other === connection) < stepMs + profile.marginSeconds * 1000) throw new Bail();
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
    if (server.security.proxy > 0 && !connection.bypassed.proxy) {
      if (!ownedProgram(state, content, 'bypassProxy')) return;
      run(connection, { kind: 'proxy' });
    }
    // A review may have closed the case while the proxy was being dealt with.
    if (lines().length > 0) run(connection, { kind: 'deleteLog', logIds: lines() });
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

  /** One trip to the current step's target. Returns false if it had to leave early. */
  const visit = (contract: ContractDef): boolean => {
    const stage = step(contract);
    const server = findServer(content, stage.targetId)!;
    try {
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
    const best = ownedProgram(state, content, program.kind);
    return best !== undefined && best.version >= program.version;
  };

  /** Buys one thing on the board connection. Returns false if it can't. */
  const buy = (connectionId: string, id: string): boolean => {
    const wish = moduleWish(id);
    if (wish) {
      const module = findModule(content, wish.id);
      const ok = act({ type: 'buyModule', connectionId, moduleId: wish.id, grade: wish.grade }).ok;
      if (ok && module) bought.push({ name: `${module.name} ${wish.grade} module`, price: module.grades[wish.grade - 1]!.price, atMinutes: minutes() });
      return ok;
    }
    const part: HardwareDef | undefined = content.hardware.find((item) => item.id === id);
    const program: ProgramDef | undefined = findProgram(content, id);
    if (!part && !program) return false;
    if (program) {
      // An older version only takes up room.
      const older = content.programs.find((own) => state.player.programs.includes(own.id) && own.kind === program.kind && own.version < program.version);
      if (state.player.balance < program.price) return false;
      if (older && program.sizeGq - older.sizeGq <= freeStorageGb(state, content)) act({ type: 'uninstallProgram', programId: older.id });
    }
    const result = part ? act({ type: 'buyHardware', connectionId, partId: id }) : act({ type: 'buyProgram', connectionId, programId: id });
    if (result.ok) bought.push({ name: part?.name ?? `${program!.name} v${program!.version}`, price: (part ?? program!).price, atMinutes: minutes() });
    return result.ok;
  };

  /** What a contract cannot be done without, as ids of things to own. Null if nothing sold would do. */
  const needs = (contract: ContractDef): string[] | null => {
    const list: string[] = [];
    const cheapest = (kind: ProgramDef['kind'], level: number): string | null => {
      const fit = content.programs
        .filter((program) => program.kind === kind && layerSeconds(program, level) !== null)
        .sort((a, b) => a.price - b.price)[0];
      return fit?.id ?? null;
    };
    const want = (kind: ProgramDef['kind'], level: number): boolean => {
      const own = ownedProgram(state, content, kind);
      if (own && level - own.version <= MAX_LEVEL_GAP) return true;
      const id = cheapest(kind, level);
      if (id === null) return false;
      list.push(id);
      return true;
    };
    // Every step must be doable, so gear for the hardest layer each one presents.
    for (const stage of stagesOf(contract)) {
      const server = findServer(content, stage.targetId);
      if (!server) return null;
      const sec = securityOf(state, server);
      const goal = stage.objective;
      const admin = adminOf(server);
      const needsAdmin = goal.kind !== 'read' || goal.file === undefined;
      if (admin && sec.password > 0 && needsAdmin && !state.player.passwords[server.id]?.includes(admin.user)) {
        if (!want('breakPassword', sec.password)) return null;
      }
      if (goal.kind === 'record' || goal.kind === 'frame') {
        if (sec.proxy > 0 && !want('bypassProxy', sec.proxy)) return null;
      } else if ((goal.kind === 'steal' || goal.kind === 'destroy' || goal.kind === 'plant' || goal.kind === 'read') && sec.firewall > 0) {
        const linked = linkOf(state, server)?.layer === 'firewall';
        const own = ownedProgram(state, content, 'bypassFirewall');
        const reachable = cheapest('bypassFirewall', sec.firewall) !== null;
        if (linked && (!reachable || maxConnections(state, content) >= 2)) {
          if (maxConnections(state, content) < 2) list.push('ports-2');
        } else if (!own || sec.firewall - own.version > MAX_LEVEL_GAP) {
          if (!want('bypassFirewall', sec.firewall)) return null;
        }
      }
      if (goal.kind === 'steal') {
        const file = state.servers[server.id]?.files.find((item) => item.name === goal.file);
        if (file?.encrypted && !want('decrypt', file.encrypted)) return null;
        if (file && file.sizeGq > freeStorageGb(state, content)) {
          const next = content.hardware.find((part) => part.slot === 'storage' && part.tier === state.player.hardware.storage + 1);
          if (!next) return null;
          list.push(next.id);
        }
      }
    }
    return [...new Set(list)];
  };

  const price = (id: string): number => {
    const wish = moduleWish(id);
    if (wish) return findModule(content, wish.id)?.grades[wish.grade - 1]?.price ?? 0;
    return content.hardware.find((part) => part.id === id)?.price ?? findProgram(content, id)?.price ?? 0;
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
    for (const program of buildBases(state, content)) {
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
      act({ type: 'preferProgram', programId: build.id });
      built.push({ name: findProgram(content, build.id, state)?.name ?? build.id, atMinutes: minutes() });
    }
  };

  /** Logs in to the board, takes the best contract it can do, and shops. Returns the contract taken. */
  const visitBoard = (): ContractDef | undefined => {
    const connection = open(board.id, [], false);
    think();
    must({ type: 'login', connectionId: connection.id, user: board.accounts[0]!.user });
    if (!profile.bestRelays || state.contracts.completed.length > 0) read(connection);
    const offered = availableContracts(state, content).filter((contract) => !skipped.has(contract.id));
    const doable = offered
      .map((contract) => ({ contract, needs: needs(contract) }))
      .filter((item): item is { contract: ContractDef; needs: string[] } => {
        if (item.needs === null || !state.knownServers.includes(item.contract.targetId)) return false;
        return item.needs.reduce((sum, id) => sum + price(id), 0) <= state.player.balance;
      });
    const written = doable.filter((item) => !isJob(item.contract)).sort((a, b) => a.contract.minRating - b.contract.minRating || a.contract.pay - b.contract.pay);
    const standing_ = doable.filter((item) => isJob(item.contract)).sort((a, b) => b.contract.rating - a.contract.rating || b.contract.pay - a.contract.pay);
    const pick = written[0] ?? standing_[0];
    if (pick) {
      for (const id of pick.needs) if (!buy(connection.id, id)) throw new Stuck(`could not buy ${id} for "${pick.contract.title}"`);
      think();
      must({ type: 'acceptContract', connectionId: connection.id, contractId: pick.contract.id });
      note(`TAKE "${pick.contract.title}" (${pick.contract.targetId})`);
    }
    // Spare money goes on the next thing worth having.
    for (let again = profile.upgrades; again; ) {
      again = false;
      for (const id of wishes) {
        if (owns(id)) continue;
        // A grade the market does not sell at this rating yet: on to the next thing.
        const wish = moduleWish(id);
        if (wish && wish.grade > marketGrade(state, content)) continue;
        if (state.player.balance >= price(id) + profile.reserve && buy(connection.id, id)) again = true;
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
      fruitless = progress() === before ? fruitless + 1 : 0;
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
    must({ type: 'deliverContract' });
    earned += contract.pay;
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
    !(state.player.rating >= options.untilRating && content.contracts.every((contract) => state.contracts.completed.includes(contract.id) || skipped.has(contract.id)))
  ) {
    const startMs = realMs;
    closestMs = Infinity;
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
          pay: contract.pay,
          seconds: Math.round((realMs - startMs) / 1000),
          ratingAfter: state.player.rating,
          balanceAfter: state.player.balance,
          caught: result.caught,
          visits: result.visits,
          closest: Number.isFinite(closestMs) ? Math.round(closestMs / 100) / 10 : null,
          fined: fines - finesBefore,
        });
        noteTitle();
      }
    } catch (error) {
      if (error instanceof Caught) {
        caughtTotal++;
        idle(() => !isLyingLow(state));
        continue;
      }
      if (!(error instanceof Stuck)) throw error;
      stuck.push(error.message);
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
      `  ${pad(job.job ? 'job' : 'written', 8)}${pad(job.title.slice(0, 30), 31)}${pad(`${job.pay}c`, 7)}${pad(`${job.seconds}s`, 6)}rating ${pad(job.ratingAfter, 3)} bal ${pad(job.balanceAfter, 7)}${job.caught ? ` traced ${job.caught}x` : ''}${job.visits > 1 ? ` ${job.visits} visits` : ''}${job.closest === null ? '' : `  trace ${job.closest}s off`}${job.fined > 0 ? `  fined ${job.fined}c` : ''}`,
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
  if (report.stuck.length > 0) {
    lines.push('Stuck:');
    for (const reason of report.stuck) lines.push(`  ${reason}`);
  }
  return lines.join('\n');
}
