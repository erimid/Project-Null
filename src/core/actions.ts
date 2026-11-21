/**
 * Everything the player can do to the game goes through here as an
 * "action": a small plain object. The UI never changes GameState itself.
 * That keeps the rules in one place and makes them testable.
 */
import { MAX_HOPS, ROUTE_SLOTS, SPEEDS, isConnected, type Connection, type Fitted, type GameState, type Speed, type TaskTarget } from './state';
import {
  abandonContract,
  acceptContract,
  alterRecord,
  buyProgram,
  deleteStoredFile,
  activeContract,
  deliverContract,
  frameLog,
  punish,
  uninstallProgram,
} from './contracts';
import { scheduleReview } from './forensics';
import { reportCaught } from './news';
import { advanceContract } from './stages';
import { buyHardware, loseHardware, maxConnections } from './hardware';
import { modelRead, rentModel } from './model';
import { readFile, sendPhish } from './phish';
import { buyModule, preferProgram, refineModule, returnModules, scrapBuild } from './crafting';
import { learnSkill, unlearnSkills } from './skills';
import { canLogIn, echoCell, lockRing, startTask, usedStorageGq } from './tasks';
import { bestRoute, coolRelays, hopUnderTrace, intruding, jamTrace, newTrace, noteIntrusion, reroute, warmRelay } from './trace';
import { lockRaidFile, lockRaidRing, openRaidPort, pullPlug, startRaidTrace } from './raid';
import { findAccount, findConnection, findServer, gatewayOf, once, ownedProgram, sendMail, sourceAddress, type Content } from './world';

export type Action =
  | { readonly type: 'setSpeed'; readonly speed: Speed }
  /** Add a relay to the end of the planned route. */
  | { readonly type: 'addHop'; readonly serverId: string }
  | { readonly type: 'removeHop'; readonly serverId: string }
  | { readonly type: 'clearRoute' }
  /** Fills the route with the best relays the player knows, leaving out the server they mean to connect to. */
  | { readonly type: 'autoRoute'; readonly targetId: string | null }
  /** Keep the planned route in a slot, to load again later. */
  | { readonly type: 'saveRoute'; readonly slot: number }
  /** Make a kept route the planned route. Servers that cannot be relays any more are left out. */
  | { readonly type: 'loadRoute'; readonly slot: number }
  | { readonly type: 'toggleBookmark'; readonly serverId: string }
  /** Open a connection to a server through the planned route. */
  | { readonly type: 'connect'; readonly serverId: string }
  | { readonly type: 'disconnect'; readonly connectionId: string }
  | { readonly type: 'disconnectAll' }
  | { readonly type: 'login'; readonly connectionId: string; readonly user: string }
  /** Go back to the login screen without dropping the connection. */
  | { readonly type: 'logout'; readonly connectionId: string }
  /** Copy an address from a directory server into the player's address book. */
  | { readonly type: 'learnServer'; readonly connectionId: string; readonly serverId: string }
  /** Run a program against something on a connection. */
  | { readonly type: 'runProgram'; readonly connectionId: string; readonly target: TaskTarget }
  | { readonly type: 'cancelProgram'; readonly taskId: string }
  /** Try to lock one ring of a running program's port line-up. */
  | { readonly type: 'lockRing'; readonly taskId: string; readonly ring: number }
  /** Swap the relay a trace is working on for another server. */
  | { readonly type: 'reroute'; readonly connectionId: string; readonly serverId: string }
  /** Freeze a running trace with a Trace Jammer. Once per connection. */
  | { readonly type: 'jamTrace'; readonly connectionId: string }
  /** Scan a known server to learn its security before connecting. Runs on the gateway. */
  | { readonly type: 'scanServer'; readonly serverId: string }
  | { readonly type: 'readMessage'; readonly messageId: string }
  /** Take a contract from the board you are logged in to. */
  | { readonly type: 'acceptContract'; readonly connectionId: string; readonly contractId: string }
  | { readonly type: 'abandonContract' }
  /** Hand in the finished contract and get paid. `choiceId` picks another way to finish it, if the brief offers one. */
  | { readonly type: 'deliverContract'; readonly choiceId?: string }
  /** Write a false line into the log that points at the person the contract wants framed. */
  | { readonly type: 'frameLog'; readonly connectionId: string }
  /** Make the record change the active contract asks for. */
  | { readonly type: 'alterRecord'; readonly connectionId: string }
  /** Buy a program from the market on the board you are logged in to. */
  | { readonly type: 'buyProgram'; readonly connectionId: string; readonly programId: string }
  /** Remove an installed program from the gateway to free its room. */
  | { readonly type: 'uninstallProgram'; readonly programId: string }
  /** Buy a hardware part from the board you are logged in to. It is installed at once. */
  | { readonly type: 'buyHardware'; readonly connectionId: string; readonly partId: string }
  /** Rent a language model from the board you are logged in to. */
  | { readonly type: 'rentModel'; readonly connectionId: string; readonly modelId: string }
  /** Have the rented model read every file on a connection. */
  | { readonly type: 'modelRead'; readonly connectionId: string }
  /** Note what a file says: the people it names and the details in it. */
  | { readonly type: 'readFile'; readonly serverId: string; readonly name: string }
  /** Write to someone as somebody else, mentioning some details. */
  | { readonly type: 'sendPhish'; readonly askId: string; readonly senderId: string; readonly factIds: readonly string[] }
  /** Repeat one cell of the monitor's handshake pattern. */
  | { readonly type: 'echoCell'; readonly connectionId: string; readonly cell: number }
  /** Decrypt a file stored on the gateway. */
  | { readonly type: 'decryptFile'; readonly name: string }
  /** Delete a file stored on the gateway. */
  | { readonly type: 'deleteStoredFile'; readonly name: string }
  /** Spend skill points on the next rank of a skill. */
  | { readonly type: 'learnSkill'; readonly skillId: string }
  /** Pay the board you are logged in to to forget every skill and get the points back. */
  | { readonly type: 'unlearnSkills'; readonly connectionId: string }
  /** Start building a crafted program at the Workbench. */
  | { readonly type: 'buildProgram'; readonly base: string; readonly modules: readonly Fitted[] }
  /** Take a crafted program apart and get its modules back. */
  | { readonly type: 'scrapProgram'; readonly programId: string }
  /** Melt two modules of one grade into one of the next. */
  | { readonly type: 'refineModule'; readonly moduleId: string; readonly grade: number }
  /** Pick which installed program runs for its kind. */
  | { readonly type: 'preferProgram'; readonly programId: string }
  /** Buy a module from the board you are logged in to. */
  | { readonly type: 'buyModule'; readonly connectionId: string; readonly moduleId: string; readonly grade: number }
  /** Take a program file stored on the gateway apart into modules. */
  | { readonly type: 'decompileFile'; readonly name: string }
  /** Open a port line-up on the barrier an intruder is probing. */
  | { readonly type: 'defendPort' }
  /** Try to lock one ring of the open defence port. */
  | { readonly type: 'defendRing'; readonly ring: number }
  /** Start the counter-trace back along an intruder's route. */
  | { readonly type: 'traceBack' }
  /** Lock a file or program on the gateway so a lost attack cannot take it. */
  | { readonly type: 'lockFile'; readonly name: string }
  /** Pull the plug: break off an attack, dropping every connection. */
  | { readonly type: 'pullPlug' };

export type ActionResult = { readonly ok: true } | { readonly ok: false; readonly reason: string };

const OK: ActionResult = { ok: true };
const refuse = (reason: string): ActionResult => ({ ok: false, reason });
const answer = (reason: string | null): ActionResult => (reason === null ? OK : refuse(reason));

function writeLog(state: GameState, serverId: string, text: string): void {
  state.servers[serverId]?.logs.push({ id: state.nextId++, timeMs: state.clock.gameTimeMs, text, byPlayer: true });
}

/** Every server on the way notes the connection passing through, and the target notes it ending. */
function logConnection(state: GameState, content: Content, connection: Connection, opened: boolean): void {
  const chain = [gatewayOf(content).id, ...connection.route, connection.serverId];
  for (let i = 1; i < chain.length - 1; i++) {
    const from = findServer(content, chain[i - 1]!)?.address;
    const to = findServer(content, chain[i + 1]!)?.address;
    writeLog(state, chain[i]!, opened ? `relay opened ${from} > ${to}` : `relay closed ${from}`);
  }
  const source = sourceAddress(content, connection);
  writeLog(state, connection.serverId, opened ? `connection opened from ${source}` : `connection closed ${source}`);
}

function closeConnection(state: GameState, content: Content, connection: Connection): void {
  if (connection.user !== null) writeLog(state, connection.serverId, `logout ${connection.user}`);
  logConnection(state, content, connection, false);
  // If the monitor noticed anything, someone will read the log later.
  if (connection.trace.status !== 'none') scheduleReview(state, content, connection.serverId);
  state.connections = state.connections.filter((other) => other !== connection);
  // Programs stop when the connection they were working on goes away.
  state.tasks = state.tasks.filter((task) => task.connectionId !== connection.id);
}

/** A watching model hung up before the trace got there. Nothing is lost but the connection. */
export function pullOut(state: GameState, content: Content, connection: Connection): void {
  closeConnection(state, content, connection);
}

/** A trace reached the gateway: the connection is cut, the player pays for it and is told. */
export function caught(state: GameState, content: Content, connection: Connection): void {
  const server = findServer(content, connection.serverId);
  closeConnection(state, content, connection);
  const { fine, hours } = punish(state, content, connection.serverId);
  reportCaught(state, content, connection.serverId);
  const target = server?.name ?? 'the target';
  sendMail(state, content, 'caught', { target, fine: String(fine), hours: String(hours) });
  loseHardware(state, content, connection.serverId);
}

export function applyAction(state: GameState, action: Action, content: Content): ActionResult {
  const result = act(state, action, content);
  // Whatever the player did may have finished a step of the contract under way.
  const contract = result.ok ? activeContract(state, content) : undefined;
  if (contract) advanceContract(state, content, contract);
  return result;
}

function act(state: GameState, action: Action, content: Content): ActionResult {
  switch (action.type) {
    case 'setSpeed': {
      if (!SPEEDS.includes(action.speed)) return refuse('Unknown speed.');
      if (isConnected(state)) return refuse('Time is locked while a connection is open.');
      state.clock.speed = action.speed;
      return OK;
    }

    case 'addHop': {
      const server = findServer(content, action.serverId);
      if (!server || !state.knownServers.includes(server.id)) return refuse('You do not have that address.');
      if (server.kind === 'gateway') return refuse('Your gateway is always the start of the route.');
      if (state.route.includes(server.id)) return refuse(`${server.name} is already in the route.`);
      if (state.route.length >= MAX_HOPS) return refuse(`A route can have at most ${MAX_HOPS} relays.`);
      state.route.push(server.id);
      return OK;
    }

    case 'removeHop': {
      if (!state.route.includes(action.serverId)) return refuse('That server is not in the route.');
      state.route = state.route.filter((id) => id !== action.serverId);
      return OK;
    }

    case 'clearRoute': {
      state.route = [];
      return OK;
    }

    case 'saveRoute': {
      if (!Number.isInteger(action.slot) || action.slot < 0 || action.slot >= ROUTE_SLOTS) return refuse('There is no such slot.');
      if (state.route.length === 0) return refuse('There is no route to keep. Add some relays first.');
      state.savedRoutes[action.slot] = [...state.route];
      return OK;
    }
    case 'loadRoute': {
      const saved = state.savedRoutes[action.slot];
      if (!saved || saved.length === 0) return refuse('That slot is empty.');
      const busy = new Set(state.connections.map((connection) => connection.serverId));
      state.route = saved.filter((id) => state.knownServers.includes(id) && !busy.has(id) && !!findServer(content, id)).slice(0, MAX_HOPS);
      return OK;
    }
    case 'autoRoute': {
      const planner = ownedProgram(state, content, 'planRoute');
      if (!planner) return refuse('You need a Route Planner program for that. The Backroom sells them.');
      const route = bestRoute(state, content, action.targetId, planner.version);
      if (route.length === 0) return refuse('You do not know any servers to use as relays yet.');
      state.route = route;
      return OK;
    }

    case 'toggleBookmark': {
      if (!state.knownServers.includes(action.serverId)) return refuse('You do not have that address.');
      state.bookmarks = state.bookmarks.includes(action.serverId)
        ? state.bookmarks.filter((id) => id !== action.serverId)
        : [...state.bookmarks, action.serverId];
      return OK;
    }

    case 'connect': {
      const server = findServer(content, action.serverId);
      if (!server || !state.knownServers.includes(server.id)) return refuse('You do not have that address.');
      if (server.kind === 'gateway') return refuse('You are already at your gateway.');
      if (state.connections.some((connection) => connection.serverId === server.id)) {
        return refuse(`You are already connected to ${server.name}.`);
      }
      const most = maxConnections(state, content);
      if (state.connections.length >= most) {
        return refuse(
          most === 1
            ? 'Your gateway can hold one connection at a time. Disconnect first.'
            : `Your gateway can hold ${most} connections at a time. Disconnect one first.`,
        );
      }
      // The target can't be its own relay: connecting to a server in the route takes it out of the route.
      state.route = state.route.filter((id) => id !== server.id);
      const connection: Connection = {
        id: `c${state.nextId++}`,
        serverId: server.id,
        route: [...state.route],
        user: null,
        role: null,
        openedAtMs: state.clock.gameTimeMs,
        bypassed: { proxy: false, firewall: false },
        trace: newTrace(state, content, server, state.route),
        reroutes: 0,
        monitor: { blindMs: 0, used: false, echo: null },
      };
      // Every relay is a little warmer for the use. The trace above was worked out as they stood before.
      coolRelays(state, content);
      for (const id of connection.route) warmRelay(state, content, id);
      // The first proper route brings Wren's note on what relays are worth.
      if (connection.route.length >= 2) once(state, 'routes', () => sendMail(state, content, 'routes'));
      state.connections.push(connection);
      logConnection(state, content, connection, true);
      return OK;
    }

    case 'disconnect': {
      const connection = findConnection(state, action.connectionId);
      if (!connection) return refuse('That connection is already closed.');
      closeConnection(state, content, connection);
      return OK;
    }

    case 'disconnectAll': {
      for (const connection of [...state.connections]) closeConnection(state, content, connection);
      return OK;
    }

    case 'login': {
      const connection = findConnection(state, action.connectionId);
      if (!connection) return refuse('That connection is closed.');
      if (connection.user !== null) return refuse(`Already logged in as ${connection.user}.`);
      const server = findServer(content, connection.serverId);
      const account = server && findAccount(server, action.user);
      if (!server || !account) return refuse('No such account.');
      if (!canLogIn(state, server, account.user)) return refuse('That account needs a password.');
      connection.user = account.user;
      connection.role = account.role;
      writeLog(state, connection.serverId, `login ${account.user} from ${sourceAddress(content, connection)}`);
      // Walking in on a password-protected account is noticed, however you got the password.
      if (intruding(content, connection)) noteIntrusion(state, content, connection);
      return OK;
    }

    case 'logout': {
      const connection = findConnection(state, action.connectionId);
      if (!connection) return refuse('That connection is closed.');
      if (connection.user === null) return refuse('You are not logged in.');
      writeLog(state, connection.serverId, `logout ${connection.user}`);
      connection.user = null;
      connection.role = null;
      // Programs working inside the account stop with it. Bypassed layers stay open for this connection.
      state.tasks = state.tasks.filter((task) => task.connectionId !== connection.id);
      return OK;
    }

    case 'learnServer': {
      const connection = findConnection(state, action.connectionId);
      if (!connection || connection.user === null) return refuse('Log in first.');
      if (findServer(content, connection.serverId)?.kind !== 'directory') return refuse('This server has no directory.');
      const server = findServer(content, action.serverId);
      if (!server || !server.listed) return refuse('That server is not listed here.');
      if (state.knownServers.includes(server.id)) return refuse('You already have that address.');
      state.knownServers.push(server.id);
      return OK;
    }

    case 'runProgram': {
      const reason = startTask(state, content, action.connectionId, action.target);
      return reason === null ? OK : refuse(reason);
    }

    case 'buyHardware':
      return answer(buyHardware(state, content, action.connectionId, action.partId, usedStorageGq(state, content)));
    case 'rentModel':
      return answer(rentModel(state, content, action.connectionId, action.modelId));
    case 'modelRead':
      return answer(modelRead(state, content, action.connectionId));
    case 'readFile':
      return answer(readFile(state, content, action.serverId, action.name));
    case 'sendPhish':
      return answer(sendPhish(state, content, action));
    case 'echoCell':
      return answer(echoCell(state, content, action.connectionId, action.cell));
    case 'decryptFile':
      return answer(startTask(state, content, null, { kind: 'decrypt', file: action.name }));

    case 'lockRing':
      return answer(lockRing(state, content, action.taskId, action.ring));
    case 'jamTrace':
      return answer(jamTrace(state, content, action.connectionId));
    case 'scanServer':
      return answer(startTask(state, content, null, { kind: 'scan', serverId: action.serverId }));

    case 'reroute': {
      const connection = findConnection(state, action.connectionId);
      if (!connection) return refuse('That connection is closed.');
      const index = hopUnderTrace(connection);
      const dropped = connection.route[index];
      const reason = reroute(state, content, connection, action.serverId);
      if (reason !== null) return refuse(reason);
      // The relay that was dropped and the one that replaced it both note the change.
      const chain = [gatewayOf(content).id, ...connection.route, connection.serverId];
      const before = findServer(content, chain[index]!)?.address;
      const after = findServer(content, chain[index + 2]!)?.address;
      if (dropped) writeLog(state, dropped, `relay closed ${before}`);
      writeLog(state, action.serverId, `relay opened ${before} > ${after}`);
      return OK;
    }

    case 'cancelProgram': {
      const stopped = state.tasks.find((task) => task.id === action.taskId);
      if (!stopped) return refuse('That program has already stopped.');
      returnModules(state, stopped);
      state.tasks = state.tasks.filter((task) => task.id !== action.taskId);
      return OK;
    }

    case 'acceptContract':
      return answer(acceptContract(state, content, action.connectionId, action.contractId));
    case 'abandonContract':
      return answer(abandonContract(state, content));
    case 'deliverContract':
      return answer(deliverContract(state, content, action.choiceId));
    case 'frameLog':
      return answer(frameLog(state, content, action.connectionId));
    case 'alterRecord':
      return answer(alterRecord(state, content, action.connectionId));
    case 'buyProgram':
      return answer(buyProgram(state, content, action.connectionId, action.programId));
    case 'uninstallProgram':
      // A crafted program comes apart into its modules rather than vanishing.
      if (state.player.builds.some((build) => build.id === action.programId)) return answer(scrapBuild(state, action.programId));
      return answer(uninstallProgram(state, action.programId));
    case 'deleteStoredFile':
      return answer(deleteStoredFile(state, action.name));
    case 'learnSkill':
      return answer(learnSkill(state, content, action.skillId));
    case 'unlearnSkills':
      return answer(unlearnSkills(state, content, action.connectionId));
    case 'buildProgram':
      return answer(startTask(state, content, null, { kind: 'build', base: action.base, modules: action.modules.map((fitted) => ({ ...fitted })) }));
    case 'scrapProgram':
      return answer(scrapBuild(state, action.programId));
    case 'refineModule':
      return answer(refineModule(state, content, action.moduleId, action.grade));
    case 'preferProgram':
      return answer(preferProgram(state, content, action.programId));
    case 'buyModule':
      return answer(buyModule(state, content, action.connectionId, action.moduleId, action.grade));
    case 'decompileFile':
      return answer(startTask(state, content, null, { kind: 'decompile', file: action.name }));

    case 'defendPort':
      return answer(openRaidPort(state, content));
    case 'defendRing':
      return answer(lockRaidRing(state, content, action.ring));
    case 'traceBack':
      return answer(startRaidTrace(state, content));
    case 'lockFile':
      return answer(lockRaidFile(state, content, action.name));
    case 'pullPlug':
      return answer(pullPlug(state, content));

    case 'readMessage': {
      const message = state.messages.find((item) => item.id === action.messageId);
      if (!message) return refuse('No such message.');
      message.read = true;
      return OK;
    }
  }
}
