/**
 * Everything the player can do to the game goes through here as an
 * "action": a small plain object. The UI never changes GameState itself.
 * That keeps the rules in one place and makes them testable.
 */
import { MAX_HOPS, SPEEDS, isConnected, type Connection, type GameState, type Speed, type TaskTarget } from './state';
import {
  abandonContract,
  acceptContract,
  alterRecord,
  buyProgram,
  deleteStoredFile,
  deliverContract,
  punish,
  uninstallProgram,
} from './contracts';
import { scheduleReview } from './forensics';
import { modelRead, rentModel } from './model';
import { readFile, sendPhish } from './phish';
import { canLogIn, echoCell, lockRing, startTask } from './tasks';
import { hopUnderTrace, newTrace, noteIntrusion, reroute } from './trace';
import { findAccount, findConnection, findServer, gatewayOf, sendMail, sourceAddress, type Content } from './world';

export type Action =
  | { readonly type: 'setSpeed'; readonly speed: Speed }
  /** Add a relay to the end of the planned route. */
  | { readonly type: 'addHop'; readonly serverId: string }
  | { readonly type: 'removeHop'; readonly serverId: string }
  | { readonly type: 'clearRoute' }
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
  | { readonly type: 'readMessage'; readonly messageId: string }
  /** Take a contract from the board you are logged in to. */
  | { readonly type: 'acceptContract'; readonly connectionId: string; readonly contractId: string }
  | { readonly type: 'abandonContract' }
  /** Hand in the finished contract and get paid. */
  | { readonly type: 'deliverContract' }
  /** Make the record change the active contract asks for. */
  | { readonly type: 'alterRecord'; readonly connectionId: string }
  /** Buy a program from the market on the board you are logged in to. */
  | { readonly type: 'buyProgram'; readonly connectionId: string; readonly programId: string }
  /** Remove an installed program from the gateway to free its room. */
  | { readonly type: 'uninstallProgram'; readonly programId: string }
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
  | { readonly type: 'deleteStoredFile'; readonly name: string };

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
  const target = server?.name ?? 'the target';
  sendMail(state, content, 'caught', { target, fine: String(fine), hours: String(hours) });
}

export function applyAction(state: GameState, action: Action, content: Content): ActionResult {
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

    case 'connect': {
      const server = findServer(content, action.serverId);
      if (!server || !state.knownServers.includes(server.id)) return refuse('You do not have that address.');
      if (server.kind === 'gateway') return refuse('You are already at your gateway.');
      if (state.route.includes(server.id)) {
        return refuse(`${server.name} is a relay in your route. Remove it from the route to connect to it.`);
      }
      if (state.connections.some((connection) => connection.serverId === server.id)) {
        return refuse(`You are already connected to ${server.name}.`);
      }
      if (state.connections.length >= state.player.maxConnections) {
        return refuse(
          state.player.maxConnections === 1
            ? 'Your gateway can hold one connection at a time. Disconnect first.'
            : `Your gateway can hold ${state.player.maxConnections} connections at a time.`,
        );
      }
      const connection: Connection = {
        id: `c${state.nextId++}`,
        serverId: server.id,
        route: [...state.route],
        user: null,
        role: null,
        openedAtMs: state.clock.gameTimeMs,
        bypassed: { proxy: false, firewall: false },
        trace: newTrace(content, server, state.route),
        reroutes: 0,
        monitor: { blindMs: 0, used: false, echo: null },
      };
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
      if (account.role === 'admin' && server.security.password > 0) noteIntrusion(content, connection);
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
      if (!state.tasks.some((task) => task.id === action.taskId)) return refuse('That program has already stopped.');
      state.tasks = state.tasks.filter((task) => task.id !== action.taskId);
      return OK;
    }

    case 'acceptContract':
      return answer(acceptContract(state, content, action.connectionId, action.contractId));
    case 'abandonContract':
      return answer(abandonContract(state));
    case 'deliverContract':
      return answer(deliverContract(state, content));
    case 'alterRecord':
      return answer(alterRecord(state, content, action.connectionId));
    case 'buyProgram':
      return answer(buyProgram(state, content, action.connectionId, action.programId));
    case 'uninstallProgram':
      return answer(uninstallProgram(state, action.programId));
    case 'deleteStoredFile':
      return answer(deleteStoredFile(state, action.name));

    case 'readMessage': {
      const message = state.messages.find((item) => item.id === action.messageId);
      if (!message) return refuse('No such message.');
      message.read = true;
      return OK;
    }
  }
}
