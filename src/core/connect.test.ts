import { describe, expect, it } from 'vitest';
import {
  MAX_HOPS,
  applyAction,
  createGame,
  deserializeGame,
  serializeGame,
  syncWithContent,
  type Action,
  type GameState,
} from './index';
import { content, testServers } from './testWorld';

const newGame = (): GameState =>
  syncWithContent(
    createGame({ seed: 1, handle: 'T', startDate: '2034-03-14T08:00:00Z', startingBalance: 100 }),
    content,
  );
const act = (state: GameState, action: Action) => applyAction(state, action, content);
const ok = (state: GameState, action: Action) => expect(act(state, action)).toEqual({ ok: true });
const refused = (state: GameState, action: Action, pattern: RegExp) => {
  const result = act(state, action);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.reason).toMatch(pattern);
};
/** A game where the player already knows every listed server. */
const knowAll = (): GameState => {
  const state = newGame();
  state.knownServers = testServers.map((server) => server.id);
  // These tests are about connecting, not security: the corp password is already known.
  state.player.passwords.corp = ['admin'];
  return state;
};
/** Id of the first open connection. Ids come from one shared counter, so tests never spell them out. */
const first = (state: GameState) => state.connections[0]?.id ?? 'closed';
const noTrace = (hopMs: number[]) => ({ status: 'none', graceMs: 0, elapsedMs: 0, hopMs });
const logTexts = (state: GameState, id: string) => state.servers[id]!.logs.filter((l) => l.byPlayer).map((l) => l.text);

describe('world setup', () => {
  it('gives every server its starting files, records and logs in time order', () => {
    const state = newGame();
    expect(state.servers.corp).toEqual({
      files: [{ name: 'secret.dat', sizeGq: 5, access: 'admin' }],
      logs: [],
      records: [['1', 'Ann'], ['2', 'Bo']],
    });
    const start = state.clock.gameTimeMs;
    expect(state.servers.directory!.logs).toEqual([
      { id: 1, timeMs: start - 60 * 60_000, text: 'earlier entry', byPlayer: false },
      { id: 2, timeMs: start - 5 * 60_000, text: 'later entry', byPlayer: false },
    ]);
  });

  it('starts the player with the gateway and the starting servers', () => {
    expect(newGame().knownServers).toEqual(['gateway', 'directory']);
  });

  it('does not reset servers that already have state, and can be run twice', () => {
    const state = newGame();
    state.servers.corp!.files.length = 0;
    syncWithContent(state, content);
    expect(state.servers.corp!.files).toEqual([]);
    expect(state.knownServers).toEqual(['gateway', 'directory']);
  });

  it('copies data, so changing the game never changes the data files', () => {
    const state = newGame();
    state.servers.corp!.records[0]![1] = 'Changed';
    expect(newGame().servers.corp!.records[0]![1]).toBe('Ann');
  });

  it('drops references to servers that no longer exist', () => {
    const state = knowAll();
    state.knownServers.push('gone');
    state.route = ['relay-a', 'gone'];
    state.connections = [
      { id: 'c9', serverId: 'gone', route: [], user: null, role: null, openedAtMs: 0, bypassed: { proxy: false, firewall: false }, trace: { status: 'none', graceMs: 0, elapsedMs: 0, hopMs: [1] }, reroutes: 0, monitor: { blindMs: 0, used: false, echo: null } },
    ];
    syncWithContent(state, content);
    expect(state.knownServers).not.toContain('gone');
    expect(state.route).toEqual(['relay-a']);
    expect(state.connections).toEqual([]);
  });
});

describe('planning a route', () => {
  it('adds and removes relays in order', () => {
    const state = knowAll();
    ok(state, { type: 'addHop', serverId: 'relay-a' });
    ok(state, { type: 'addHop', serverId: 'relay-b' });
    expect(state.route).toEqual(['relay-a', 'relay-b']);
    ok(state, { type: 'removeHop', serverId: 'relay-a' });
    expect(state.route).toEqual(['relay-b']);
    ok(state, { type: 'clearRoute' });
    expect(state.route).toEqual([]);
  });

  it('refuses unknown addresses, the gateway, repeats and removals of servers not in the route', () => {
    const state = newGame();
    refused(state, { type: 'addHop', serverId: 'relay-a' }, /do not have that address/);
    refused(state, { type: 'addHop', serverId: 'nowhere' }, /do not have that address/);
    refused(state, { type: 'addHop', serverId: 'gateway' }, /gateway/);
    ok(state, { type: 'addHop', serverId: 'directory' });
    refused(state, { type: 'addHop', serverId: 'directory' }, /already in the route/);
    refused(state, { type: 'removeHop', serverId: 'relay-a' }, /not in the route/);
  });

  it('caps the length of a route', () => {
    const state = knowAll();
    state.route = Array.from({ length: MAX_HOPS }, (_, i) => `filler-${i}`);
    refused(state, { type: 'addHop', serverId: 'relay-a' }, /at most/);
  });
});

describe('connecting', () => {
  it('opens a connection through the planned route and keeps its own copy of it', () => {
    const state = knowAll();
    ok(state, { type: 'addHop', serverId: 'relay-a' });
    ok(state, { type: 'connect', serverId: 'corp' });
    expect(state.connections).toEqual([
      {
        id: expect.stringMatching(/^c\d+$/),
        serverId: 'corp',
        route: ['relay-a'],
        user: null,
        role: null,
        openedAtMs: state.clock.gameTimeMs,
        bypassed: { proxy: false, firewall: false },
        // One relay with a delay of 2, at 10 seconds per hop.
        trace: noTrace([20_000]),
        reroutes: 0,
        monitor: { blindMs: 0, used: false, echo: null },
      },
    ]);
    ok(state, { type: 'clearRoute' });
    expect(state.connections[0]!.route).toEqual(['relay-a']);
  });

  it('refuses unknown servers, the gateway, a server in the route, and a second connection to the same server', () => {
    const state = knowAll();
    state.player.maxConnections = 3;
    refused(newGame(), { type: 'connect', serverId: 'corp' }, /do not have that address/);
    refused(state, { type: 'connect', serverId: 'gateway' }, /already at your gateway/);
    ok(state, { type: 'addHop', serverId: 'relay-a' });
    refused(state, { type: 'connect', serverId: 'relay-a' }, /relay in your route/);
    ok(state, { type: 'connect', serverId: 'corp' });
    refused(state, { type: 'connect', serverId: 'corp' }, /already connected/);
  });

  it('allows one connection at a time to start with, and more once the gateway supports it', () => {
    const state = knowAll();
    ok(state, { type: 'connect', serverId: 'corp' });
    refused(state, { type: 'connect', serverId: 'directory' }, /one connection at a time/);
    state.player.maxConnections = 2;
    ok(state, { type: 'connect', serverId: 'directory' });
    expect(state.connections.map((c) => c.serverId)).toEqual(['corp', 'directory']);
    refused(state, { type: 'connect', serverId: 'relay-b' }, /2 connections/);
  });

  it('gives each connection its own route', () => {
    const state = knowAll();
    state.player.maxConnections = 2;
    ok(state, { type: 'addHop', serverId: 'relay-a' });
    ok(state, { type: 'connect', serverId: 'corp' });
    ok(state, { type: 'clearRoute' });
    ok(state, { type: 'addHop', serverId: 'relay-b' });
    ok(state, { type: 'connect', serverId: 'directory' });
    expect(state.connections.map((c) => c.route)).toEqual([['relay-a'], ['relay-b']]);
  });

  it('disconnects one connection or all of them', () => {
    const state = knowAll();
    state.player.maxConnections = 3;
    ok(state, { type: 'connect', serverId: 'corp' });
    ok(state, { type: 'connect', serverId: 'directory' });
    ok(state, { type: 'connect', serverId: 'relay-a' });
    const second = state.connections[1]!.id;
    ok(state, { type: 'disconnect', connectionId: second });
    expect(state.connections.map((c) => c.serverId)).toEqual(['corp', 'relay-a']);
    refused(state, { type: 'disconnect', connectionId: second }, /already closed/);
    ok(state, { type: 'disconnectAll' });
    expect(state.connections).toEqual([]);
    ok(state, { type: 'disconnectAll' });
  });

  it('never reuses a connection id', () => {
    const state = knowAll();
    ok(state, { type: 'connect', serverId: 'corp' });
    const before = first(state);
    ok(state, { type: 'disconnectAll' });
    ok(state, { type: 'connect', serverId: 'corp' });
    expect(first(state)).not.toBe(before);
  });
});

describe('access logs', () => {
  it('record the previous hop, not the player, at every step of the chain', () => {
    const state = knowAll();
    ok(state, { type: 'addHop', serverId: 'relay-a' });
    ok(state, { type: 'addHop', serverId: 'relay-b' });
    ok(state, { type: 'connect', serverId: 'corp' });
    ok(state, { type: 'login', connectionId: first(state), user: 'admin' });
    ok(state, { type: 'disconnect', connectionId: first(state) });

    expect(logTexts(state, 'relay-a')).toEqual(['relay opened 10.0.0.1 > 10.0.0.4', 'relay closed 10.0.0.1']);
    expect(logTexts(state, 'relay-b')).toEqual(['relay opened 10.0.0.3 > 10.0.0.5', 'relay closed 10.0.0.3']);
    expect(logTexts(state, 'corp')).toEqual([
      'connection opened from 10.0.0.4',
      'login admin from 10.0.0.4',
      'logout admin',
      'connection closed 10.0.0.4',
    ]);
    expect(JSON.stringify(state.servers.corp)).not.toContain('10.0.0.1');
  });

  it('show the gateway address on a direct connection', () => {
    const state = knowAll();
    ok(state, { type: 'connect', serverId: 'corp' });
    expect(logTexts(state, 'corp')).toEqual(['connection opened from 10.0.0.1']);
  });

  it('are stamped with the game time and marked as the player\'s', () => {
    const state = knowAll();
    ok(state, { type: 'connect', serverId: 'corp' });
    expect(state.servers.corp!.logs).toEqual([
      { id: expect.any(Number), timeMs: state.clock.gameTimeMs, text: 'connection opened from 10.0.0.1', byPlayer: true },
    ]);
  });
});

describe('logging in', () => {
  it('logs in to an account that exists and takes its role', () => {
    const state = knowAll();
    ok(state, { type: 'connect', serverId: 'relay-a' });
    ok(state, { type: 'login', connectionId: first(state), user: 'root' });
    expect(state.connections[0]).toMatchObject({ user: 'root', role: 'admin' });
  });

  it('refuses accounts that do not exist, closed connections and a second login', () => {
    const state = knowAll();
    refused(state, { type: 'login', connectionId: first(state), user: 'guest' }, /closed/);
    ok(state, { type: 'connect', serverId: 'relay-a' });
    refused(state, { type: 'login', connectionId: first(state), user: 'nobody' }, /No such account/);
    ok(state, { type: 'login', connectionId: first(state), user: 'guest' });
    refused(state, { type: 'login', connectionId: first(state), user: 'root' }, /Already logged in/);
  });
});

describe('the directory', () => {
  const atDirectory = (login = true): GameState => {
    const state = newGame();
    ok(state, { type: 'connect', serverId: 'directory' });
    if (login) ok(state, { type: 'login', connectionId: first(state), user: 'guest' });
    return state;
  };

  it('adds a listed address to the address book', () => {
    const state = atDirectory();
    ok(state, { type: 'learnServer', connectionId: first(state), serverId: 'corp' });
    expect(state.knownServers).toContain('corp');
    refused(state, { type: 'learnServer', connectionId: first(state), serverId: 'corp' }, /already have/);
  });

  it('needs a login, a directory server, and a listed address', () => {
    const loggedOut = atDirectory(false);
    refused(loggedOut, { type: 'learnServer', connectionId: first(loggedOut), serverId: 'corp' }, /Log in first/);
    const loggedIn = atDirectory();
    refused(loggedIn, { type: 'learnServer', connectionId: first(loggedIn), serverId: 'hidden' }, /not listed/);
    refused(loggedIn, { type: 'learnServer', connectionId: first(loggedIn), serverId: 'nowhere' }, /not listed/);

    const state = knowAll();
    ok(state, { type: 'connect', serverId: 'relay-a' });
    ok(state, { type: 'login', connectionId: first(state), user: 'guest' });
    state.knownServers = ['gateway', 'relay-a'];
    refused(state, { type: 'learnServer', connectionId: first(state), serverId: 'corp' }, /no directory/);
  });
});

describe('saving with the world in it', () => {
  it('round-trips routes, connections, known servers and server changes', () => {
    const state = knowAll();
    ok(state, { type: 'addHop', serverId: 'relay-a' });
    ok(state, { type: 'connect', serverId: 'corp' });
    ok(state, { type: 'login', connectionId: first(state), user: 'admin' });
    const loaded = syncWithContent(deserializeGame(serializeGame(state, '')).state, content);
    expect(loaded).toEqual(state);
  });
});
