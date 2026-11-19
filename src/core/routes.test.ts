import { describe, expect, it } from 'vitest';
import {
  ROUTE_SLOTS,
  applyAction,
  bestRoute,
  coverShortfall,
  createGame,
  deserializeGame,
  relayCover,
  relayHeat,
  relayWorth,
  serializeGame,
  stepFade,
  syncWithContent,
  traceHopMs,
  type Action,
  type Content,
  type GameState,
} from './index';
import { content as plain, testRules, testServers } from './testWorld';

/** The test world with the route rules switched on: 2 full steps, heat halves a relay, a monitor sees through poor relays. */
const world: Content = {
  ...plain,
  rules: { ...testRules, relayFullSteps: 2, relayFade: [0.5, 0.25], relayHeatSlow: 1, relayCoolHours: 2, coverShort: [1, 0.5, 0.1] },
};
const HOUR = 3_600_000;
const server = (id: string) => world.servers.find((item) => item.id === id)!;

const newGame = (): GameState => {
  const state = syncWithContent(createGame({ seed: 1, handle: 'T', startDate: '2034-03-14T08:00:00Z', startingBalance: 100 }), world);
  state.knownServers = testServers.map((item) => item.id);
  return state;
};
const act = (state: GameState, action: Action) => applyAction(state, action, world);
const ok = (state: GameState, action: Action) => expect(act(state, action)).toEqual({ ok: true });
const refused = (state: GameState, action: Action, pattern: RegExp) => {
  const result = act(state, action);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.reason).toMatch(pattern);
};

describe('relays that warm with use', () => {
  it('warms every relay of a route when a connection opens, and cools them with game time', () => {
    const state = newGame();
    ok(state, { type: 'addHop', serverId: 'relay-a' });
    ok(state, { type: 'addHop', serverId: 'relay-b' });
    expect(relayHeat(state, world, 'relay-a')).toBe(0);
    ok(state, { type: 'connect', serverId: 'directory' });
    expect(relayHeat(state, world, 'relay-a')).toBe(1);
    expect(relayHeat(state, world, 'relay-b')).toBe(1);
    expect(relayHeat(state, world, 'corp')).toBe(0);
    state.clock.gameTimeMs += HOUR;
    expect(relayHeat(state, world, 'relay-a')).toBeCloseTo(0.5, 5);
    state.clock.gameTimeMs += 2 * HOUR;
    expect(relayHeat(state, world, 'relay-a')).toBe(0);
  });

  it('gives a warm relay a shorter trace step, worked out as it stood before the connection', () => {
    const state = newGame();
    const target = server('directory');
    ok(state, { type: 'addHop', serverId: 'relay-a' });
    ok(state, { type: 'connect', serverId: 'directory' });
    const cold = state.connections[0]!.trace.hopMs[0]!;
    ok(state, { type: 'disconnectAll' });
    ok(state, { type: 'connect', serverId: 'directory' });
    expect(state.connections[0]!.trace.hopMs[0]).toBeCloseTo(cold / 2, 5);
    expect(relayHeat(state, world, 'relay-a')).toBe(2);
    expect(relayWorth(world, target, server('relay-a'), state)).toBeCloseTo(1 / 3, 5);
  });

  it('keeps heat through a save', () => {
    const state = newGame();
    ok(state, { type: 'addHop', serverId: 'relay-a' });
    ok(state, { type: 'connect', serverId: 'directory' });
    const loaded = deserializeGame(serializeGame(state, '')).state;
    expect(loaded.relayHeat).toEqual(state.relayHeat);
  });
});

describe('relays a monitor sees through', () => {
  it('covers as well as its own monitor, and one level better with a login held there', () => {
    const state = newGame();
    expect(relayCover(state, server('relay-a'))).toBe(server('relay-a').security.monitor);
    expect(relayCover(state, server('corp'))).toBe(1);
    state.player.passwords.corp = ['admin'];
    expect(relayCover(state, server('corp'))).toBe(2);
  });

  it('cuts a relay by how far it falls short of the target', () => {
    const state = newGame();
    const vault = server('vault'); // monitor 3
    expect(coverShortfall(state, vault, server('corp'))).toBe(2);
    expect(relayWorth(world, vault, server('corp'), state)).toBeCloseTo(0.1, 5);
    state.player.passwords.corp = ['admin'];
    expect(coverShortfall(state, vault, server('corp'))).toBe(1);
    expect(relayWorth(world, vault, server('corp'), state)).toBeCloseTo(0.5, 5);
    // A target with no monitor to speak of sees through nothing.
    expect(relayWorth(world, server('directory'), server('relay-b'), state)).toBe(1);
  });
});

describe('a trace that gathers pace', () => {
  it('takes the first steps back from the target in full and later ones less', () => {
    expect([0, 1, 2, 3, 4].map((step) => stepFade(world, step))).toEqual([1, 1, 0.5, 0.25, 0.25]);
    const state = newGame();
    const target = server('directory');
    const route = ['relay-b', 'corp', 'desk', 'relay-a'];
    const flat = traceHopMs(plain, target, route);
    const fading = traceHopMs(world, target, route, 1, undefined, state);
    expect(fading).toEqual([flat[0]!, flat[1]!, flat[2]! * 0.5, flat[3]! * 0.25]);
  });

  it('so the same relays hold a trace longer with the slowest one next to the target', () => {
    const state = newGame();
    const target = server('directory');
    const total = (route: string[]) => traceHopMs(world, target, route, 1, undefined, state).reduce((sum, ms) => sum + ms, 0);
    // relay-a is twice as slow to trace through as the others.
    expect(total(['relay-b', 'corp', 'relay-a'])).toBeGreaterThan(total(['relay-a', 'corp', 'relay-b']));
  });
});

describe('the Route Planner', () => {
  it('is needed to fill a route, and better versions place more relays', () => {
    const state = newGame();
    refused(state, { type: 'autoRoute', targetId: 'vault' }, /Route Planner/);
    expect(bestRoute(state, world, 'vault', 1).length).toBeLessThanOrEqual(4);
    expect(bestRoute(state, world, 'vault', 1)[0]).toBe('relay-a');
    state.player.programs.push('planner-1');
    ok(state, { type: 'autoRoute', targetId: 'vault' });
    expect(state.route).toEqual(bestRoute(state, world, 'vault', 1));
    expect(state.route).not.toContain('vault');
  });

  it('only version 3 steers clear of warm relays and ones the target sees through', () => {
    const state = newGame();
    state.relayHeat['relay-a'] = { heat: 3, atMs: state.clock.gameTimeMs };
    expect(bestRoute(state, world, 'directory', 2)[0]).toBe('relay-a');
    expect(bestRoute(state, world, 'directory', 3)[0]).not.toBe('relay-a');
    // Against the vault, a login on corp puts it ahead of a slower relay the vault sees straight through.
    const cool = newGame();
    cool.player.passwords.corp = ['admin'];
    const planned = bestRoute(cool, world, 'vault', 3);
    expect(planned.indexOf('corp')).toBeLessThan(planned.indexOf('relay-a'));
    expect(bestRoute(cool, world, 'vault', 2)[0]).toBe('relay-a');
  });
});

describe('saved routes', () => {
  it('keeps a route in a slot and loads it again', () => {
    const state = newGame();
    expect(state.savedRoutes).toHaveLength(ROUTE_SLOTS);
    refused(state, { type: 'saveRoute', slot: 0 }, /no route/);
    refused(state, { type: 'loadRoute', slot: 0 }, /empty/);
    ok(state, { type: 'addHop', serverId: 'relay-a' });
    ok(state, { type: 'addHop', serverId: 'corp' });
    ok(state, { type: 'saveRoute', slot: 1 });
    refused(state, { type: 'saveRoute', slot: 9 }, /no such slot/);
    ok(state, { type: 'clearRoute' });
    ok(state, { type: 'loadRoute', slot: 1 });
    expect(state.route).toEqual(['relay-a', 'corp']);
    // Changing the route afterwards leaves the kept one alone.
    ok(state, { type: 'removeHop', serverId: 'corp' });
    expect(state.savedRoutes[1]).toEqual(['relay-a', 'corp']);
  });

  it('leaves out a server that is connected to when a route is loaded', () => {
    const state = newGame();
    state.player.hardware.ports = 2;
    ok(state, { type: 'addHop', serverId: 'relay-a' });
    ok(state, { type: 'addHop', serverId: 'directory' });
    ok(state, { type: 'saveRoute', slot: 0 });
    ok(state, { type: 'clearRoute' });
    ok(state, { type: 'connect', serverId: 'directory' });
    ok(state, { type: 'loadRoute', slot: 0 });
    expect(state.route).toEqual(['relay-a']);
  });
});
